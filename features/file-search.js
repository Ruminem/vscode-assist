// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');
const { fuzzyMatch, decorate } = require('./fuzzy');
const { readings } = require('./hangul');

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
const MAX_FILES = 20000;

// Build output nobody opens in an editor: what the compiler, the linker, Visual
// Studio and the packagers leave behind. VS Code's own picker lists these; this
// one does not, because an `.obj` beside every `.cpp` doubles the list and eats
// the cap above. Text stays whatever it is - `.md`, `.log`, `.map` - and so do
// images, which VS Code opens. `search.exclude` is where more goes.
// ponytail: a fixed list; a setting of its own only if someone needs one of
// these listed.
const BUILD_OUTPUT = [
  'obj', 'o', 'a', 'lib', 'so', 'dylib', 'dll', 'exe', 'pdb', 'ilk', 'idb', 'exp', 'pch', 'ipch', 'res',
  'tlog', 'lastbuildstate', 'sbr', 'bsc', 'ncb', 'sdf', 'suo', 'opendb',
  'class', 'jar', 'pyc', 'pyo', 'wasm',
  'zip', '7z', 'tar', 'gz', 'rar',
];

/**
 * The exclude pattern for `findFiles`: `search.exclude`, which that call does
 * not apply on its own, and the build output above, as one brace group.
 * `files.exclude` is not repeated here - VS Code applies it whenever the
 * pattern is not null (extHostWorkspace.ts, checked on main 2026-09-28).
 *
 * Entries turned off (`false`) are skipped, and so are the two shapes one glob
 * cannot hold: `{ "when": ... }` sibling rules, and keys with a brace group of
 * their own, because glob.ts closes a group at the first `}` it meets (line 156
 * on main, 2026-09-28) - nesting would break every pattern in the group.
 * Folder-level overrides of `search.exclude` in a multi-root window are not
 * read; the window's value is.
 * @param {Record<string, unknown> | undefined} searchExclude
 */
function excludeGlob(searchExclude) {
  const globs = Object.keys(searchExclude || {}).filter((key) => searchExclude[key] === true && !key.includes('{'));
  return `{${[...globs, ...BUILD_OUTPUT.map((ext) => `**/*.${ext}`)].join(',')}}`;
}

/**
 * Every file in the workspace, as paths to match against.
 *
 * `.gitignore` is not read: extHostWorkspace.ts hardcodes ignore files off for
 * this call, behind the opt-in `search.experimental.useIgnoreFilesInFindFiles`
 * (checked on main, 2026-09-28). With that on, VS Code honours it here as well.
 */
async function listFiles() {
  const started = Date.now();
  const exclude = excludeGlob(vscode.workspace.getConfiguration('search').get('exclude'));
  const uris = await vscode.workspace.findFiles('**/*', exclude, MAX_FILES);
  const files = uris
    // `true` keeps the folder name in front when the window has several roots,
    // which is the only thing telling two same-named files apart there.
    .map((uri) => ({ uri, path: vscode.workspace.asRelativePath(uri, true) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  trace(`file search: ${files.length} files in ${since(started)}${files.length === MAX_FILES ? ' (capped)' : ''}`);
  return files;
}

/**
 * Where the file name begins. A path outside the workspace comes back from
 * `asRelativePath` as an OS path, so a backslash counts as well as a slash.
 * @param {string} path
 */
const nameStart = (path) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;

/**
 * One piece of the query against one path.
 *
 * The file name is tried first, and a hit there lands in a tier above anything
 * the whole path can score. Only when the name misses is the path tried, so
 * `fda` still reaches `features/dot-arrow.js` by its folder - it just no longer
 * outranks a file whose own name holds the letters. A piece with a slash in it
 * is a path, and goes straight to the path.
 *
 * `nameOnly` is for the recently opened files: a folder name would match most
 * of them at once (`feat` against fifty files under `features/`), and they are
 * few enough for the name alone to tell them apart. Quick Open also wants the
 * letters adjacent there; this one does not, so the file just left still comes
 * first when it is typed as an abbreviation - fifty files hold little noise.
 * @param {string} piece @param {string} path @param {boolean} nameOnly
 */
function matchPiece(piece, path, nameOnly) {
  if (!/[\\/]/.test(piece)) {
    const cut = nameStart(path);
    const name = path.slice(cut);
    const hit = fuzzyMatch(piece, name);
    if (hit) {
      const tier = name.toLowerCase().startsWith(piece.toLowerCase()) ? NAME_PREFIX : IN_NAME;
      return { score: tier + hit.score, positions: hit.positions.map((i) => i + cut) };
    }
    if (nameOnly) return null;
  }
  return fuzzyMatch(piece, path);
}

/**
 * The whole query against one path, or null when any piece misses.
 *
 * The query is split on spaces and every piece has to match, in any order -
 * `dot js` finds `dot-arrow.js` - as Quick Open does. Each piece is tried in
 * every reading of it: two at most, and the second only when the piece holds
 * Hangul - the piece as typed, and the keys that produced it. Whichever scores
 * higher is the one shown, which means a Korean file name still matches as
 * itself and an English one typed with the input method on matches through its
 * keys - without this having to decide which the person meant.
 * @param {string} query @param {string} path @param {boolean} nameOnly
 * @returns {{score: number, positions: number[]} | null}
 */
function matchPath(query, path, nameOnly) {
  let score = 0;
  const positions = [];
  for (const piece of query.split(/\s+/).filter(Boolean)) {
    let found = null;
    for (const reading of readings(piece)) {
      const match = matchPiece(reading, path, nameOnly);
      if (match && (!found || match.score > found.score)) found = match;
    }
    if (!found) return null;
    score += found.score;
    positions.push(...found.positions);
  }
  return positions.length ? { score, positions } : null;
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
 * ponytail: a deleted or renamed file stays listed until pushed out by newer
 * ones, and opening it shows VS Code's own error; drop it on
 * onDidDeleteFiles/onDidRenameFiles if that turns out to happen often.
 */
function recentFiles() {
  const active = vscode.window.activeTextEditor;
  const skip = active ? active.document.uri.toString() : '';
  const keys = [...recent];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && isFile(tab.input.uri)) keys.push(tab.input.uri.toString());
    }
  }
  return [...new Set(keys)]
    .filter((key) => key !== skip)
    .map((key) => {
      const uri = vscode.Uri.parse(key);
      return { uri, path: vscode.workspace.asRelativePath(uri, true) };
    });
}

/**
 * @param {{uri: vscode.Uri, path: string}} file @param {number[]} positions
 * @param {string} section @param {number} rank Where the row sits, for the trace
 * line written when it is chosen.
 */
function row(file, positions, section, rank) {
  // Name first and folder after, as VS Code's own file picker lays it out: a row
  // too narrow for a deep path clips the folder, never the name. The matched
  // letters are split between the two so both still show what was hit.
  const cut = nameStart(file.path) - 1;
  return {
    label: `$(file) ${decorate(file.path.slice(cut + 1), positions.filter((i) => i > cut).map((i) => i - cut - 1))}`,
    description: cut > 0 ? decorate(file.path.slice(0, cut), positions.filter((i) => i < cut)) : undefined,
    uri: file.uri,
    section,
    rank,
    // The picker filters by label on its own, with a matcher that is not this
    // one - and the label's matched letters are bold look-alikes it cannot
    // read, so without this every row vanished the moment anything was typed.
    alwaysShow: true,
  };
}

async function searchFiles() {
  const picker = vscode.window.createQuickPick();
  picker.placeholder = vscode.l10n.t('Search files in the workspace');
  // VS Code would otherwise filter the list a second time with its own matcher,
  // over labels this extension has already decorated - it would throw away rows
  // that matched here. The same reason symbol search turns them off.
  picker.matchOnDescription = false;
  picker.matchOnDetail = false;
  // Without this the widget re-sorts the rows by its own label match while
  // anything is typed, and draws no separators at all then (quickInputList.ts,
  // filter(): "We don't render any separators if we're sorting"). The property
  // is a proposed API by name - absent from the stable vscode.d.ts as of
  // 2026-09-28 - but the extension host's setter has no proposal check and the
  // main thread copies it through, so plain JavaScript reaches it. Guarded so
  // that the day it is gated, the list falls back to how it was: in this
  // order, with the two sections unlabelled.
  try {
    /** @type {any} */ (picker).sortByLabel = false;
  } catch {
    // Left as it was.
  }
  picker.busy = true;
  picker.show();

  let files = [];
  const loading = listFiles().then((found) => {
    files = found;
    picker.busy = false;
    return found;
  });

  // Read once per opening: the tabs and the history do not change while the
  // picker is up, and it is on screen before the file list has loaded.
  const recents = recentFiles();

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
      picker.items = recents.length
        ? recents.map((file, i) => row(file, [], 'recent', i + 1))
        : files.slice(0, MAX_ITEMS).map((file, i) => row(file, [], 'all', i + 1));
      return;
    }

    const recentHits = [];
    for (const file of recents) {
      const match = matchPath(query, file.path, true);
      if (match) recentHits.push({ file, match });
    }
    // Stable, so recency breaks a tie.
    recentHits.sort((a, b) => b.match.score - a.match.score);

    const shown = new Set(recentHits.map(({ file }) => file.uri.toString()));
    const scored = [];
    for (const file of files) {
      const match = matchPath(query, file.path, false);
      if (match && !shown.has(file.uri.toString())) scored.push({ file, match });
    }
    // A name match scores the name alone, so the three `README.md` of a
    // repository tie; the shorter path, the one nearer the root, goes first.
    scored.sort((a, b) => b.match.score - a.match.score || a.file.path.length - b.file.path.length);

    const items = [];
    if (recentHits.length) {
      items.push(separator(vscode.l10n.t('recently opened')));
      items.push(...recentHits.map(({ file, match }, i) => row(file, match.positions, 'recent', i + 1)));
    }
    if (scored.length) {
      items.push(separator(vscode.l10n.t('file results')));
      items.push(...scored.slice(0, MAX_ITEMS).map(({ file, match }, i) => row(file, match.positions, 'files', i + 1)));
    }
    picker.items = items;
    trace(
      `file search: "${query}" matched ${recentHits.length} recent and ${scored.length} of ${files.length} in ${since(started)}`,
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
    accepted = true;
    picker.hide();
    if (!chosen || !chosen.uri) return;
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
  matchPath,
  excludeGlob,
};
