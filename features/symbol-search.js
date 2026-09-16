// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');

// Indexed by vscode.SymbolKind, which is a plain 0..25 enum.
const KIND_ICONS = [
  'symbol-file', 'symbol-module', 'symbol-namespace', 'symbol-package', 'symbol-class',
  'symbol-method', 'symbol-property', 'symbol-field', 'symbol-constructor', 'symbol-enum',
  'symbol-interface', 'symbol-function', 'symbol-variable', 'symbol-constant', 'symbol-string',
  'symbol-number', 'symbol-boolean', 'symbol-array', 'symbol-object', 'symbol-key',
  'symbol-null', 'symbol-enum-member', 'symbol-struct', 'symbol-event', 'symbol-operator',
  'symbol-type-parameter',
];

// A list longer than this is not being read, it is being scrolled.
const MAX_ITEMS = 200;

/**
 * Servers disagree on what a symbol's name is. clangd answers "totalArea";
 * cpptools answers "totalArea(const Shape **, int)" and adds a localised
 * "(declaration)" marker on the header entry. Matching happens on what is
 * left before the first paren, so both read the same.
 * @param {string} name
 */
function bareName(name) {
  return (name || '').split('(')[0].trim();
}

/** @param {string} text @param {number} i */
function startsWord(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  const here = text[i];
  return prev === '_' || prev === ':' || (prev === prev.toLowerCase() && here !== here.toLowerCase());
}

/**
 * Every character of the query, in order, anywhere in the name - so "ce" finds
 * Circle. That is the match clangd will not make on its own: it only matches at
 * the start of the name or at word starts, and answers "ce" with nothing.
 * Scored so the names a person meant come first: runs of adjacent characters,
 * characters that start a word, and shorter names.
 *
 * Of all the ways the query fits into a name, the best-scoring one is kept, not
 * the first one found. It matters because the positions are shown in bold: taking
 * the first "a" after the "t" of totalArea marks the "a" inside "total", where
 * anyone typing "ta" meant the t and the A. One pass per query character keeps
 * the best score for every place that character could land, which is length of
 * query times length of name - small at symbol-name sizes.
 * @param {string} query @param {string} name
 * @returns {{score: number, positions: number[]} | null}
 */
function fuzzyMatch(query, name) {
  const q = query.toLowerCase();
  const t = name.toLowerCase();
  const n = t.length;
  if (!q.length || q.length > n) return null;

  let prev = [];
  const back = [];
  for (let j = 0; j < q.length; j++) {
    const cur = new Array(n).fill(-Infinity);
    const link = new Array(n).fill(-1);
    // The best score among earlier characters that ended at least two places
    // back - landing right after one of those is not a run.
    let apart = -Infinity;
    let apartAt = -1;
    for (let i = 0; i < n; i++) {
      if (j > 0 && i >= 2 && prev[i - 2] > apart) {
        apart = prev[i - 2];
        apartAt = i - 2;
      }
      if (t[i] !== q[j]) continue;
      const gain = 1 + (startsWord(name, i) ? 2 : 0);
      if (j === 0) {
        cur[i] = gain;
        continue;
      }
      const run = i >= 1 ? prev[i - 1] + 3 : -Infinity;
      if (run === -Infinity && apart === -Infinity) continue;
      // A tie goes to the run.
      if (run >= apart) {
        cur[i] = run + gain;
        link[i] = i - 1;
      } else {
        cur[i] = apart + gain;
        link[i] = apartAt;
      }
    }
    back.push(link);
    prev = cur;
  }

  let end = -1;
  for (let i = 0; i < n; i++) if (prev[i] > -Infinity && (end < 0 || prev[i] > prev[end])) end = i;
  if (end < 0) return null;

  const positions = new Array(q.length);
  for (let j = q.length - 1, i = end; j >= 0; j--) {
    positions[j] = i;
    i = back[j][i];
  }
  return { score: prev[end] - name.length / 100, positions };
}

/**
 * With fuzzy off the query has to appear as typed, letters adjacent, ignoring
 * case. An earlier position ranks higher, a name that starts with it highest.
 * @param {string} query @param {string} name
 * @returns {{score: number, positions: number[]} | null}
 */
function exactMatch(query, name) {
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return null;
  return { score: 100 - i - name.length / 100, positions: Array.from(query, (_, k) => i + k) };
}

// Put between every character of a label. Invisible, and it keeps VS Code from
// finding any run of the query in the label to highlight on its own.
const JOINER = '⁠';

/**
 * VS Code gives an extension no say in which letters of a quick pick label are
 * highlighted. It bolds whatever its own matcher finds, which is adjacent
 * letters, so for "ta" it lights up the "ta" inside "total" while the fuzzy
 * match chose the t and the A - and for "ce" it lights up nothing. So the
 * letters that matched are drawn in Mathematical Sans-Serif Bold instead, and a
 * word joiner between every character leaves VS Code nothing of its own to find.
 * ponytail: a Unicode trick, not an API. Only A-Z, a-z and 0-9 have bold forms,
 * screen readers announce them as mathematical letters, and the glyphs come from
 * whichever font covers that block. QuickPickItem has no highlight property,
 * stable or proposed, as of VS Code 1.137; switch to it if one appears.
 * @param {string} name @param {number[]} positions
 */
function decorate(name, positions) {
  const bold = new Set(positions);
  return Array.from(name, (ch, i) => {
    if (!bold.has(i)) return ch;
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
    return ch;
  }).join(JOINER);
}

/** @param {string} query */
async function ask(query) {
  try {
    const found = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
    return (found || []).filter((symbol) => symbol && symbol.location);
  } catch {
    return [];
  }
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

/** @param {boolean} on */
function fuzzyButton(on) {
  return {
    // The icon changes as well as the toggle state: toggle only exists on newer
    // VS Code, and on older ones the icon is the only thing that shows it.
    iconPath: new vscode.ThemeIcon(on ? 'filter-filled' : 'filter'),
    tooltip: on
      ? vscode.l10n.t('Fuzzy match: on (letters in order, gaps allowed)')
      : vscode.l10n.t('Fuzzy match: off (letters adjacent)'),
    toggle: { checked: on },
  };
}

async function searchSymbols() {
  let fuzzy = vscode.workspace.getConfiguration('assist.symbolSearch').get('fuzzy', true);

  const picker = vscode.window.createQuickPick();
  picker.placeholder = vscode.l10n.t('Search symbols in the workspace');
  picker.matchOnDescription = false;
  picker.matchOnDetail = false;
  picker.buttons = [fuzzyButton(fuzzy)];

  // Everything the server will hand over for an empty query, fetched once. A
  // fuzzy match is chosen from this, since asking the server with the query
  // itself is exactly what cannot find "ce" in Circle. Servers cap the list -
  // clangd at 100 unless started with --limit-results=0 - so in a large
  // project the query is asked as well and both answers are merged.
  const everything = ask('');

  let generation = 0;
  let timer;

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const query = picker.value.trim();
      const mine = ++generation;
      if (!query) {
        picker.items = [];
        return;
      }

      picker.busy = true;
      const answers = await Promise.all([fuzzy ? everything : Promise.resolve([]), ask(query)]);
      if (mine !== generation) return;
      picker.busy = false;

      const match = fuzzy ? fuzzyMatch : exactMatch;
      const seen = new Set();
      const ranked = [];
      for (const symbol of answers.flat()) {
        const name = bareName(symbol.name);
        const at = symbol.location;
        const key = `${at.uri.toString()}:${at.range.start.line}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const found = match(query, name);
        if (found) ranked.push({ ...found, name, symbol });
      }
      ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

      picker.items = ranked.slice(0, MAX_ITEMS).map(({ name, positions, symbol }) => ({
        label: `$(${KIND_ICONS[symbol.kind] || 'symbol-misc'}) ${decorate(name, positions)}`,
        description: [
          symbol.containerName,
          `${vscode.workspace.asRelativePath(symbol.location.uri)}:${symbol.location.range.start.line + 1}`,
        ]
          .filter(Boolean)
          .join('  ·  '),
        // The picker filters by label on its own, with a matcher that is not
        // this one. Every item here has already been chosen, so it stays.
        alwaysShow: true,
        loc: symbol.location,
      }));
    }, 120);
  };

  picker.onDidChangeValue(refresh);
  picker.onDidTriggerButton(() => {
    fuzzy = !fuzzy;
    picker.buttons = [fuzzyButton(fuzzy)];
    refresh();
  });
  picker.onDidAccept(async () => {
    const chosen = picker.selectedItems[0];
    picker.hide();
    if (chosen) await reveal(chosen.loc);
  });
  picker.onDidHide(() => {
    clearTimeout(timer);
    picker.dispose();
  });
  picker.show();
}

module.exports = {
  commands: {
    'assist.searchSymbols': searchSymbols,
  },
};
