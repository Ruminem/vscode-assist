'use strict';

const vscode = require('vscode');

// Every one of these is served by whatever language server is already installed
// - clangd, cpptools, rust-analyzer, tsserver. This feature owns no analysis of
// its own; it only decides which question to ask, and which answer to take.
const PROVIDERS = {
  definition: 'vscode.executeDefinitionProvider',
  declaration: 'vscode.executeDeclarationProvider',
  implementation: 'vscode.executeImplementationProvider',
  typeDefinition: 'vscode.executeTypeDefinitionProvider',
};

const LABELS = {
  definition: 'Definition',
  declaration: 'Declaration',
  implementation: 'Implementation',
  typeDefinition: 'Type definition',
};

// Used only to sort, never to decide what a file is. Anything that does not
// match counts as a source file, which is the right default for the languages
// that have no headers at all.
const HEADER = /\.(h|hh|hpp|hxx|inl|ipp)$/i;

// A name search is a blunt instrument: ask for "get" in a real project and the
// index will happily answer with hundreds. The picker is not a search results
// page, so cut it off well before it becomes one.
const MAX_BY_NAME = 12;

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
  return { kind: 'name', label: qualified, loc: symbol.location };
}

/** @param {vscode.TextDocument} document @param {vscode.Position} pos */
async function byName(document, pos) {
  const { word, symbols } = await searchSymbols(document, pos);
  if (!word) return [];
  return symbols
    .filter((symbol) => carriesName(symbol, word))
    .slice(0, MAX_BY_NAME)
    .map(toNameHit);
}

/**
 * Ask everything at once rather than stopping at the first source that answers.
 * Stopping early cannot tell "the only place to go" apart from "the first of
 * several", and that difference is the whole feature: one answer is a jump,
 * several is a choice. Asking in parallel also costs less wall clock than
 * walking a chain did.
 * @param {vscode.TextDocument} document @param {vscode.Position} pos
 * @param {{steps: string[], searchByName: boolean}} options
 */
async function gather(document, pos, options) {
  const uri = document.uri;
  const queries = options.steps.map((step) => ask(step, uri, pos));
  if (options.searchByName) queries.push(byName(document, pos));

  const seen = new Map();
  for (const hit of (await Promise.all(queries)).flat()) {
    if (isHere(hit.loc, uri, pos)) continue;
    // Two sources pointing at one place is one destination. The first source in
    // the configured order gets to name it, which keeps a provider's label -
    // "Definition" - ahead of the name search's bare symbol name.
    if (!seen.has(key(hit))) seen.set(key(hit), hit);
  }
  return [...seen.values()];
}

/**
 * "Go to the body" is the move you want most of the time, and the body is the
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
    .map((hit) => ({ hit, header: HEADER.test(hit.loc.uri.path) ? 1 : 0, order: order(hit.kind) }))
    .sort((a, b) => a.header - b.header || a.order - b.order)
    .map((entry) => entry.hit);
}

/** @param {vscode.Location} loc */
function where(loc) {
  return `${vscode.workspace.asRelativePath(loc.uri)}:${loc.range.start.line + 1}`;
}

/**
 * Every row reads source-first, so the picker sorts by eye the way it sorts in
 * code. A provider row has nothing to add after its name - the location column
 * already says where it landed - while a name row does: two entries from the
 * index can differ only by which class they belong to, and Shape::area against
 * Circle::area is the whole distinction being offered.
 * @param {{kind: string, label?: string}} hit
 */
function describe(hit) {
  if (hit.kind === 'name') return `$(search) By name · ${hit.label}`;
  return `$(symbol-method) ${LABELS[hit.kind] || hit.kind}`;
}

/** @param {vscode.Location} loc */
async function reveal(loc) {
  const doc = await vscode.workspace.openTextDocument(loc.uri);
  const editor = await vscode.window.showTextDocument(doc);
  const start = loc.range.start;
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** @param {{kind: string, loc: vscode.Location}[]} hits @param {string} placeHolder */
async function pick(hits, placeHolder) {
  const chosen = await vscode.window.showQuickPick(
    hits.map((hit) => ({ label: describe(hit), description: where(hit.loc), hit })),
    { placeHolder, matchOnDescription: true },
  );
  return chosen && chosen.hit;
}

function settings() {
  const config = vscode.workspace.getConfiguration('assist.roundTrip');
  return {
    steps: config.get('providers', ['definition', 'implementation', 'declaration']),
    searchByName: config.get('searchByName', true),
    pickWhenAmbiguous: config.get('pickWhenAmbiguous', true),
  };
}

async function roundTrip() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const pos = editor.selection.active;
  const options = settings();

  const targets = ranked(await gather(editor.document, pos, options), options.steps);
  if (targets.length === 0) {
    vscode.window.setStatusBarMessage('$(circle-slash) Round trip: nowhere to go from here', 2000);
    return;
  }

  const target =
    targets.length > 1 && options.pickWhenAmbiguous
      ? await pick(targets, 'Round trip: several places answer to this name')
      : targets[0];
  if (target) await reveal(target.loc);
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
  const [search, ...answers] = await Promise.all([
    searchSymbols(document, pos),
    ...steps.map((step) => ask(step, uri, pos)),
  ]);
  // Kept unfiltered alongside the matches, because "the index found nothing"
  // and "the filter threw everything away" look identical from the outside and
  // want opposite fixes.
  const matched = search.symbols.filter((symbol) => carriesName(symbol, search.word));
  answers.push(matched.slice(0, MAX_BY_NAME).map(toNameHit));
  const sources = [...steps.map((step) => LABELS[step]), 'By name'];

  const items = [];
  answers.forEach((hits, i) => {
    if (hits.length === 0) {
      items.push({ label: `$(dash) ${sources[i]}`, description: 'no answer', hit: null });
      return;
    }
    for (const hit of hits) {
      const here = isHere(hit.loc, uri, pos);
      items.push({
        label: `${here ? '$(circle-slash)' : '$(arrow-right)'} ${sources[i]}`,
        description: `${where(hit.loc)}${hit.label ? `  ${hit.label}` : ''}`,
        detail: here ? 'dropped: this is where the cursor already is' : undefined,
        hit,
      });
    }
  });

  items.push({
    label: `$(info) Index: "${search.word}"`,
    description: `${search.symbols.length} returned, ${matched.length} matched the name`,
    detail:
      search.symbols.length > 0
        ? `returned: ${search.symbols.slice(0, 5).map((symbol) => symbol.name).join('  |  ')}`
        : 'the workspace symbol index answered nothing at all',
    hit: null,
  });

  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: `Round trip at ${where(new vscode.Location(uri, pos))} - what each source answered`,
    matchOnDescription: true,
  });
  if (chosen && chosen.hit) await reveal(chosen.hit.loc);
}

module.exports = {
  commands: {
    'assist.roundTrip': roundTrip,
    'assist.roundTrip.explain': explain,
  },
};
