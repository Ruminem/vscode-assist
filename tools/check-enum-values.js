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
const { valueOf, label, restates } = require('../features/enum-values');

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

check('implicit value is not restated', restates('A', 0n), false);
check('decimal literal restates', restates('C = 10', 10n), true);
check('hex literal with suffix restates', restates('Huge = 0xFFFFFFFFFFFFFFFFull', 18446744073709551615n), true);
check('negative literal restates', restates('M = -1', -1n), true);
check('octal literal restates', restates('O = 017', 15n), true);
check('binary with separators restates', restates("B = 0b1000'0000", 128n), true);
check('shift is not restated', restates('Read = 1 << 0', 1n), false);
check('char literal is not restated', restates("Ch = 'x'", 120n), false);
check('expression ending in a literal is not restated', restates('Q = k + 1', 1n), false);
check('comparison ending in a literal is not restated', restates('X = Y == 1', 1n), false);
check('literal that disagrees is not restated', restates('C = 10', 11n), false);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('all passed');
