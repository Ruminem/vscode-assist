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
 * asked. `expression` is a dot after `)` or `]` - a call, a subscript, a cast.
 * Its type is not worked out here any more than a name's is: the server gets
 * the same question and the same rule decides. Measured on clangd 22 at 37 such
 * positions, every one that yields a pointer answered with arrows only, and
 * every value, reference, smart pointer, optional and iterator answered with
 * plain members alongside - no wrong conversion. `other` is a dot after `>` or
 * after nothing at all, and is not asked about.
 *
 * Comments and string literals are deliberately not tested for. Telling them
 * apart takes the parser this extension does not have, and it does not need
 * one: no server offers pointer members inside a comment, so the answer comes
 * back empty and nothing happens.
 * @param {string} text the line up to the dot
 * @returns {'name' | 'expression' | 'number' | 'other'}
 */
// What leftOfDot says is worth asking the server about. Exported so that
// tools/probe-clangd.js reports the shipped decision rather than a copy of it.
const ASKED = new Set(['name', 'expression']);

function leftOfDot(text) {
  if (/[)\]]$/.test(text)) return 'expression';
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
    if (edits.some((edit) => rewritesTheDot(edit, dot)) || insertTextOf(item).startsWith('->')) arrowed++;
    else plain++;
  }
  return { arrowed, plain };
}

/**
 * The text an item would put in the document, whether it came as a string or
 * as a snippet.
 *
 * This is the reading that works in practice. Asked through
 * `vscode.executeCompletionItemProvider`, an item comes back with no
 * `textEdit` and no `range` at all - the edit clangd sent is folded into
 * `insertText` and the range is dropped on the way (measured in VS Code 1.138
 * with clangd 22: a raw pointer's member is `{value: "->Count()"}` with
 * `filterText` `._Count`, the same member on a value is `{value: "Count()"}`
 * with `filterText` `Count`). An insertion that starts with `->` is an item
 * that means to stand where the dot is: nothing would ever offer `.->Count`.
 * @param {vscode.CompletionItem} item
 */
function insertTextOf(item) {
  const text = item.insertText;
  if (typeof text === 'string') return text;
  if (text && typeof text.value === 'string') return text.value;
  return '';
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

  // The typing has to be the user's own, here, now: one cursor, sitting at
  // the dot. An edit made anywhere else in a document that happens to be
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
  // The cursor the extension host knows is a step behind the document: the
  // change arrives first and the move that followed it arrives after, so at
  // this moment the cursor still reads as sitting on the dot (measured in
  // VS Code 1.138: `cursor at 59:6` for a dot typed at 59:6). Either position
  // says the typing happened here; anything else is an edit made somewhere
  // the cursor is not.
  const at = editor.selection.active;
  if (!at.isEqual(dot) && !at.isEqual(after)) {
    trace(`dot arrow: cursor at ${at.line}:${at.character}, expected ${dot.line}:${dot.character}`);
    return;
  }

  const left = leftOfDot(document.lineAt(dot.line).text.slice(0, dot.character));
  if (!ASKED.has(left)) {
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
  if (applied) await remember(document, dot.translate(0, 2));
}

// --- Backspace right after a conversion takes the whole arrow ----------------
//
// The user typed one character and got two. One Backspace should take both
// back, the way it would have taken the dot; leaving `-` behind makes the
// feature something to fight with.
//
// Claiming Backspace is done with a context key that is true only from the
// conversion until the cursor moves. The keybinding in package.json fires only
// while it holds, so everywhere else Backspace is not this extension's
// business. The command still checks the document before deleting, and hands
// over to the ordinary Backspace when the arrow is not in fact there: the key
// is a hint about where the cursor is, not proof of what is under it.

const ARROW_AT_CURSOR = 'assist.dotArrow.arrowAtCursor';

/** @type {{document: vscode.TextDocument, position: vscode.Position} | null} */
let arrow = null;

/** @param {vscode.TextDocument} document @param {vscode.Position} position the end of the arrow */
async function remember(document, position) {
  arrow = { document, position };
  await vscode.commands.executeCommand('setContext', ARROW_AT_CURSOR, true);
}

async function forget() {
  if (!arrow) return;
  arrow = null;
  await vscode.commands.executeCommand('setContext', ARROW_AT_CURSOR, false);
}

/** @param {vscode.TextEditorSelectionChangeEvent} event */
function onSelection(event) {
  if (!arrow) return;
  const { textEditor: editor, selections } = event;
  const stayed =
    editor.document === arrow.document &&
    selections.length === 1 &&
    selections[0].isEmpty &&
    selections[0].active.isEqual(arrow.position);
  if (!stayed) forget();
}

async function deleteArrow() {
  const editor = vscode.window.activeTextEditor;
  const here = arrow;
  await forget();
  const range = here && new vscode.Range(here.position.translate(0, -2), here.position);
  if (!editor || !here || editor.document !== here.document || editor.document.getText(range) !== '->') {
    trace('dot arrow: backspace, but no arrow at the cursor - ordinary delete');
    await vscode.commands.executeCommand('deleteLeft');
    return;
  }
  const done = await editor.edit((builder) => builder.delete(range));
  trace(`dot arrow: backspace ${done ? 'took the arrow' : 'refused'}`);
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(onChange),
    vscode.window.onDidChangeTextEditorSelection(onSelection),
  );
}

module.exports = {
  activate,
  commands: { 'assist.dotArrow.deleteArrow': deleteArrow },
  // Exported for the checks: the two decisions this feature makes on its own,
  // apart from what the server answered.
  leftOfDot,
  countEdits,
  ASKED,
};
