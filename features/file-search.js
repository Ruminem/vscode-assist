// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');
const { fuzzyMatch, exactMatch, decorate } = require('./fuzzy');
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

/**
 * Every file in the workspace, as paths to match against.
 *
 * `undefined` for the exclude pattern is what asks VS Code to apply the
 * excludes already configured - `files.exclude` and `search.exclude` - so
 * `node_modules` and build output stay out without this extension keeping its
 * own opinion about what they are called. Passing `null` would be the
 * everything-included reading; the difference is worth the comment because the
 * two look alike and only one of them is bearable in a real repository.
 */
async function listFiles() {
  const started = Date.now();
  const uris = await vscode.workspace.findFiles('**/*', undefined, MAX_FILES);
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
 * `contiguous` is for the recently opened files, which Quick Open matches with
 * the letters adjacent and in the name only. They are few and already known, so
 * a loose match there is noise.
 * @param {string} piece @param {string} path @param {boolean} contiguous
 */
function matchPiece(piece, path, contiguous) {
  const match = contiguous ? exactMatch : fuzzyMatch;
  if (!/[\\/]/.test(piece)) {
    const cut = nameStart(path);
    const name = path.slice(cut);
    const hit = match(piece, name);
    if (hit) {
      const tier = name.toLowerCase().startsWith(piece.toLowerCase()) ? NAME_PREFIX : IN_NAME;
      return { score: tier + hit.score, positions: hit.positions.map((i) => i + cut) };
    }
    if (contiguous) return null;
  }
  return match(piece, path);
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
 * @param {string} query @param {string} path @param {boolean} contiguous
 * @returns {{score: number, positions: number[]} | null}
 */
function matchPath(query, path, contiguous) {
  let score = 0;
  const positions = [];
  for (const piece of query.split(/\s+/).filter(Boolean)) {
    let found = null;
    for (const reading of readings(piece)) {
      const match = matchPiece(reading, path, contiguous);
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

/** @param {{uri: vscode.Uri, path: string}} file @param {number[]} positions */
function row(file, positions) {
  // Name first and folder after, as VS Code's own file picker lays it out: a row
  // too narrow for a deep path clips the folder, never the name. The matched
  // letters are split between the two so both still show what was hit.
  const cut = nameStart(file.path) - 1;
  return {
    label: `$(file) ${decorate(file.path.slice(cut + 1), positions.filter((i) => i > cut).map((i) => i - cut - 1))}`,
    description: cut > 0 ? decorate(file.path.slice(0, cut), positions.filter((i) => i < cut)) : undefined,
    uri: file.uri,
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
   * Two sections, as Quick Open has them: the recently opened files matched
   * with the letters adjacent, then every other file matched loosely. With no
   * query the recent section is the whole list; the start of the alphabet is
   * shown only when there is nothing recent at all.
   */
  const refresh = () => {
    const query = picker.value.trim();
    const started = Date.now();
    const separator = (label) => ({ label, kind: vscode.QuickPickItemKind.Separator });

    if (!query) {
      picker.items = recents.length
        ? recents.map((file) => row(file, []))
        : files.slice(0, MAX_ITEMS).map((file) => row(file, []));
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
      items.push(...recentHits.map(({ file, match }) => row(file, match.positions)));
    }
    if (scored.length) {
      items.push(separator(vscode.l10n.t('file results')));
      items.push(...scored.slice(0, MAX_ITEMS).map(({ file, match }) => row(file, match.positions)));
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

  picker.onDidAccept(async () => {
    const chosen = /** @type {{uri?: vscode.Uri}} */ (picker.selectedItems[0]);
    picker.hide();
    if (chosen && chosen.uri) await vscode.window.showTextDocument(chosen.uri);
  });
  picker.onDidHide(() => picker.dispose());
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
};
