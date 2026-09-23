#!/usr/bin/env node
'use strict';

// The decisions features/text-guess.js makes without an editor: where clangd's
// compilation database is, and in what order text guesses are searched and
// ranked.
//
//   node tools/check-text-guess.js
//
// The database part exists because the first version only walked up looking
// for compile_commands.json, so a project that moved the database with
// --compile-commands-dir or .clangd read as having none, and every Alt+G there
// was cut short to wait for an index that was in fact done. The order below is
// the one clangd 22 was measured to use: the flag beats .clangd, and .clangd
// beats a database right next to the file.
//
// The ranking part exists because guesses from unrelated files came first:
// nothing favoured the file being read, and ties kept ripgrep's order, which
// its parallel walk makes different from run to run.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// text-guess.js requires vscode at the top; nothing checked here touches it.
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? {} : load(request, parent, isMain));
const { locateDatabase, rings, distance, byLikeness } = require(path.join(__dirname, '..', 'features', 'text-guess.js'));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

// A fresh project per case: src/a.cpp, and whatever files the case adds.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-db-'));
  for (const [name, text] of Object.entries({ 'src/a.cpp': '', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
function run(name, files, args, want) {
  const root = project(files);
  try {
    const found = locateDatabase(path.join(root, 'src', 'a.cpp'), root, args, root);
    const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
    check(name, found && { db: rel(found.db), root: rel(found.root) }, want);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const DB = '[]';
run('next to the file', { 'src/compile_commands.json': DB }, [], { db: 'src/compile_commands.json', root: 'src' });
run('under build/, index above it', { 'build/compile_commands.json': DB }, [], { db: 'build/compile_commands.json', root: '' });
run('nowhere', {}, [], null);

run('the flag, with =', { 'out/compile_commands.json': DB }, ['--compile-commands-dir=out'], { db: 'out/compile_commands.json', root: 'out' });
run('the flag, as two arguments', { 'out/compile_commands.json': DB }, ['--compile-commands-dir', 'out'], { db: 'out/compile_commands.json', root: 'out' });
run('the flag with ${workspaceFolder}', { 'out/compile_commands.json': DB }, ['--compile-commands-dir=${workspaceFolder}/out'], { db: 'out/compile_commands.json', root: 'out' });
run('the flag pointing at nothing', { 'src/compile_commands.json': DB }, ['--compile-commands-dir=out'], null);

run('.clangd', { '.clangd': 'CompileFlags:\n  CompilationDatabase: out\n', 'out/compile_commands.json': DB }, [], { db: 'out/compile_commands.json', root: 'out' });
run('.clangd, quoted with a comment', { '.clangd': "CompileFlags:\r\n  CompilationDatabase: 'out' # here\r\n", 'out/compile_commands.json': DB }, [], { db: 'out/compile_commands.json', root: 'out' });
run('.clangd relative to itself', { 'src/.clangd': 'CompileFlags:\n  CompilationDatabase: ../out\n', 'out/compile_commands.json': DB }, [], { db: 'out/compile_commands.json', root: 'out' });
run('.clangd saying None', { '.clangd': 'CompileFlags:\n  CompilationDatabase: None\n', 'src/compile_commands.json': DB }, [], null);
run('.clangd saying Ancestors', { '.clangd': 'CompileFlags:\n  CompilationDatabase: Ancestors\n', 'src/compile_commands.json': DB }, [], { db: 'src/compile_commands.json', root: 'src' });
run('.clangd without the key', { '.clangd': 'CompileFlags:\n  Add: [-Wall]\n', 'src/compile_commands.json': DB }, [], { db: 'src/compile_commands.json', root: 'src' });

// The order, as clangd 22 was measured to use it.
run('.clangd beats a database next to the file', { '.clangd': 'CompileFlags:\n  CompilationDatabase: out\n', 'out/compile_commands.json': DB, 'src/compile_commands.json': DB }, [], { db: 'out/compile_commands.json', root: 'out' });
run('the flag beats .clangd', { '.clangd': 'CompileFlags:\n  CompilationDatabase: out\n', 'out/compile_commands.json': DB, 'out2/compile_commands.json': DB }, ['--compile-commands-dir=out2'], { db: 'out2/compile_commands.json', root: 'out2' });

// --- where text guesses are searched, and in what order they come back -------

const W = path.resolve('/ws');
const at = (...parts) => path.join(W, ...parts);
check('folder levels, nearest first', rings(at('src', 'geo', 'a.cpp'), W), [at('src', 'geo'), at('src'), W]);
check('a file at the top is one level', rings(at('a.cpp'), W), [W]);

const here = at('src', 'geo', 'a.cpp');
check('the file itself', distance(here, here), -1);
check('its folder', distance(here, at('src', 'geo', 'b.cpp')), 0);
check('a sibling tree', distance(here, at('include', 'geo', 'a.h')), 4);
check('below its folder', distance(here, at('src', 'geo', 'detail', 'c.cpp')), 1);

const rank = (guesses) => [...guesses].sort(byLikeness).map((g) => g.name);
check('nearer wins a tie', rank([
  { name: 'far', similarity: 50, distance: 3 },
  { name: 'folder', similarity: 50, distance: 0 },
  { name: 'this file', similarity: 50, distance: distance(here, here) },
]), ['this file', 'folder', 'far']);
// Nearness only breaks ties: a declaration in this file must not beat the
// definition elsewhere.
check('more similar beats nearer', rank([
  { name: 'declaration here', similarity: 80, distance: -1 },
  { name: 'definition there', similarity: 100, distance: 4 },
]), ['definition there', 'declaration here']);
check('equal on both keeps the order found', rank([
  { name: 'first', similarity: 50, distance: 2 },
  { name: 'second', similarity: 50, distance: 2 },
]), ['first', 'second']);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
