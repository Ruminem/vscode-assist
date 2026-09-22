// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');

// Where a dot after a pointer is a typo for an arrow. C is here because a
// struct pointer wants the same fix, and cuda-cpp because it is C++ under
// another name.
const LANGUAGES = new Set(['c', 'cpp', 'cuda-cpp']);

// Every item is read, not a prefix of them. One member that the dot reaches is
// enough to call the whole thing off, and nothing says a server sorts those
// last - std::string answers a dot with a hundred of them. The loop is cheap
// in the case that matters: an answer where the dot reaches nothing is short.

/**
 * The dot of a `pointer.member` typed just now, or null. Everything else is
 * left alone: a paste, a multi-character edit, a deletion, an edit this
 * extension or another one made - and an undo or redo above all. The dot a
 * Ctrl+Z brings back is the user taking the arrow away again, and converting
 * it a second time would make this a fight rather than a help.
 * @param {vscode.TextDocumentChangeEvent} event
 * @returns {vscode.Position | null}
 */
function typedDot(event) {
  if (event.reason !== undefined) return null;
  if (event.contentChanges.length !== 1) return null;
  const change = event.contentChanges[0];
  if (change.text !== '.' || change.rangeLength !== 0) return null;
  return change.range.start;
}

/**
 * What sits immediately left of the dot, by the letters alone. This is not a
 * parse and does not pretend to be one - it only keeps the cheapest mistakes
 * from ever reaching the language server.
 *
 * `number` is `3.14`, where a dot is a decimal point and no question should be
 * asked. `other` is a dot after `)`, `]`, `>` or nothing at all: the type of a
 * whole expression is a harder question than the type of a name, so those are
 * left for later rather than guessed at now.
 *
 * Comments and string literals are deliberately not tested for. Telling them
 * apart takes the parser this extension does not have, and it does not need
 * one: no server offers pointer members inside a comment, so the answer comes
 * back empty and nothing happens.
 * @param {string} text the line up to the dot
 * @returns {'name' | 'number' | 'other'}
 */
function leftOfDot(text) {
  const run = /[A-Za-z_0-9]+$/.exec(text);
  if (!run) return 'other';
  return /^[0-9]/.test(run[0]) ? 'number' : 'name';
}

/**
 * Whether an edit reaches back over the dot and writes `->` in its place.
 * It has to cover the dot itself, not merely start at it: an insertion at that
 * position is a different edit with the same address.
 * @param {vscode.TextEdit | undefined} edit @param {vscode.Position} dot
 */
function rewritesTheDot(edit, dot) {
  if (!edit || !edit.range || typeof edit.newText !== 'string') return false;
  if (!edit.newText.startsWith('->')) return false;
  return !edit.range.start.isAfter(dot) && edit.range.end.isAfter(dot);
}

/**
 * How many of the server's completions rewrite the dot, and how many leave it.
 *
 * The type of the expression is never worked out here. Asked what could follow
 * a dot, a server answers with the members that are actually reachable, and it
 * marks the ones that need an arrow by handing back an edit that writes `->`
 * over the dot - clangd does this, which is what the whole feature reads.
 *
 * Both counts are needed, and the first version of this was wrong for having
 * only one. A raw pointer has nothing a dot can reach, so every answer rewrites
 * it. A class with `operator->` has its own members as well, so `unique_ptr`
 * answers `up.` with `get` and `release` untouched **alongside** an arrowed
 * `->Count()`, and converting on the arrow alone turns `.reset()` into
 * `->reset()` - the exact accident this feature was supposed to avoid.
 * Measured against clangd 18: a raw pointer 2 arrowed and 0 plain, unique_ptr
 * 2 and 5, shared_ptr 2 and 10, vector::iterator 2 and 1, a value 0 and many.
 *
 * So the rule is not "the server offered an arrow" but **the dot reaches
 * nothing**, which is the same sentence as "an arrow is the only thing that can
 * work here" and is true of a raw pointer by definition. An item carrying no
 * edit at all counts as plain: a server that does not say is a server this
 * cannot read, and leaving the dot alone is the safe way to be wrong.
 *
 * The edits are read as evidence and thrown away. Their text is `->member`,
 * the whole completion, and applying one would put a name there that nobody
 * typed. Only the dot is replaced, below.
 * @param {vscode.CompletionList | vscode.CompletionItem[] | undefined} answer
 * @param {vscode.Position} dot
 * @returns {{arrowed: number, plain: number}}
 */
function countEdits(answer, dot) {
  const items = (Array.isArray(answer) ? answer : answer && answer.items) || [];
  let arrowed = 0;
  let plain = 0;
  for (const item of items) {
    const edits = [item.textEdit, ...(item.additionalTextEdits || [])];
    if (edits.some((edit) => rewritesTheDot(edit, dot))) arrowed++;
    else plain++;
  }
  return { arrowed, plain };
}

/** @param {vscode.TextDocumentChangeEvent} event */
async function onChange(event) {
  // Cheapest test first: this runs on every keystroke in every open document,
  // and all but one key in a hundred stops on the line below.
  const dot = typedDot(event);
  if (!dot) return;

  const document = event.document;
  if (!LANGUAGES.has(document.languageId)) return;
  // The document rather than its uri: a uri alone resolves folder settings but
  // not a `"[cpp]"` block, and turning this on for one language is the way it
  // is meant to be turned on.
  if (!vscode.workspace.getConfiguration('assist.dotArrow', document).get('enabled', false)) {
    trace('dot arrow: off - set assist.dotArrow.enabled to turn it on');
    return;
  }

  // The typing has to be the user's own, here, now: one cursor, sitting just
  // past the dot. An edit made anywhere else in a document that happens to be
  // open is not a keystroke. Each of these says so in the trace rather than
  // returning quietly: a feature that does nothing and explains nothing cannot
  // be told apart from one that is not running at all.
  const editor = vscode.window.activeTextEditor;
  const after = dot.translate(0, 1);
  if (!editor || editor.document !== document) {
    trace('dot arrow: the change is not in the active editor');
    return;
  }
  if (editor.selections.length !== 1 || !editor.selection.isEmpty) {
    trace(`dot arrow: ${editor.selections.length} selection(s), not one empty cursor`);
    return;
  }
  if (!editor.selection.active.isEqual(after)) {
    const at = editor.selection.active;
    trace(`dot arrow: cursor at ${at.line}:${at.character}, expected ${after.line}:${after.character}`);
    return;
  }

  const left = leftOfDot(document.lineAt(dot.line).text.slice(0, dot.character));
  if (left !== 'name') {
    trace(`dot arrow: left of the dot is ${left}, not asking`);
    return;
  }

  const version = document.version;
  const started = Date.now();
  let answer;
  try {
    answer = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      after,
      '.',
    );
  } catch {
    // A server that has not started yet rejects rather than answering empty.
    // Here that only means the dot stays a dot.
    trace(`dot arrow: no completion answer after ${since(started)}`);
    return;
  }

  // The answer is old news if anything at all was typed while it travelled. A
  // stale yes would turn a dot somewhere else into an arrow, which is the one
  // way this feature can corrupt a file rather than merely annoy.
  if (document.version !== version) {
    trace(`dot arrow: answer arrived ${since(started)} late, document moved on`);
    return;
  }

  const { arrowed, plain } = countEdits(answer, dot);
  const counted = `${arrowed} arrow + ${plain} plain in ${since(started)}`;
  if (arrowed === 0 || plain > 0) {
    trace(`dot arrow: ${counted} - the dot reaches ${plain > 0 ? 'something' : 'nothing on offer'}`);
    return;
  }

  // A workspace edit rather than the editor's own: it lands as an undo step of
  // its own, so one Ctrl+Z brings the dot back and leaves the typing that came
  // before it alone.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(dot, after), '->');
  const applied = await vscode.workspace.applyEdit(edit);
  trace(`dot arrow: ${applied ? 'converted' : 'edit refused'} - ${counted}`);
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(onChange));
}

module.exports = {
  activate,
  // Exported for the checks: the two decisions this feature makes on its own,
  // apart from what the server answered.
  leftOfDot,
  countEdits,
};
