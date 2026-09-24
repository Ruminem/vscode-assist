// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');

// The value of every enumerator, written at the end of its line as an inlay
// hint. Nothing is computed here: the language server already worked the value
// out for its hover (`Value = \`2\`` in clangd), and this only asks for that
// hover and puts the number where it can be seen without one. clangd 22 has no
// inlay hint of its own for it - measured, its answer is empty.
const LANGUAGES = ['c', 'cpp', 'cuda-cpp'];

/**
 * The value a hover states, or null. clangd writes it on a line of its own as
 * `Value = \`2\``. cpptools puts it in the declaration it shows, with the
 * literal suffix of the underlying type: `enum class Flags::Write = 2U`,
 * `enum Big::Huge = 18446744073709551615Ui64`. A template argument's
 * enumerator (`V = K * 2`) has neither, and then there is no hint.
 * BigInt because a uint64_t enumerator does not fit a double.
 * @param {string} text
 * @returns {bigint | null}
 */
function valueOf(text) {
  const match = /^Value = `(-?\d+)/m.exec(text) || /^enum [^=\n]+ = (-?\d+)[uUlLiI\d]*$/m.exec(text);
  return match ? BigInt(match[1]) : null;
}

/**
 * `= 2 (0x2)`, or `= 2` alone when the initializer is already written in hex.
 * A negative value has no hex form without the width of its underlying type,
 * which the hover does not say, so it stands alone too.
 * @param {bigint} value
 * @param {boolean} [decimalOnly]
 */
function label(value, decimalOnly) {
  return value < 0n || decimalOnly ? `= ${value}` : `= ${value} (0x${value.toString(16).toUpperCase()})`;
}

/**
 * The base the enumerator's own text spells its value in - 10 for `C = 10` or
 * `M = -1`, 16 for `Huge = 0xFFFFFFFFFFFFFFFFull`, 8 or 2 - or 0 when the text
 * is not a lone integer literal equal to the value. `1 << 0` and `'x'` are 0:
 * they are what the hint is for. This reads the letters of one declaration; it
 * is not a parse.
 * @param {string} text the enumerator as the symbol's range covers it
 * @param {bigint} value
 */
function literalBase(text, value) {
  const match = /^[^=]*=\s*(-?)\s*(0[xX][\da-fA-F']+|0[bB][01']+|\d[\d']*)[uUlLzZ]*\s*$/.exec(text);
  if (!match) return 0;
  let digits = match[2].replace(/'/g, '');
  const base = /^0[xX]/.test(digits) ? 16 : /^0[bB]/.test(digits) ? 2 : /^0\d/.test(digits) ? 8 : 10;
  if (base === 8) digits = '0o' + digits.slice(1);
  const literal = BigInt(digits);
  return (match[1] ? -literal : literal) === value ? base : 0;
}

/**
 * How far past the enumerator's end the hint goes. Both servers end the range
 * before the comma, so `Fill = 1u << 0 = 1 (0x1),` read as if the expression
 * went on. When the comma is the last thing on the line but a comment, the hint
 * goes after it; when another enumerator follows, it stays put so each hint
 * sits by its own name.
 * @param {string} rest the line after the enumerator's range
 */
function afterComma(rest) {
  const match = /^\s*,(?=\s*(\/\/|\/\*|$))/.exec(rest);
  return match ? match[0].length : 0;
}

// Hover answers for one version of one document, by enumerator position.
// Scrolling asks again for every range the editor shows, and the answer only
// changes when the text does. An empty answer is not kept: it is what a server
// still parsing says, and asking again later is how the hint appears.
const cache = new Map();

/**
 * Enumerators in the tree, whether the server nests them or lists them flat,
 * by the position of their name. With clangd and cpptools both running, VS Code
 * hands back both servers' symbols in one list - measured, every hint came out
 * twice - so the second one to arrive at a position is dropped.
 */
function enumerators(symbols, out = new Map(), parent) {
  for (const symbol of symbols || []) {
    if (symbol.kind === vscode.SymbolKind.EnumMember || parent === vscode.SymbolKind.Enum) {
      const at = (symbol.selectionRange || symbol.location.range).start;
      const key = `${at.line}:${at.character}`;
      if (!out.has(key)) out.set(key, symbol);
    } else {
      enumerators(symbol.children, out, symbol.kind);
    }
  }
  return out;
}

async function hoverValue(document, position) {
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
  for (const hover of hovers || []) {
    for (const part of hover.contents) {
      const value = valueOf(typeof part === 'string' ? part : part.value);
      if (value !== null) return value;
    }
  }
  return null;
}

/** @type {vscode.InlayHintsProvider['provideInlayHints']} */
async function provideInlayHints(document, range, token) {
  if (!vscode.workspace.getConfiguration('assist.enumValues', document).get('enabled', true)) return [];
  const started = Date.now();
  const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
  const shown = [...enumerators(symbols)].filter(([, symbol]) => {
    const where = symbol.location ? symbol.location.range : symbol.range;
    return where.intersection(range);
  });
  if (shown.length === 0 || token.isCancellationRequested) return [];

  let known = cache.get(document.uri.toString());
  if (!known || known.version !== document.version) {
    known = { version: document.version, values: new Map() };
    cache.set(document.uri.toString(), known);
  }

  // One hover at a time. Sent all at once, cpptools answered 3 of 17 and left
  // the rest empty; one by one it answered all 17. clangd takes 2-4 ms each.
  let asked = 0;
  const found = [];
  for (const [key, symbol] of shown) {
    if (token.isCancellationRequested) return [];
    const where = symbol.location ? symbol.location.range : symbol.range;
    const at = symbol.selectionRange ? symbol.selectionRange.start : where.start;
    let value = known.values.get(key);
    if (value === undefined) {
      asked++;
      value = await hoverValue(document, at);
      if (value !== null) known.values.set(key, value);
    }
    if (value === null) continue;
    // Decimal already says it. Hex gets the decimal it hides; 0b and 0 octal
    // are no easier to read than hex, so they keep both.
    const base = literalBase(document.getText(where), value);
    if (base === 10) continue;
    const rest = document.lineAt(where.end.line).text.slice(where.end.character);
    const hint = new vscode.InlayHint(where.end.translate(0, afterComma(rest)), label(value, base === 16));
    hint.paddingLeft = true;
    found.push(hint);
  }
  trace(`enum values: ${shown.length} enumerator(s) in view, ${asked} hover(s) asked, ${found.length} hint(s) in ${since(started)}`);
  return found;
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(LANGUAGES.map((language) => ({ language })), { provideInlayHints }),
    vscode.workspace.onDidCloseTextDocument((document) => cache.delete(document.uri.toString())),
  );
}

module.exports = {
  activate,
  // Exported for the checks: what this feature decides from text alone.
  valueOf,
  label,
  literalBase,
  afterComma,
};
