// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { trace, since } = require('./trace');

// Where a dot after a pointer is a typo for an arrow. C is here because a
// struct pointer wants the same fix, and cuda-cpp because it is C++ under
// another name.
const LANGUAGES = new Set(['c', 'cpp', 'cuda-cpp']);

// How many completion items are looked at for the fix. The servers that offer
// it put it on the members they return first; reading the whole list of a big
// class buys nothing and costs a loop on every dot.
const LOOK_AT = 50;

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
 * Whether the server's answer says the left side is a pointer.
 *
 * The type is never worked out here. A server that knows the expression is a
 * pointer says so in the completion itself, by handing back an edit that
 * reaches back over the dot and writes `->` in its place - clangd does this,
 * which is why this feature is a question rather than a rule. Reading the
 * answer instead of the type is what keeps `unique_ptr`, `shared_ptr` and
 * iterators safe for free: `.reset()` and `.get()` are the right thing to
 * write, so no server offers to rewrite the dot in front of them, and no list
 * of exceptions has to be kept here and kept correct.
 *
 * The edit is read as evidence and then thrown away. Its text is `->member`,
 * the whole completion, and applying it would put a name there that nobody
 * typed. Only the dot is replaced, below.
 * @param {vscode.CompletionList | vscode.CompletionItem[] | undefined} answer
 * @param {vscode.Position} dot
 */
function saysPointer(answer, dot) {
  const items = (Array.isArray(answer) ? answer : answer && answer.items) || [];
  for (const item of items.slice(0, LOOK_AT)) {
    const edits = [item.textEdit, ...(item.additionalTextEdits || [])];
    for (const edit of edits) {
      if (!edit || !edit.range || typeof edit.newText !== 'string') continue;
      if (!edit.newText.startsWith('->')) continue;
      // The edit has to cover the dot itself, not merely start at it: an
      // insertion at that position is a different edit with the same address.
      if (edit.range.start.isAfter(dot) || !edit.range.end.isAfter(dot)) continue;
      return true;
    }
  }
  return false;
}

/** The first few items, short, for a trace line that explains an answer that did not match. */
function sample(answer) {
  const items = (Array.isArray(answer) ? answer : answer && answer.items) || [];
  return items
    .slice(0, 3)
    .map((item) => {
      const edit = item.textEdit;
      const text = edit && typeof edit.newText === 'string' ? JSON.stringify(edit.newText) : '-';
      const extra = item.additionalTextEdits ? `+${item.additionalTextEdits.length}` : '';
      return `${text.slice(0, 24)}${extra}`;
    })
    .join(' ');
}

/** @param {vscode.TextDocumentChangeEvent} event */
async function onChange(event) {
  // Cheapest test first: this runs on every keystroke in every open document,
  // and all but one key in a hundred stops on the line below.
  const dot = typedDot(event);
  if (!dot) return;

  const document = event.document;
  if (!LANGUAGES.has(document.languageId)) return;
  if (!vscode.workspace.getConfiguration('assist.dotArrow', document.uri).get('enabled', false)) return;

  // The typing has to be the user's own, here, now: one cursor, sitting just
  // past the dot. An edit made anywhere else in a document that happens to be
  // open is not a keystroke.
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) return;
  if (editor.selections.length !== 1 || !editor.selection.isEmpty) return;
  const after = dot.translate(0, 1);
  if (!editor.selection.active.isEqual(after)) return;

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

  if (!saysPointer(answer, dot)) {
    trace(`dot arrow: no arrow edit in ${since(started)} - ${sample(answer)}`);
    return;
  }

  // A workspace edit rather than the editor's own: it lands as an undo step of
  // its own, so one Ctrl+Z brings the dot back and leaves the typing that came
  // before it alone.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(dot, after), '->');
  const applied = await vscode.workspace.applyEdit(edit);
  trace(`dot arrow: ${applied ? 'converted' : 'edit refused'} in ${since(started)}`);
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(onChange));
}

module.exports = {
  activate,
  // Exported for the fixture notes and for anyone reading: the two decisions
  // this feature makes on its own, apart from what the server says.
  leftOfDot,
  saysPointer,
};
