// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');

// A stop is whatever the language server calls a function. Classes, structs
// and namespaces are not stops of their own, but what is declared inside them
// is, which is how a header full of method declarations still steps line by
// line.
const STOPS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

/**
 * Document symbols arrive in one of two shapes depending on the server: a tree
 * of DocumentSymbol, where methods are children of their class, or a flat list
 * of SymbolInformation. Both reduce to the positions of the names, in order.
 * The name rather than the start of the declaration, so a jump lands where
 * Alt+G can be pressed next.
 * @param {unknown} raw
 * @returns {vscode.Position[]}
 */
function stops(raw) {
  const out = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (!item) continue;
      if (STOPS.has(item.kind)) {
        const range = item.selectionRange || (item.location && item.location.range);
        if (range) out.push(range.start);
      }
      if (item.children) walk(item.children);
    }
  };
  walk(Array.isArray(raw) ? raw : []);
  return out.sort((a, b) => a.compareTo(b));
}

// Pressed in a row, the file has not changed between presses and neither has
// its outline, so the last answer is reused while the document version holds.
let cached = { uri: '', version: -1, stops: [] };

/**
 * Lines, not positions, decide what counts as next. Standing anywhere on a
 * function's name line, "previous" should leave that function rather than
 * creep back to the first letter of its name, and "next" should leave it
 * rather than stop on the same line again. Inside a body, "previous" lands on
 * the function the cursor is in, which is the move wanted most often.
 * @param {1 | -1} direction
 */
function step(direction) {
  return async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const line = editor.selection.active.line;
    const document = editor.document;
    const start = Date.now();

    let all;
    const reused = cached.uri === document.uri.toString() && cached.version === document.version;
    if (reused) {
      all = cached.stops;
    } else {
      let raw;
      try {
        raw = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
      } catch {
        // A server that does not implement the request rejects rather than
        // answering empty. Here that only means there is nowhere to go.
        raw = [];
      }
      all = stops(raw);
      // An empty outline is not kept: a server still parsing the file gives one.
      if (all.length) cached = { uri: document.uri.toString(), version: document.version, stops: all };
    }
    trace(`function step: ${all.length} stops${reused ? ' (same version, reused)' : ''} in ${since(start)}`);
    const target =
      direction > 0
        ? all.find((p) => p.line > line)
        : all.filter((p) => p.line < line).pop();

    if (!target) {
      // Two whole sentences rather than one with the direction filled in: word
      // order is not the same in every language that gets a translation.
      const message =
        direction > 0
          ? vscode.l10n.t('No next function in this file')
          : vscode.l10n.t('No previous function in this file');
      vscode.window.setStatusBarMessage(`$(circle-slash) ${message}`, 2000);
      return;
    }

    editor.selection = new vscode.Selection(target, target);
    editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };
}

module.exports = {
  commands: {
    'assist.nextFunction': step(1),
    'assist.previousFunction': step(-1),
  },
};
