// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');
const { fuzzyMatch, decorate } = require('./fuzzy');
const { readings } = require('./hangul');

// A list longer than this is not being read, it is being scrolled.
const MAX_ITEMS = 200;

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
 * The best score this query reaches on this path, over every reading of it.
 *
 * Two readings at most, and the second only when the query holds Hangul: the
 * query as typed, and the keys that produced it. Whichever scores higher is the
 * one shown, which means a Korean file name still matches as itself and an
 * English one typed with the input method on matches through its keys - without
 * this having to decide which the person meant.
 * @param {string[]} queries @param {string} path
 */
function best(queries, path) {
  let found = null;
  for (const query of queries) {
    const match = fuzzyMatch(query, path);
    if (match && (!found || match.score > found.score)) found = match;
  }
  return found;
}

/** @param {{uri: vscode.Uri, path: string}} file @param {number[]} positions */
function row(file, positions) {
  const cut = file.path.lastIndexOf('/');
  return {
    label: `$(file) ${decorate(file.path, positions)}`,
    // The folder again, undecorated and dimmed, so a path too long for the row
    // still shows where it lives when the label is clipped.
    description: cut > 0 ? file.path.slice(0, cut) : undefined,
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

  /** Rows for the current query, or the start of the list when there is none. */
  const refresh = () => {
    const query = picker.value.trim();
    const started = Date.now();
    if (!query) {
      picker.items = files.slice(0, MAX_ITEMS).map((file) => row(file, []));
      return;
    }
    const queries = readings(query);
    const scored = [];
    for (const file of files) {
      const match = best(queries, file.path);
      if (match) scored.push({ file, match });
    }
    scored.sort((a, b) => b.match.score - a.match.score);
    picker.items = scored.slice(0, MAX_ITEMS).map(({ file, match }) => row(file, match.positions));
    trace(
      `file search: "${query}"${queries.length > 1 ? ` (also "${queries[1]}")` : ''} ` +
        `matched ${scored.length} of ${files.length} in ${since(started)}`,
    );
  };

  picker.onDidChangeValue(refresh);
  loading.then(refresh);

  picker.onDidAccept(async () => {
    const chosen = /** @type {{uri?: vscode.Uri}} */ (picker.selectedItems[0]);
    picker.hide();
    if (chosen && chosen.uri) await vscode.window.showTextDocument(chosen.uri);
  });
  picker.onDidHide(() => picker.dispose());
}

module.exports = {
  commands: {
    'assist.searchFiles': searchFiles,
  },
};
