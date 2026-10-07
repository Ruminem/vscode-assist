// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { spawn } = require('child_process');
const { trace, since } = require('./trace');
const { pickerAnchors, wordStarts, inOrder, fit, mentionsTest } = require('./fuzzy');
const { readings } = require('./hangul');
const { ripgrep } = require('./text-guess');

// A list longer than this is not being read, it is being scrolled.
const MAX_ITEMS = 200;

// How many recently opened files are remembered per workspace. Quick Open's own
// history is longer, but past a few dozen the list is scrolled, not read.
const MAX_RECENT = 50;
const RECENT_KEY = 'assist.fileSearch.recent';

// The ordering follows Quick Open's (src/vs/base/common/fuzzyScorer.ts and
// src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts in
// microsoft/vscode, MIT): a match in the file name always outranks a match that
// needs the folders, and a name that starts with the query outranks both. The
// tiers are far enough apart that no letter score crosses one. The structure is
// taken, not the code - the letter scores are still this extension's own.
const IN_NAME = 1e6;
const NAME_PREFIX = 2e6;

// How many paths are held at once. A workspace larger than this is one where
// the whole point is to type rather than to scroll, and the row at the end says
// the list was cut so that a missing file is never a silent one.
//
// Measured on a Linux container, 2026-10-08, paths from four repositories:
// at 50,000 a first letter took 64-98 ms and the heaviest query tried (`src
// ts`, two pieces, 34,000 hits) 100-165 ms - about what 20,000 cost before the
// matcher kept its word starts, 140-155 ms at worst. The list then holds about
// 40 MB while the picker is open. At 100,000 both doubled, 150-370 ms and 80
// MB. Raise it if a workspace needs more and a keystroke can afford it.
const MAX_FILES = 50000;

/**
 * ripgrep's arguments for listing one folder: what Quick Open hands it
 * (ripgrepFileSearch.ts, getRgArgs, main 2026-09-28), less what a plain
 * listing has no use for. So the list here is the list there - hidden files
 * in; `.gitignore`, `.ignore` and `.git/info/exclude` honoured, which is what
 * keeps build output and a worktree under `.claude/` out; the three
 * `search.use*IgnoreFiles` settings and `search.followSymlinks` read the same
 * way. What counts as build output is the project's own `.gitignore` to say,
 * not a list kept here.
 *
 * Both exclude settings are turned into globs, since nothing applies them to a
 * binary run by hand. A `{ "when": ... }` sibling rule is skipped, and a key
 * that starts with neither `**` nor `/` is anchored to the folder root, as VS
 * Code anchors it - to ripgrep a bare `build` would mean "anywhere".
 * @param {Record<string, unknown>} exclude `files.exclude` and `search.exclude`, merged
 * @param {{useIgnoreFiles: boolean, useParentIgnoreFiles: boolean, useGlobalIgnoreFiles: boolean, followSymlinks: boolean}} search
 */
function rgArgs(exclude, search) {
  const args = ['--files', '--hidden', '--no-require-git', '--no-config'];
  for (const key of Object.keys(exclude)) {
    if (exclude[key] !== true) continue;
    const glob = key.replace(/[\\/]+$/, '');
    args.push('-g', `!${/^(\*\*|\/)/.test(glob) ? glob : `/${glob}`}`);
  }
  if (!search.useIgnoreFiles) args.push('--no-ignore');
  else if (!search.useParentIgnoreFiles) args.push('--no-ignore-parent');
  if (!search.useGlobalIgnoreFiles) args.push('--no-ignore-global');
  if (search.followSymlinks) args.push('--follow');
  return args;
}

/**
 * One folder's files from ripgrep, relative to it, at most `limit` of them -
 * read as they arrive and stopped the moment there are enough, since a monorepo
 * lists far more than the cap. A ripgrep that fails (a glob it cannot parse,
 * say) leaves its first line of complaint in the trace and nothing else.
 * @param {string} rg @param {string[]} args @param {string} cwd @param {number} limit
 * @returns {Promise<string[]>}
 */
function list(rg, args, cwd, limit) {
  return new Promise((resolve) => {
    const lines = [];
    let rest = '';
    let error = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (error.trim()) trace(`file search: ripgrep: ${error.trim().split('\n')[0]}`);
      resolve(lines.slice(0, limit));
    };
    const child = spawn(rg, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop();
      for (const part of parts) lines.push(part);
      if (lines.length >= limit) child.kill();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.on('error', (e) => {
      error += e.message;
      finish();
    });
    child.on('close', finish);
  });
}

/**
 * Every file in the workspace, as paths to match against - what Quick Open
 * lists, from the ripgrep VS Code ships (text-guess.js finds it). The API for
 * this, findFiles, reads neither `.gitignore` nor `search.exclude`
 * (extHostWorkspace.ts, main 2026-09-28) and so listed every `.obj` under a
 * build folder. Each root is listed with its own settings, which is where a
 * multi-root window keeps folder-level excludes.
 *
 * `cut` says the list stopped at MAX_FILES - or, for a workspace of exactly
 * that many, that it may have.
 * @returns {Promise<{files: ReturnType<typeof prepare>[], cut: boolean}>}
 */
async function listFiles() {
  const started = Date.now();
  const rg = ripgrep();
  if (!rg) trace(`file search: no ripgrep under ${vscode.env.appRoot}`);
  const files = [];
  let builds = 0;
  for (const folder of vscode.workspace.workspaceFolders || []) {
    if (!rg || files.length >= MAX_FILES) break;
    const search = vscode.workspace.getConfiguration('search', folder.uri);
    const exclude = { ...vscode.workspace.getConfiguration('files', folder.uri).get('exclude', {}), ...search.get('exclude', {}) };
    const args = rgArgs(exclude, {
      useIgnoreFiles: search.get('useIgnoreFiles', true),
      useParentIgnoreFiles: search.get('useParentIgnoreFiles', false),
      useGlobalIgnoreFiles: search.get('useGlobalIgnoreFiles', false),
      followSymlinks: search.get('followSymlinks', true),
    });
    const rels = await list(rg, args, folder.uri.fsPath, MAX_FILES - files.length);
    const mine = rels.map((rel) => {
      const uri = vscode.Uri.joinPath(folder.uri, rel);
      // `true` keeps the folder name in front when the window has several roots,
      // which is the only thing telling two same-named files apart there.
      return prepare(vscode.workspace.asRelativePath(uri, true), uri);
    });
    cmakeBuilds(mine, rels);
    for (const file of mine) {
      if (file.build) builds++;
      files.push(file);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const cut = files.length >= MAX_FILES;
  trace(`file search: ${files.length} files, ${builds} under a CMake build folder, in ${since(started)}${cut ? ' (capped)' : ''}`);
  return { files, cut };
}

/**
 * Where the file name begins. A path outside the workspace comes back from
 * `asRelativePath` as an OS path, so a backslash counts as well as a slash.
 * @param {string} path
 */
const nameStart = (path) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;

/**
 * A path made ready to be matched many times: lowered once, and its word starts
 * worked out the first time a query gets far enough to need them. Most paths
 * never pass the in-order test on a given query, so most never need them.
 * `test` waits the same way, for the first time the path is a hit; `build` is
 * set by the list (cmakeBuilds).
 * @param {string} path @param {vscode.Uri} [uri]
 */
function prepare(path, uri) {
  const name = path.slice(nameStart(path));
  return {
    uri,
    path,
    name,
    lname: name.toLowerCase(),
    lpath: path.toLowerCase(),
    /** @type {Uint8Array | null | undefined} */ nameAnchors: undefined,
    /** @type {Uint8Array | null | undefined} */ pathAnchors: undefined,
    /** @type {Uint8Array | undefined} */ pathStarts: undefined,
    /** @type {boolean | undefined} */ test: undefined,
    build: false,
  };
}

/**
 * The query, split on spaces into pieces, each piece in every reading of it -
 * two at most, and the second only when the piece holds Hangul: the piece as
 * typed, and the keys that produced it. Lowered, and marked when it holds a
 * slash. Done once a keystroke rather than once a path.
 * @param {string} query
 */
const compile = (query) =>
  query
    .split(/\s+/)
    .filter(Boolean)
    .map((piece) => readings(piece).map((reading) => ({ q: reading.toLowerCase(), slash: /[\\/]/.test(reading) })));

/**
 * One reading of one piece against one path.
 *
 * The file name is tried first, and a hit there lands in a tier above anything
 * the whole path can score. Only when the name misses is the path tried, so
 * `fda` still reaches `features/dot-arrow.js` by its folder - it just no longer
 * outranks a file whose own name holds the letters.
 *
 * Both are the anchored kind of match - letters at word starts or in a run -
 * because those are the only fits the picker highlights (searchFiles says why
 * it cannot be told ours). A row the picker would show unmarked is a row the
 * person cannot tell from noise, so it is not shown at all. What that gives up
 * is the consonant skeleton, `fzy` for fuzzy.js; Quick Open still takes it.
 *
 * A piece with a slash in it is a path, and goes straight to the path, matched
 * the loose way: the picker cannot mark a folder and a name together whatever
 * the fit, and `feat/dot` needs its slash to land after an abbreviated folder.
 *
 * `nameOnly` is for the recently opened files: a folder name would match most
 * of them at once (`feat` against fifty files under `features/`), and they are
 * few enough for the name alone to tell them apart. Quick Open also wants the
 * letters adjacent there; this one does not, so the file just left still comes
 * first when it is typed as an abbreviation - fifty files hold little noise.
 * @param {{q: string, slash: boolean}} piece @param {ReturnType<typeof prepare>} file @param {boolean} nameOnly
 * @returns {number | null}
 */
function matchPiece({ q, slash }, file, nameOnly) {
  if (slash) {
    if (!inOrder(q, file.lpath)) return null;
    if (file.pathStarts === undefined) file.pathStarts = wordStarts(file.path);
    return fit(q, file.lpath, file.path.length, file.pathStarts, false);
  }
  if (inOrder(q, file.lname)) {
    if (file.nameAnchors === undefined) file.nameAnchors = pickerAnchors(file.name);
    const score = fit(q, file.lname, file.name.length, file.nameAnchors, true);
    if (score !== null) return (file.lname.startsWith(q) ? NAME_PREFIX : IN_NAME) + score;
  }
  if (nameOnly || !inOrder(q, file.lpath)) return null;
  if (file.pathAnchors === undefined) file.pathAnchors = pickerAnchors(file.path);
  return fit(q, file.lpath, file.path.length, file.pathAnchors, true);
}

/**
 * The whole query against one path, or null when any piece misses.
 *
 * Every piece has to match, in any order - `dot js` finds `dot-arrow.js` - as
 * Quick Open does. Of a piece's readings, whichever scores higher counts, which
 * means a Korean file name still matches as itself and an English one typed
 * with the input method on matches through its keys - without this having to
 * decide which the person meant.
 * @param {ReturnType<typeof compile>} pieces @param {ReturnType<typeof prepare>} file @param {boolean} nameOnly
 * @returns {number | null}
 */
function scoreFile(pieces, file, nameOnly) {
  if (!pieces.length) return null;
  let total = 0;
  for (const piece of pieces) {
    let found = null;
    for (const reading of piece) {
      const score = matchPiece(reading, file, nameOnly);
      if (score !== null && (found === null || score > found)) found = score;
    }
    if (found === null) return null;
    total += found;
  }
  return total;
}

/**
 * scoreFile for one query and one path, for tools/check-fuzzy.js.
 * @param {string} query @param {string} path @param {boolean} nameOnly
 */
const matchPath = (query, path, nameOnly) => scoreFile(compile(query), prepare(path), nameOnly);

/**
 * Whether a query only adds to the last one, so that nothing the last one
 * missed can match it and the next pass can start from the last one's hits.
 * Every kind of fit here survives losing letters off its end, and an added
 * piece is one more thing to match. A slash typed is the exception: it turns a
 * piece from the anchored match into the loose one, which takes fits the
 * anchored one refused - `fe/` lands on `fxe/` where `fe` could not.
 * @param {string} last @param {string} query
 */
const narrows = (last, query) => query.startsWith(last) && !/[\\/]/.test(query.slice(last.length));

/**
 * The file results in the order shown: files under a CMake build folder last,
 * then test files (fuzzy.js, mentionsTest) unless the query asks for them,
 * then by score, then the shorter path - a name match scores the name alone,
 * so the three `README.md` of a repository tie and the one nearer the root
 * goes first.
 *
 * Asking means "test" typed whole, in any reading of the query, so `ㅅㄷㄴㅅ`
 * asks too. Lowered rather than left out: `tes` is a query on its way to
 * `test`, and a list that emptied out under it would look broken. Build
 * output is lowered for the same reason, and nothing lifts it - its names are
 * the names of the sources it was built from.
 *
 * The recent section is not sorted this way. Those files were opened by hand,
 * a test file or a build file among them too.
 * @template {{file: {path: string, test?: boolean, build?: boolean}, score: number}} T
 * @param {string} query @param {T[]} hits
 */
function sortResults(query, hits) {
  const asked = readings(query).some((reading) => /test/i.test(reading));
  const down = (file) => {
    if (file.build) return 2;
    if (asked) return 0;
    if (file.test === undefined) file.test = mentionsTest(file.path);
    return file.test ? 1 : 0;
  };
  // On the hit rather than in a Map: a one-letter query sorts the whole list,
  // and a lookup per comparison is a cost that sort does not need.
  for (const hit of hits) hit.down = down(hit.file);
  return hits.sort((a, b) => a.down - b.down || b.score - a.score || a.file.path.length - b.file.path.length);
}

/**
 * Marks the files under a CMake build folder - one holding a CMakeCache.txt,
 * which CMake writes into every build folder it configures and nowhere else.
 * Those folders are listed when nothing ignores them (a build-a beside the
 * build/ a .gitignore names), and their object files and generated sources
 * share the names of the real ones.
 *
 * A cache at the root of a workspace folder is an in-source build: the sources
 * are the build folder there, and nothing is marked. One in a subfolder is
 * taken as a build folder even if it is an in-source build of a subproject;
 * its sources are then lowered too, not lost.
 * @param {ReturnType<typeof prepare>[]} files One workspace folder's, with `rel` relative to it
 * @param {string[]} rels
 */
function cmakeBuilds(files, rels) {
  const roots = [];
  for (const rel of rels) {
    const cut = nameStart(rel);
    if (cut > 0 && rel.slice(cut) === 'CMakeCache.txt') roots.push(rel.slice(0, cut).replace(/\\/g, '/'));
  }
  if (!roots.length) return;
  rels.forEach((rel, i) => {
    const at = rel.replace(/\\/g, '/');
    if (roots.some((root) => at.startsWith(root))) files[i].build = true;
  });
}

/**
 * Recently opened files, newest first, as uri strings. Held here and written
 * through to workspaceState, because VS Code keeps its own editor history to
 * itself - vscode.d.ts has no way to read it (checked on main, 2026-09-28).
 * @type {string[]}
 */
let recent = [];
/** @type {vscode.Memento | undefined} */
let store;

/**
 * Only files a file search could have found. Untitled buffers, diff views and
 * output panes have their own schemes; `vscode-remote` is a file on the other
 * end of an SSH or container window.
 * @param {vscode.Uri} uri
 */
const isFile = (uri) => uri.scheme === 'file' || uri.scheme === 'vscode-remote';

/** @param {vscode.TextEditor | undefined} editor */
function remember(editor) {
  if (!editor || !isFile(editor.document.uri)) return;
  const key = editor.document.uri.toString();
  if (recent[0] === key) return;
  recent = [key, ...recent.filter((k) => k !== key)].slice(0, MAX_RECENT);
  if (store) store.update(RECENT_KEY, recent);
}

/**
 * The recent section's files: the remembered ones, then whatever else is open
 * in a tab - so a fresh install, with nothing remembered yet, still starts with
 * something. The file being edited is left out; opening it again goes nowhere,
 * and leaving it out makes `Alt+E` `Enter` a step back to the previous file.
 *
 * A file that is gone - deleted or renamed, in VS Code or outside it - is left
 * out and forgotten. Each one is looked up on every opening rather than
 * dropped on onDidDeleteFiles, which hears only what VS Code itself deleted,
 * not a terminal or git.
 */
async function recentFiles() {
  const active = vscode.window.activeTextEditor;
  const skip = active ? active.document.uri.toString() : '';
  const keys = [...recent];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && isFile(tab.input.uri)) keys.push(tab.input.uri.toString());
    }
  }
  const files = [...new Set(keys)].filter((key) => key !== skip).map((key) => ({ key, uri: vscode.Uri.parse(key) }));
  const there = await Promise.all(files.map(({ uri }) => vscode.workspace.fs.stat(uri).then(() => true, () => false)));
  const gone = new Set(files.filter((_, i) => !there[i]).map(({ key }) => key));
  if (gone.size) {
    recent = recent.filter((key) => !gone.has(key));
    if (store) store.update(RECENT_KEY, recent);
  }
  return files
    .filter(({ key }) => !gone.has(key))
    .map(({ uri }) => ({ uri, path: vscode.workspace.asRelativePath(uri, true) }));
}

/**
 * @param {{uri: vscode.Uri, path: string}} file
 * @param {string} section @param {number} rank Where the row sits, for the trace
 * line written when it is chosen.
 */
function row(file, section, rank) {
  // Name first and folder after, as VS Code's own file picker lays it out: a row
  // too narrow for a deep path clips the folder, never the name.
  const cut = nameStart(file.path) - 1;
  return {
    label: `$(file) ${file.path.slice(cut + 1)}`,
    description: cut > 0 ? file.path.slice(0, cut) : undefined,
    uri: file.uri,
    section,
    rank,
    // The picker filters by label on its own, with a matcher that is not this
    // one; without this every row vanished the moment anything was typed.
    alwaysShow: true,
  };
}

async function searchFiles() {
  const picker = vscode.window.createQuickPick();
  picker.placeholder = vscode.l10n.t('Search files in the workspace');
  // The highlighted letters are the widget's own: it marks what its matcher
  // finds in the label and, with this on, in the folder - a prefix, letters at
  // word starts (`ckjs` on check-keys.js), or a run (filters.ts,
  // fuzzyContiguousFilter). That is the bold-and-coloured highlight of VS
  // Code's own pickers. An extension cannot hand over letters of its own -
  // TransferQuickPickItem carries no highlights (extHostQuickOpen.ts,
  // 2026-09-28) - and the bold look-alike glyphs the labels used to carry were
  // too faint to read. So matchPiece only makes the fits the widget can draw.
  // What still shows unmarked: a Hangul reading of the query, a match split
  // across folder and name, and the pieces of a query with spaces in it.
  picker.matchOnDescription = true;
  picker.matchOnDetail = false;
  // Without this the widget re-sorts the rows by its own label match while
  // anything is typed, and draws no separators at all then (quickInputList.ts,
  // filter(): "We don't render any separators if we're sorting"). The property
  // is a proposed API by name - absent from the stable vscode.d.ts as of
  // 2026-09-28 - but the extension host's setter has no proposal check and the
  // main thread copies it through, so plain JavaScript reaches it. Guarded; the
  // day it is gated the widget sorts its own matches to the top and draws no
  // separators. The word joiners that once left it nothing to match went with
  // the look-alikes - they also left it nothing to highlight.
  try {
    /** @type {any} */ (picker).sortByLabel = false;
  } catch {
    // Left as it was.
  }
  picker.busy = true;
  picker.show();

  let files = [];
  let cut = false;
  const loading = listFiles().then((found) => {
    ({ files, cut } = found);
    picker.busy = false;
  });

  // Read once per opening: the tabs and the history do not change while the
  // picker is up. Looking each one up takes milliseconds, well before the file
  // list has loaded.
  const recents = (await recentFiles()).map(({ uri, path }) => prepare(path, uri));

  // A file missing from a list that was cut is never a silent one. Not a file:
  // choosing it leaves the picker open (onDidAccept).
  const cutRow = () => ({
    label: `$(warning) ${vscode.l10n.t('Listing stopped at {0} files. The rest of the workspace is not searched.', MAX_FILES)}`,
    alwaysShow: true,
  });

  // The last query and the files it matched, in list order. A query that only
  // adds to it (narrows) is matched against those alone - typing `quick` scores
  // the whole list once, at `q`, and a handful of hits after that.
  /** @type {{query: string, from: typeof files, matched: typeof files} | null} */
  let last = null;

  /**
   * Two sections, as Quick Open has them: the recently opened files matched by
   * name alone, then every other file. With no query the recent section is the
   * whole list; the start of the alphabet is shown only when there is nothing
   * recent at all.
   */
  const refresh = () => {
    const query = picker.value.trim();
    const started = Date.now();
    const separator = (label) => ({ label, kind: vscode.QuickPickItemKind.Separator });

    if (!query) {
      last = null;
      picker.items = recents.length
        ? recents.map((file, i) => row(file, 'recent', i + 1))
        : [...files.slice(0, MAX_ITEMS).map((file, i) => row(file, 'all', i + 1)), ...(cut ? [cutRow()] : [])];
      return;
    }

    const pieces = compile(query);
    const recentHits = [];
    for (const file of recents) {
      const score = scoreFile(pieces, file, true);
      if (score !== null) recentHits.push({ file, score });
    }
    // Stable, so recency breaks a tie.
    recentHits.sort((a, b) => b.score - a.score);

    // The list order is kept in `matched`, so a narrowed pass ties the way a
    // whole one would.
    const reuse = last !== null && last.from === files && narrows(last.query, query);
    const pool = reuse ? last.matched : files;
    const shown = new Set(recentHits.map(({ file }) => file.uri.toString()));
    const matched = [];
    const hits = [];
    for (const file of pool) {
      const score = scoreFile(pieces, file, false);
      if (score === null) continue;
      matched.push(file);
      if (!shown.has(file.uri.toString())) hits.push({ file, score });
    }
    last = { query, from: files, matched };
    sortResults(query, hits);

    const items = [];
    if (recentHits.length) {
      items.push(separator(vscode.l10n.t('recently opened')));
      items.push(...recentHits.map(({ file }, i) => row(file, 'recent', i + 1)));
    }
    if (hits.length) {
      items.push(separator(vscode.l10n.t('file results')));
      items.push(...hits.slice(0, MAX_ITEMS).map(({ file }, i) => row(file, 'files', i + 1)));
    }
    if (cut) items.push(cutRow());
    picker.items = items;
    trace(
      `file search: "${query}" matched ${recentHits.length} recent and ${hits.length} of ${pool.length}` +
        `${reuse ? ' (narrowed from the last query)' : ''} in ${since(started)}`,
    );
  };

  picker.onDidChangeValue(refresh);
  // The recent section needs no file list, so it is up before the list loads.
  refresh();
  loading.then(refresh);

  // Which row was taken, from which section, and for what query - or that the
  // picker was closed without one. Read back after a few days of use, these
  // lines say whether the ordering above is right for the person typing; they
  // are the measurement the ordering was otherwise going to be guessed from.
  let accepted = false;
  picker.onDidAccept(async () => {
    const chosen = /** @type {{uri?: vscode.Uri, section?: string, rank?: number}} */ (picker.selectedItems[0]);
    const query = picker.value.trim();
    // The row saying the list was cut: nothing to open, and no reason to close.
    if (chosen && !chosen.uri) return;
    accepted = true;
    picker.hide();
    if (!chosen) return;
    trace(`file search: "${query}" chose #${chosen.rank} of ${chosen.section}`);
    await vscode.window.showTextDocument(chosen.uri);
  });
  picker.onDidHide(() => {
    if (!accepted) trace(`file search: "${picker.value.trim()}" dismissed`);
    picker.dispose();
  });
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  store = context.workspaceState;
  recent = store.get(RECENT_KEY, []);
  remember(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(remember));
}

module.exports = {
  activate,
  commands: {
    'assist.searchFiles': searchFiles,
  },
  // For tools/check-fuzzy.js.
  prepare,
  compile,
  scoreFile,
  matchPath,
  narrows,
  sortResults,
  cmakeBuilds,
  rgArgs,
  recentFiles,
};
