'use strict';

const vscode = require('vscode');
const fs = require('fs');
const { indexProgress, isComplete, describeProgress, textGuesses } = require('./text-guess');
const { trace, since } = require('./trace');

// Every one of these is served by whatever language server is already installed
// - clangd, cpptools, rust-analyzer, tsserver. This feature owns no analysis of
// its own; it only decides which question to ask, and which answer to take.
const PROVIDERS = {
  definition: 'vscode.executeDefinitionProvider',
  declaration: 'vscode.executeDeclarationProvider',
  implementation: 'vscode.executeImplementationProvider',
  typeDefinition: 'vscode.executeTypeDefinitionProvider',
};

// Translated through vscode.l10n; the Korean terms follow VS Code's own Korean
// language pack, so the menu says what VS Code's Go to menu says.
const LABELS = {
  definition: vscode.l10n.t('Definition'),
  declaration: vscode.l10n.t('Declaration'),
  implementation: vscode.l10n.t('Implementation'),
  typeDefinition: vscode.l10n.t('Type definition'),
  // Roles rather than providers: what a C++ answer means about a virtual.
  override: vscode.l10n.t('Override'),
  base: vscode.l10n.t('Base virtual'),
};

// In C++ an implementation is always an override - clangd answers that request
// only for virtuals. Other languages keep the generic word, because there an
// implementation can be a class implementing an interface.
const CPP = /^(c|cpp|cuda-cpp|objective-c|objective-cpp)$/;

// The one spelling a C++ override has. Nothing looks further than the line
// the declaration starts on.
const OVERRIDE = /\b(override|final)\b/;

// Used only to sort, never to decide what a file is. Anything that does not
// match counts as a source file, which is the right default for the languages
// that have no headers at all.
const HEADER = /\.(h|hh|hpp|hxx|inl|ipp)$/i;

// A name search is a blunt instrument: ask for "get" in a real project and the
// index will happily answer with hundreds. The picker is not a search results
// page, so cut it off well before it becomes one.
const MAX_BY_NAME = 12;

// How long to wait on the language server while its index is incomplete
// before settling for text guesses.
const INDEXING_WAIT_MS = 2000;

// Text guesses shown at most, the most similar ones.
const MAX_TEXT = 5;

/**
 * Providers answer with either a Location or a LocationLink, and which one you
 * get depends on the server rather than on the request. Flatten both to
 * Location, preferring targetSelectionRange: that is the name of the symbol,
 * where targetRange is the whole body. The distinction matters below - a body
 * contains the cursor for every call made inside it, and the round trip would
 * read those as "already here".
 * @param {unknown} raw
 * @param {string} kind
 */
function toHits(raw, kind) {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item.targetUri) {
      const range = item.targetSelectionRange || item.targetRange;
      out.push({ kind, loc: new vscode.Location(item.targetUri, range) });
    } else if (item.uri && item.range) {
      out.push({ kind, loc: new vscode.Location(item.uri, item.range) });
    }
  }
  return out;
}

/** @param {vscode.Location} loc @param {vscode.Uri} uri @param {vscode.Position} pos */
function isHere(loc, uri, pos) {
  return loc.uri.toString() === uri.toString() && loc.range.contains(pos);
}

/** @param {{loc: vscode.Location}} hit */
function key(hit) {
  const start = hit.loc.range.start;
  return `${hit.loc.uri.toString()}:${start.line}:${start.character}`;
}

/** @param {string} step @param {vscode.Uri} uri @param {vscode.Position} pos */
async function ask(step, uri, pos) {
  const command = PROVIDERS[step];
  if (!command) return [];
  try {
    return toHits(await vscode.commands.executeCommand(command, uri, pos), step);
  } catch {
    // A server that does not implement this request rejects rather than
    // answering empty. That is not an error here, it is just a dead end.
    return [];
  }
}

/**
 * The one question here that is not a jump: look the bare name up in the
 * workspace symbol index and keep whatever carries that name.
 *
 * It is asked every time rather than only when the providers come up empty,
 * because on cpptools they rarely do come up empty - they come up with exactly
 * one answer, and one answer cannot be offered as a choice. Measured at three
 * cursor positions in C++: the definition provider answers a definition with
 * the declaration and a declaration with the definition, one location each,
 * and there is no declaration provider at all to supply the other side. So the
 * choice this feature is supposed to offer has to be built from the index.
 *
 * It also reaches the one place no provider does: standing in a member
 * function's body, every provider answers with that same body, so subtracting
 * "where the cursor already is" leaves nothing at all.
 *
 * @param {vscode.TextDocument} document @param {vscode.Position} pos
 */
async function searchSymbols(document, pos) {
  const range = document.getWordRangeAtPosition(pos);
  if (!range) return { word: '', symbols: [] };
  const word = document.getText(range);
  if (!word) return { word: '', symbols: [] };

  try {
    const raw = await vscode.commands.executeCommand(
      'vscode.executeWorkspaceSymbolProvider',
      word,
    );
    return { word, symbols: (raw || []).filter((symbol) => symbol && symbol.location) };
  } catch {
    return { word, symbols: [] };
  }
}

/**
 * Index entries are not bare names. cpptools attaches the signature - the entry
 * for totalArea comes back as "totalArea(const Shape **, int)" - and other
 * servers qualify with the class instead. Cut at the first paren and compare
 * what is left, so both shapes reduce to the same name.
 * @param {string} raw
 */
function bareName(raw) {
  const cut = raw.indexOf('(');
  return (cut < 0 ? raw : raw.slice(0, cut)).trim();
}

/** @param {{name?: string}} symbol @param {string} word */
function carriesName(symbol, word) {
  const name = bareName(symbol.name || '');
  return name === word || name.endsWith(`::${word}`);
}

/** @param {{name?: string, containerName?: string, location: vscode.Location}} symbol */
function toNameHit(symbol) {
  const name = bareName(symbol.name || '');
  const qualified =
    symbol.containerName && !name.includes('::') ? `${symbol.containerName}::${name}` : name;
  // Taken from the qualified name rather than containerName, so a server that
  // spells the class into the name itself groups the same way as one that does not.
  const container = qualified.includes('::') ? qualified.slice(0, qualified.lastIndexOf('::')) : '';
  return { kind: 'name', label: qualified, container, loc: symbol.location };
}

/** @param {vscode.TextDocument} document @param {vscode.Position} pos */
async function byName(document, pos) {
  const { word, symbols } = await searchSymbols(document, pos);
  if (!word) return [];
  // Not capped here: the entry that tells gather() which namespace is meant can
  // sit anywhere in the list, and the cap belongs after that filter.
  return symbols.filter((symbol) => carriesName(symbol, word)).map(toNameHit);
}

/**
 * One line of a file, without opening it as a document. openTextDocument does
 * not only read: every language client sees the document open (the clangd
 * extension sends didOpen for it, checked in its bundled client) and clangd
 * then parses the whole file as if it were being edited - seconds per header
 * in a large project, on every round trip that lands in one. A document that
 * is already open is read from memory, anything else from disk.
 * @param {vscode.Uri} uri @param {number} line
 */
async function lineText(uri, line) {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  if (open) return line < open.lineCount ? open.lineAt(line).text : '';
  if (uri.scheme !== 'file') return '';
  return (await fs.promises.readFile(uri.fsPath, 'utf8')).split(/\r?\n/)[line] || '';
}

/**
 * The base of an override. clangd answers definition at the `override` keyword
 * with the virtual it overrides (measured on clangd 22), so find that keyword on
 * the lines already known to hold this symbol - the cursor's own, and wherever
 * the providers landed - and ask there. When the base that comes back is where
 * the cursor stands, the line asked from is not the cursor's symbol but another
 * override of it, and it is marked as one - on a base, clangd's declaration
 * answer lists the overrides' declarations with nothing to tell them apart.
 * ponytail: only the line the declaration starts on; a signature wrapped before
 * `override` has no base row. Scan to the `;` if that turns out common.
 * @param {vscode.Location[]} places @param {vscode.Uri} uri @param {vscode.Position} pos
 */
async function bases(places, uri, pos) {
  const lines = new Map();
  for (const place of places) lines.set(`${place.uri.toString()}:${place.range.start.line}`, place);
  const found = await Promise.all(
    [...lines.values()].map(async (place) => {
      try {
        const text = await lineText(place.uri, place.range.start.line);
        const match = OVERRIDE.exec(text.slice(place.range.start.character));
        if (!match) return [];
        const at = place.range.start.translate(0, match.index);
        const found = await ask('definition', place.uri, at);
        if (found.some((hit) => isHere(hit.loc, uri, pos))) return [{ kind: 'declaration', role: 'override', loc: place }];
        return found.map((hit) => ({ ...hit, role: 'base' }));
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

/** @param {vscode.Location} a @param {vscode.Location} b */
function sameLine(a, b) {
  return a.uri.toString() === b.uri.toString() && a.range.start.line === b.range.start.line;
}

/**
 * A name alone does not say which namespace or class is meant - "area" is
 * Shape::area and Circle::area, and a project with a guide:: namespace has a
 * dozen of everything. But the index entry sitting where a provider landed, or
 * where the cursor already is, is the symbol actually asked about, and its
 * container is the one to keep. When no entry sits at any of those places the
 * namespace cannot be told, and `unknown` decides what is left.
 * @param {{container: string, loc: vscode.Location}[]} names
 * @param {vscode.Location[]} anchors
 * @param {{container: string, loc: vscode.Location}[]} unknown
 */
function sameContainer(names, anchors, unknown) {
  const containers = new Set(
    names.filter((hit) => anchors.some((anchor) => sameLine(hit.loc, anchor))).map((hit) => hit.container),
  );
  return containers.size === 0 ? unknown : names.filter((hit) => containers.has(hit.container));
}

/**
 * Ask everything at once rather than stopping at the first source that answers.
 * Stopping early cannot tell "the only place to go" apart from "the first of
 * several", and that difference is the whole feature: one answer is a jump,
 * several is a choice. Asking in parallel also costs less wall clock than
 * walking a chain did.
 * @param {vscode.TextDocument} document @param {vscode.Position} pos
 * @param {{steps: string[], searchByName: boolean, spent: string[]}} options
 *   spent collects when each stage finished, for the trace
 */
async function gather(document, pos, options) {
  const uri = document.uri;
  const start = Date.now();
  const done = (text) => options.spent.push(`${text} at ${since(start)}`);
  // Both start now, but the name search is only waited for once the providers
  // turn out to need it - see `certain` below.
  const asked = Promise.all(options.steps.map((step) => ask(step, uri, pos)));
  const searched = options.searchByName ? byName(document, pos) : Promise.resolve([]);
  // While clangd is still indexing it can sit on a request for as long as it
  // takes to parse the file, and the menu cannot open before every answer is
  // in. Past a short wait the text guesses below are worth more than silence.
  // One deadline for both, so answers that did arrive in time are kept.
  const indexing = !isComplete(options.progress);
  const deadline = indexing && new Promise((resolve) => setTimeout(resolve, INDEXING_WAIT_MS));
  // null when the deadline won, so the trace can tell a cut from an empty answer.
  const within = (promise) => (deadline ? Promise.race([promise, deadline.then(() => null)]) : promise);
  const answered = (await within(asked)) || [];
  done(`providers ${answered.flat().length}${answered.length ? '' : ' (cut at the indexing deadline)'}`);

  const seen = new Map();
  const add = (hit) => {
    if (isHere(hit.loc, uri, pos)) return;
    // Two sources pointing at one place is one destination. The first source in
    // the configured order gets to name it, which keeps a provider's label -
    // "Definition" - ahead of the name search's bare symbol name. A role beats
    // that order: on a base virtual clangd's definition answer already lists the
    // overrides, and they should still read as overrides.
    const known = seen.get(key(hit));
    if (!known || (hit.role && !known.role)) seen.set(key(hit), hit);
  };
  const cpp = CPP.test(document.languageId);
  const resolved = answered
    .flat()
    .map((hit) => (cpp && hit.kind === 'implementation' ? { ...hit, role: 'override' } : hit));
  // Asked after the providers because it needs their answers to know where
  // the declaration is. Only a line that spells `override` costs a request.
  if (cpp) {
    resolved.push(...(await bases([new vscode.Location(uri, pos), ...resolved.map((hit) => hit.loc)], uri, pos)));
    done('base virtuals');
  }
  resolved.forEach(add);

  // Providers resolved the symbol; the name search only guessed at it. Once the
  // providers alone offer a choice, the guesses only bury it - clangd answers a
  // call site with both the definition and the declaration, and a name shared
  // across namespaces used to put a dozen rows on top of those two. The name
  // search stays for the servers that answer with one place or none.
  const certain = seen.size;
  if (certain >= 2) {
    done('name search not waited for');
    return [...seen.values()];
  }
  const named = (await within(searched)) || [];
  done(`name search ${named.length} named`);
  const anchors = [...resolved.map((hit) => hit.loc), new vscode.Location(uri, pos)];
  // A provider that found the symbol at all found the right one, and a name
  // from an unknown namespace can only be a different symbol that happens to
  // share it. Only when nothing was found do those names beat an empty answer.
  sameContainer(named, anchors, seen.size > 0 ? [] : named).slice(0, MAX_BY_NAME).forEach(add);

  // The last resort, and the only one that reads files: text that looks like a
  // definition. Only while clangd's index is incomplete - once it is done, a
  // name the server cannot find is not there - and textGuesses() carries the
  // rest of the limits.
  if (options.textSearch && cpp && indexing) {
    const taken = new Set([...seen.values(), { loc: new vscode.Location(uri, pos) }].map((hit) => lineOf(hit.loc)));
    const guesses = await textGuesses(document, pos, resolved.map((hit) => hit.loc));
    guesses.filter((hit) => !taken.has(lineOf(hit.loc))).slice(0, MAX_TEXT).forEach(add);
    done(`text guesses ${guesses.length}`);
  }
  return [...seen.values()];
}

/** @param {vscode.Location} loc */
function lineOf(loc) {
  return `${loc.uri.toString()}:${loc.range.start.line}`;
}

/**
 * Resolved answers always come before name guesses. Within each, "go to the
 * body" is the move you want most of the time, and the body is the
 * one that is not in a header. That single test puts the .cpp definition above
 * the .h declaration for a plain function, and the override in the .cpp above
 * the base declaration for a virtual one - one answer for two cases that would
 * otherwise need a rule each. Header-only code fails the test uniformly and
 * falls through to the order the sources were asked in, with the name search
 * last because it is the only one that did not resolve the symbol.
 * @param {{kind: string, loc: vscode.Location}[]} hits @param {string[]} steps
 */
function ranked(hits, steps) {
  const order = (kind) => (steps.indexOf(kind) < 0 ? steps.length : steps.indexOf(kind));
  return hits
    .map((hit) => ({
      hit,
      guess: hit.kind === 'text' ? 2 : hit.kind === 'name' ? 1 : 0,
      header: HEADER.test(hit.loc.uri.path) ? 1 : 0,
      order: order(hit.kind),
    }))
    .sort((a, b) => a.guess - b.guess || a.header - b.header || a.order - b.order)
    .map((entry) => entry.hit);
}

/** @param {vscode.Location} loc */
function where(loc) {
  return `${vscode.workspace.asRelativePath(loc.uri)}:${loc.range.start.line + 1}`;
}

/**
 * Every row reads source-first, so the picker sorts by eye the way it sorts in
 * code. A provider row has nothing to add after its name - the location already
 * says where it landed - while a name row does: two entries from the index can
 * differ only by which class they belong to, and Shape::area against
 * Circle::area is the whole distinction being offered.
 * @param {{kind: string, label?: string, loc: vscode.Location}} hit
 */
function describe(hit) {
  const source =
    hit.kind === 'name'
      ? vscode.l10n.t('By name · {0}', hit.label)
      : hit.kind === 'text'
        ? vscode.l10n.t('Text guess {0}% · {1}', hit.similarity, hit.label)
        : LABELS[hit.role || hit.kind] || hit.kind;
  return `${source}  —  ${where(hit.loc)}`;
}

/** @param {vscode.Location} loc */
async function reveal(loc) {
  const doc = await vscode.workspace.openTextDocument(loc.uri);
  // A file already showing in another split is jumped to there, not opened again
  // over the file the jump started from.
  const key = loc.uri.toString();
  const active = vscode.window.activeTextEditor;
  const shown =
    active && active.document.uri.toString() === key
      ? active
      : vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
  const editor = await vscode.window.showTextDocument(doc, shown && shown.viewColumn);
  const start = loc.range.start;
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

// QuickPick has no position - it always opens at the top of the window, far from
// the cursor the question was asked at. The one list VS Code opens at the cursor
// is the code action menu, so the choice is offered as code actions of a kind
// nothing else provides, answered only when the menu is opened for that kind.
const MENU_KIND = vscode.CodeActionKind.Empty.append('assist.roundTrip');
let offered = null;
let menuProvider = null;

/**
 * @param {vscode.TextDocument} document @param {{kind: string, loc: vscode.Location}[]} hits
 * @param {string} note shown as a last row that goes nowhere - the index progress
 */
function pick(document, hits, note) {
  offered = { uri: document.uri.toString(), hits, note };
  // ponytail: registered on first use and never disposed - it lives exactly as
  // long as the extension host. Move to activate() if features grow a lifecycle.
  if (!menuProvider) {
    menuProvider = vscode.languages.registerCodeActionsProvider(
      '*',
      {
        provideCodeActions(doc, _range, context) {
          if (!offered || doc.uri.toString() !== offered.uri) return;
          if (!context.only || !context.only.contains(MENU_KIND)) return;
          const actions = offered.hits.map((hit) => {
            const action = new vscode.CodeAction(describe(hit), MENU_KIND);
            action.command = { title: 'Go', command: 'assist.roundTrip.go', arguments: [hit.loc] };
            return action;
          });
          if (offered.note) actions.push(new vscode.CodeAction(offered.note, MENU_KIND));
          return actions;
        },
      },
      { providedCodeActionKinds: [MENU_KIND] },
    );
  }
  return vscode.commands.executeCommand('editor.action.codeAction', {
    kind: MENU_KIND.value,
    apply: 'never',
  });
}

/**
 * The menu cannot open until every source has answered, and it cannot be
 * filled in after it opens, so a slow server is a key press that seems to do
 * nothing. A spinner in the status bar is the only sign that it did.
 * @template T @param {() => Promise<T>} task @param {string} [note] @returns {Promise<T>}
 */
function busy(task, note = '') {
  const title = vscode.l10n.t('Round trip: waiting for the language server');
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: note ? `${title} · ${note}` : title },
    task,
  );
}

/**
 * Wall clock of one question, so the explain list can say which source the
 * wait belongs to. On a server still parsing the file, every one of them is slow.
 * @template T @param {Promise<T>} promise
 */
async function timed(promise) {
  const start = Date.now();
  const value = await promise;
  return { value, ms: Date.now() - start };
}

function settings() {
  const config = vscode.workspace.getConfiguration('assist.roundTrip');
  return {
    steps: config.get('providers', ['definition', 'implementation', 'declaration']),
    searchByName: config.get('searchByName', true),
    pickWhenAmbiguous: config.get('pickWhenAmbiguous', true),
    textSearch: config.get('textSearch', true),
  };
}

async function roundTrip() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const pos = editor.selection.active;
  const progress = indexProgress(editor.document);
  const options = { ...settings(), progress, spent: [] };
  const note = isComplete(progress) ? '' : describeProgress(progress);
  const start = Date.now();
  const at = `${where(new vscode.Location(editor.document.uri, pos))} "${wordAt(editor.document, pos)}"`;

  const targets = ranked(await busy(() => gather(editor.document, pos, options), note), options.steps);
  const log = (outcome) => trace(`round trip ${at}: ${options.spent.join(', ')}; ${outcome}`);
  if (targets.length === 0) {
    log(`nowhere to go, ${since(start)} in all`);
    const nowhere = vscode.l10n.t('Round trip: nowhere to go from here');
    vscode.window.setStatusBarMessage(`$(circle-slash) ${note ? `${nowhere} · ${note}` : nowhere}`, note ? 5000 : 2000);
    return;
  }

  // A text guess is never jumped to on its own: it may be a different symbol
  // that happens to share the name, and only a menu lets you see that first.
  const guessed = targets.some((hit) => hit.kind === 'text');
  if ((targets.length > 1 && options.pickWhenAmbiguous) || guessed) {
    const asked = Date.now();
    await pick(editor.document, targets, note);
    log(`menu of ${targets.length}, menu command returned after ${since(asked)}, ${since(start)} in all`);
    return;
  }
  await reveal(targets[0].loc);
  log(`jumped, ${since(start)} in all`);
}

/** @param {vscode.TextDocument} document @param {vscode.Position} pos */
function wordAt(document, pos) {
  const range = document.getWordRangeAtPosition(pos);
  return range ? document.getText(range) : '';
}

/**
 * Every wait `Alt+G` can spend at the cursor, one at a time, for a saved note.
 * In a row rather than at once, so no stage's time includes another's - which is
 * also why it is slower than the round trip itself. Each row is [what, ms, count].
 * @param {vscode.TextDocument} document @param {vscode.Position} pos
 */
async function measure(document, pos) {
  const uri = document.uri;
  const rows = [];
  const resolved = [];
  for (const step of Object.keys(PROVIDERS)) {
    const { value, ms } = await timed(ask(step, uri, pos));
    rows.push([`provider: ${step}`, ms, value.length]);
    resolved.push(...value);
  }
  // Slow the first time and fast the second is a server parsing the file.
  const again = await timed(ask('definition', uri, pos));
  rows.push(['provider: definition, asked again', again.ms, again.value.length]);
  if (CPP.test(document.languageId)) {
    const places = [new vscode.Location(uri, pos), ...resolved.map((hit) => hit.loc)];
    const found = await timed(bases(places, uri, pos));
    rows.push(['base virtuals (asks again on override lines, may open their files)', found.ms, found.value.length]);
  }
  const searched = await timed(searchSymbols(document, pos));
  const named = searched.value.symbols.filter((symbol) => carriesName(symbol, searched.value.word)).length;
  rows.push([`name search "${searched.value.word}": returned, of which ${named} carry the name`, searched.ms, searched.value.symbols.length]);
  // What opening the menu makes VS Code collect: every code action provider that
  // does not rule out this kind is asked, not only this extension's.
  const menu = await timed(
    Promise.resolve(
      vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, new vscode.Range(pos, pos), MENU_KIND.value),
    ).catch(() => []),
  );
  rows.push(['code actions collected for the menu kind', menu.ms, (menu.value || []).length]);
  return rows;
}

/**
 * The diagnostic for "why did it go there". Shows every source's raw answer
 * including the ones the round trip discards, which is the part the outcome
 * alone cannot tell you.
 */
async function explain() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const document = editor.document;
  const uri = document.uri;
  const pos = editor.selection.active;

  const steps = Object.keys(PROVIDERS);
  const [searched, ...asked] = await busy(() =>
    Promise.all([
      timed(searchSymbols(document, pos)),
      ...steps.map((step) => timed(ask(step, uri, pos))),
    ]),
  );
  const search = searched.value;
  const answers = asked.map((answer) => answer.value);
  const times = [...asked.map((answer) => answer.ms), searched.ms];
  // Kept unfiltered alongside the matches, because "the index found nothing"
  // and "the filter threw everything away" look identical from the outside and
  // want opposite fixes.
  const matched = search.symbols.filter((symbol) => carriesName(symbol, search.word));
  answers.push(matched.slice(0, MAX_BY_NAME).map(toNameHit));
  const sources = [...steps.map((step) => LABELS[step]), vscode.l10n.t('By name')].map(
    (source, i) => `${source} · ${times[i]} ms`,
  );

  const items = [];
  answers.forEach((hits, i) => {
    if (hits.length === 0) {
      items.push({ label: `$(dash) ${sources[i]}`, description: vscode.l10n.t('no answer'), hit: null });
      return;
    }
    for (const hit of hits) {
      const here = isHere(hit.loc, uri, pos);
      items.push({
        label: `${here ? '$(circle-slash)' : '$(arrow-right)'} ${sources[i]}`,
        description: `${where(hit.loc)}${hit.label ? `  ${hit.label}` : ''}`,
        detail: here ? vscode.l10n.t('dropped: this is where the cursor already is') : undefined,
        hit,
      });
    }
  });

  items.push({
    label: `$(info) ${vscode.l10n.t('Index: "{0}"', search.word)}`,
    description: vscode.l10n.t('{0} returned, {1} matched the name', search.symbols.length, matched.length),
    detail:
      search.symbols.length > 0
        ? vscode.l10n.t('returned: {0}', search.symbols.slice(0, 5).map((symbol) => symbol.name).join('  |  '))
        : vscode.l10n.t('the workspace symbol index answered nothing at all'),
    hit: null,
  });

  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Round trip at {0} - what each source answered', where(new vscode.Location(uri, pos))),
    matchOnDescription: true,
  });
  if (chosen && chosen.hit) await reveal(chosen.hit.loc);
}

module.exports = {
  measure,
  commands: {
    'assist.roundTrip': roundTrip,
    'assist.roundTrip.explain': explain,
    // Not contributed, so it stays out of the palette: the menu's rows call it.
    'assist.roundTrip.go': reveal,
  },
};
