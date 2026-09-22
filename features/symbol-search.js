// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');
const { fuzzyMatch, exactMatch, decorate } = require('./fuzzy');

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


/** @param {string} query */
async function ask(query) {
  try {
    const found = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
    return (found || []).filter((symbol) => symbol && symbol.location);
  } catch {
    return [];
  }
}

/**
 * A symbol with what matching reads from it worked out once, rather than again
 * for every letter typed.
 * @param {vscode.SymbolInformation} symbol
 */
function entry(symbol) {
  const name = bareName(symbol.name);
  const at = symbol.location;
  return { name, symbol, key: `${at.uri.toString()}:${at.range.start.line}:${name}` };
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
  // It is not waited for: on a large project it is the slowest answer of all,
  // and the query's own answer is worth showing while it is on its way. Nor is
  // it asked for until fuzzy matching is on, the one mode that reads it.
  let everything = null;
  let pending = false;
  let generation = 0;
  let timer;
  let open = true;
  const list = () => {
    if (everything || pending) return;
    pending = true;
    const start = Date.now();
    ask('').then((found) => {
      trace(`symbol search: full list ${found.length} symbols in ${since(start)}`);
      pending = false;
      if (!open) return;
      everything = found.map(entry);
      narrowed = null;
      if (fuzzy && picker.value.trim()) refresh();
      else picker.busy = false;
    });
  };
  if (fuzzy) list();

  // Typing back and forth asks the same queries again; the answer does not change
  // while the search box is open.
  const asked = new Map();
  const askOnce = (query) => {
    if (asked.has(query)) return asked.get(query);
    const start = Date.now();
    const answer = ask(query).then((found) => {
      trace(`symbol search: server answered "${query}" with ${found.length} in ${since(start)}`);
      return found.map(entry);
    });
    asked.set(query, answer);
    return answer;
  };

  // A query that only adds letters to the last one cannot match anything the
  // last one did not - in order with gaps, or adjacent - so only what matched
  // last time is scored again, not the whole list.
  let narrowed = null;

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
      const answer = await askOnce(query);
      if (mine !== generation) return;
      picker.busy = fuzzy && pending;

      const start = Date.now();
      const reuse = narrowed && narrowed.fuzzy === fuzzy && query.startsWith(narrowed.query);
      const pool = reuse ? narrowed.entries : fuzzy && everything ? everything : [];
      const match = fuzzy ? fuzzyMatch : exactMatch;
      const seen = new Set();
      const ranked = [];
      for (const item of [pool, answer].flat()) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        const found = match(query, item.name);
        if (found) ranked.push({ ...found, ...item });
      }
      narrowed = { query, fuzzy, entries: ranked.map(({ name, symbol, key }) => ({ name, symbol, key })) };
      ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      trace(
        `symbol search: "${query}" scored ${seen.size}${reuse ? ' (narrowed from the last query)' : ''}, ` +
          `${ranked.length} matched in ${since(start)}${fuzzy && !everything ? ', full list not in yet' : ''}`,
      );

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
    if (fuzzy) list();
    refresh();
  });
  picker.onDidAccept(async () => {
    const chosen = picker.selectedItems[0];
    picker.hide();
    if (chosen) await reveal(chosen.loc);
  });
  picker.onDidHide(() => {
    open = false;
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
