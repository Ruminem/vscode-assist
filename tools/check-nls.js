#!/usr/bin/env node
'use strict';

// Before a release, ask whether anything on screen has lost its Korean.
//
// A missing translation does not fail. VS Code falls back to the English
// original and the extension goes on working, so the only way to notice is to
// run it in Korean and read every string - which nobody does, and which is why
// v0.1.0 shipped a setting description showing a literal \n\n to everyone.
// Both halves of the pair are easy to forget in opposite ways: package.json
// carries only %keys% and says nothing about what they hold, and an l10n key
// is the English sentence itself, so editing the sentence silently orphans the
// translation while the code still compiles and still reads correctly.
//
//   node tools/check-nls.js
//
// Exits non-zero on any finding, so it can sit in front of a release.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['extension.js', ...fs.readdirSync(path.join(ROOT, 'features')).map((f) => path.join('features', f))]
  .filter((file) => file.endsWith('.js'));

const problems = [];
/** @param {string} where @param {string} what */
function problem(where, what) {
  problems.push(`${where}: ${what}`);
}

/** @param {string} file */
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

/**
 * The `{0}` `{1}` slots of a string, as a sorted list. A translation that drops
 * one prints the word "undefined" where a number should be, and one that
 * invents a slot prints the slot. Both look like a bug in the feature rather
 * than in the wording, which is what makes them expensive to find by hand.
 * @param {string} text
 */
function slots(text) {
  return [...new Set([...text.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))].sort();
}

/**
 * The originals passed to vscode.l10n.t(), read straight out of the source.
 *
 * Only a single-quoted literal on the same line is understood, which is every
 * call in this repository and is meant to stay that way: a key built at run
 * time cannot be looked up in a bundle written ahead of time. A call this
 * cannot read is reported rather than skipped, because a silent skip would
 * turn the whole check into one that passes by finding nothing.
 */
function originals() {
  const found = new Map();
  for (const file of SOURCES) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const call of line.matchAll(/vscode\.l10n\.t\(/g)) {
        const rest = line.slice(call.index + call[0].length);
        const literal = /^\s*'((?:[^'\\]|\\.)*)'/.exec(rest);
        if (!literal) {
          problem(`${file}:${i + 1}`, 'vscode.l10n.t() without a single-quoted literal - cannot be checked');
          continue;
        }
        // Undo the escapes the JavaScript parser would have undone. A bundle
        // key holds the finished string, not its source spelling.
        const original = literal[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] || c);
        if (!found.has(original)) found.set(original, `${file}:${i + 1}`);
      }
    });
  }
  return found;
}

// --- package.json %keys% against the two nls files ---------------------------

const manifest = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
JSON.parse(manifest);
const en = readJson('package.nls.json');
const ko = readJson('package.nls.ko.json');
const used = [...new Set([...manifest.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]))];

for (const key of used) {
  if (!(key in en)) problem('package.nls.json', `%${key}% has no English text`);
  if (!(key in ko)) problem('package.nls.ko.json', `%${key}% has no Korean text`);
}
for (const key of Object.keys(en)) {
  if (!used.includes(key)) problem('package.nls.json', `"${key}" is not used by package.json`);
}
for (const key of Object.keys(ko)) {
  if (!(key in en)) problem('package.nls.ko.json', `"${key}" has no English counterpart`);
}
for (const key of Object.keys(en)) {
  if (!(key in ko)) continue;
  const [a, b] = [slots(en[key]), slots(ko[key])];
  if (a.join() !== b.join()) problem('package.nls.ko.json', `"${key}" fills {${a}} in English but {${b}} in Korean`);
}
// A real newline is written as a newline inside a JSON string, which JSON.parse
// turns back into one. A backslash and an n survive parsing as two characters
// and are shown to the reader as two characters - the v0.1.0 bug.
for (const [file, bundle] of [['package.nls.json', en], ['package.nls.ko.json', ko]]) {
  for (const [key, text] of Object.entries(bundle)) {
    if (/\\n/.test(text)) problem(file, `"${key}" holds a backslash and an n where a line break was meant`);
  }
}

// --- vscode.l10n.t() against the Korean bundle --------------------------------

const bundle = readJson('l10n/bundle.l10n.ko.json');
const calls = originals();

for (const [original, where] of calls) {
  if (!(original in bundle)) problem(where, `no Korean for ${JSON.stringify(original)}`);
}
for (const key of Object.keys(bundle)) {
  if (!calls.has(key)) problem('l10n/bundle.l10n.ko.json', `${JSON.stringify(key)} is not said by any source file`);
}
for (const [key, text] of Object.entries(bundle)) {
  const [a, b] = [slots(key), slots(text)];
  if (a.join() !== b.join()) problem('l10n/bundle.l10n.ko.json', `${JSON.stringify(key)} fills {${a}} but its Korean fills {${b}}`);
  // An icon belongs outside the sentence: $(arrow-right) is not words and has
  // nothing to translate, and a translator who moves or mistypes it leaves the
  // literal text on screen.
  if (key.includes('$(') || text.includes('$(')) {
    problem('l10n/bundle.l10n.ko.json', `${JSON.stringify(key)} carries an icon - keep $(...) outside the translated string`);
  }
}

// --- report -------------------------------------------------------------------

if (problems.length === 0) {
  console.log(
    `ok  ${used.length} %keys% in two nls files, ${calls.size} l10n originals against ${Object.keys(bundle).length} translations`,
  );
  process.exit(0);
}
for (const line of problems) console.log(`  ${line}`);
console.log('');
console.log(`${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`);
process.exit(1);
