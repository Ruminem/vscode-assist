#!/usr/bin/env node
'use strict';

// What features/enum-values.js decides from text alone, checked without an
// editor or a language server.
//
//   node tools/check-enum-values.js
//
// The hover lines below are clangd 22's and cpptools 1.34's, copied from a run against enums of
// every shape worth having: implicit, shifted, negative, uint64_t, char,
// constexpr, and a template argument's, which has no value line at all.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const Module = require('module');

// The feature requires vscode, which exists only inside the editor. None of the
// three functions checked here touches it.
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? {} : load.call(this, request, ...rest);
};
const { valueOf, label, literalBase, afterComma } = require('../features/enum-values');

let failed = 0;
function check(name, actual, expected) {
  if (actual === expected) return;
  failed++;
  console.log(`FAIL  ${name}\n      got      ${String(actual)}\n      expected ${String(expected)}`);
}

const hover = (value) => `### enumerator \`X\`\n\n---\nType: \`enum E\`\n\n${value}\n\n---\n\`\`\`cpp\nX = 1\n\`\`\``;

check('plain value', valueOf(hover('Value = `2`')), 2n);
check('negative value', valueOf(hover('Value = `-1`')), -1n);
check('uint64 max survives', valueOf(hover('Value = `18446744073709551615`')), 18446744073709551615n);
check('value with hex after it', valueOf(hover('Value = `2 (0x2)`')), 2n);
check('template argument has no value', valueOf("### enumerator `V`\n\n---\nType: `enum T::(unnamed)`\n\n---\n```cpp\npublic: V = K * 2\n```"), null);
check('cpptools value with suffix', valueOf('```cpp\nenum class Flags::Write = 2U\n```  \nexpect = 2 (0x2)'), 2n);
check('cpptools uint64 with Ui64', valueOf('```cpp\nenum Big::Huge = 18446744073709551615Ui64\n```'), 18446744073709551615n);
check('cpptools negative', valueOf('```cpp\nenum Signed::Minus = -1\n```'), -1n);
check('a doc comment is not the value', valueOf('```cpp\nenum Plain::A\n```  \nexpect = 0 (0x0)'), null);
check('code block is not the value line', valueOf('```cpp\nValue = 3\n```'), null);

check('label', label(2n), '= 2 (0x2)');
check('label hex is upper case', label(255n), '= 255 (0xFF)');
check('label negative has no hex', label(-1n), '= -1');
check('label uint64 max', label(18446744073709551615n), '= 18446744073709551615 (0xFFFFFFFFFFFFFFFF)');

check('label decimal only for a hex initializer', label(39321n, true), '= 39321');

check('implicit value has no literal', literalBase('A', 0n), 0);
check('decimal literal', literalBase('C = 10', 10n), 10);
check('hex literal with suffix', literalBase('Huge = 0xFFFFFFFFFFFFFFFFull', 18446744073709551615n), 16);
check('upper case hex literal', literalBase('T = 0X9999', 39321n), 16);
check('negative literal', literalBase('M = -1', -1n), 10);
check('octal literal', literalBase('O = 017', 15n), 8);
check('binary with separators', literalBase("B = 0b1000'0000", 128n), 2);
check('zero is decimal, not octal', literalBase('None = 0', 0n), 10);
check('shift is not a literal', literalBase('Read = 1 << 0', 1n), 0);
check('char literal is not an integer literal', literalBase("Ch = 'x'", 120n), 0);
check('expression ending in a literal', literalBase('Q = k + 1', 1n), 0);
check('comparison ending in a literal', literalBase('X = Y == 1', 1n), 0);
check('literal that disagrees', literalBase('C = 10', 11n), 0);

check('comma ending the line', afterComma(','), 1);
check('comma then a comment', afterComma(",   // expect = 1 (0x1)"), 1);
check('comma then a block comment', afterComma(', /* x */'), 1);
check('space before the comma', afterComma(' ,'), 2);
check('last enumerator has no comma', afterComma(''), 0);
check('another enumerator on the line', afterComma(', TopRight, BottomRight = 4, BottomLeft };'), 0);
check('closing brace on the line', afterComma(' };'), 0);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('all passed');
