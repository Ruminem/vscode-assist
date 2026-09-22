#!/usr/bin/env node
'use strict';

// The two decisions features/dot-arrow.js makes on its own, checked without an
// editor or a language server.
//
//   node tools/check-dot-arrow.js
//
// This exists because the first version got the second decision wrong in a way
// that reads correctly. It converted whenever the server offered an arrow at
// all, which is true of unique_ptr, shared_ptr and every iterator - classes
// with operator-> whose own members the dot reaches perfectly well - and would
// have turned .reset() into ->reset(). The rule that holds is "the dot reaches
// nothing", and the shape of the answer that proves it is easy to lose in a
// refactor, so it is pinned here. The counts in the cases below were measured
// against clangd 18 with fixtures/dot-arrow and with the real standard types.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const path = require('path');
const Module = require('module');

// features/dot-arrow.js requires vscode, which exists only inside the editor.
// Only Position and Range are reached by the two pure functions, and both are
// small enough to stand in for honestly.
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  isAfter(other) {
    return this.line > other.line || (this.line === other.line && this.character > other.character);
  }
}
const stub = {
  Position,
  Range: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  workspace: { onDidChangeTextDocument() {} },
  window: {},
  commands: {},
  WorkspaceEdit: class {},
};
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? stub : load(request, parent, isMain));

const { leftOfDot, countEdits } = require(path.join(__dirname, '..', 'features', 'dot-arrow.js'));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

// --- what sits left of the dot ------------------------------------------------

check('a name', leftOfDot('  m_pFoo'), 'name');
check('a name with a digit in it', leftOfDot('  foo2'), 'name');
check('a name starting with an underscore', leftOfDot('_x'), 'name');
check('a name reached through another dot', leftOfDot('a.b'), 'name');
check('a decimal point', leftOfDot('  float f = 3'), 'number');
check('a leading zero', leftOfDot('0'), 'number');
check('after a call', leftOfDot('  foo()'), 'other');
check('after a subscript', leftOfDot('  v[0]'), 'other');
check('after a template argument list', leftOfDot('  A<B>'), 'other');
check('nothing at all', leftOfDot(''), 'other');
check('only spaces', leftOfDot('    '), 'other');
check('a second dot', leftOfDot('a.'), 'other');

// --- what the server answered -------------------------------------------------

const dot = new Position(4, 10);
const over = { start: new Position(4, 10), end: new Position(4, 11) };
const after = { start: new Position(4, 11), end: new Position(4, 11) };
const at = { start: dot, end: dot };

const arrow = (n) => ({ textEdit: { range: over, newText: `->m${n}` } });
const plain = (n) => ({ textEdit: { range: after, newText: `m${n}` } });
const count = (items) => countEdits({ items }, dot);

// A raw pointer: nothing the dot reaches, so every answer corrects it.
check('raw pointer', count([arrow(1), arrow(2), arrow(3)]), { arrowed: 3, plain: 0 });
// unique_ptr: get() and release() are the dot's, Count() is the pointee's.
check('smart pointer', count([plain(1), plain(2), arrow(1), arrow(2)]), { arrowed: 2, plain: 2 });
// An iterator, which is the same shape with fewer of its own members.
check('iterator', count([plain(1), arrow(1), arrow(2)]), { arrowed: 2, plain: 1 });
check('a value', count([plain(1), plain(2)]), { arrowed: 0, plain: 2 });
check('no answer at all', countEdits(undefined, dot), { arrowed: 0, plain: 0 });
check('an empty list', count([]), { arrowed: 0, plain: 0 });

// An edit that starts at the dot inserts in front of it and leaves it standing.
check('an insertion at the dot', count([{ textEdit: { range: at, newText: '->x' } }]), { arrowed: 0, plain: 1 });
// A server that says nothing cannot be read, and an unreadable item has to
// count against converting rather than be skipped.
check('an item with no edit', count([{ label: 'x' }, arrow(1)]), { arrowed: 1, plain: 1 });
check('the fix carried in additionalTextEdits', count([
  { textEdit: { range: after, newText: 'm' }, additionalTextEdits: [{ range: over, newText: '->' }] },
]), { arrowed: 1, plain: 0 });
check('a plain list rather than a CompletionList', countEdits([arrow(1), arrow(2)], dot), { arrowed: 2, plain: 0 });

// --- the rule itself ----------------------------------------------------------

// Spelled out once, because this is the line the first version got wrong and
// the one a future reader is most likely to simplify back into a bug.
const converts = ({ arrowed, plain: left }) => arrowed > 0 && left === 0;
check('a raw pointer converts', converts(count([arrow(1), arrow(2)])), true);
check('a smart pointer does not', converts(count([plain(1), arrow(1)])), false);
check('an iterator does not', converts(count([plain(1), arrow(1), arrow(2)])), false);
check('a value does not', converts(count([plain(1)])), false);
check('an empty answer does not', converts(count([])), false);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
