// SPDX-License-Identifier: MIT
'use strict';

/**
 * Write compile_commands.json next to this script.
 *
 * Without it clangd knows only the files open in the editor: Alt+G on a call in
 * main.cpp finds nothing in shape.cpp until shape.cpp has been opened once. The
 * database is what hands clangd the list of files to index. It cannot be
 * committed, because clangd ignores an entry whose "directory" is relative
 * (measured on clangd 22), and an absolute one is different on every machine.
 *
 *   node fixtures/round-trip/make-compile-db.js
 */

const fs = require('fs');
const path = require('path');

const entries = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.cpp'))
  .map((file) => ({ directory: __dirname, file, arguments: ['clang++', '-std=c++17', file] }));

fs.writeFileSync(path.join(__dirname, 'compile_commands.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`compile_commands.json: ${entries.length} files. Restart clangd to pick it up.`);
