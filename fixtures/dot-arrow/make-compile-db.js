// SPDX-License-Identifier: MIT
'use strict';

/**
 * Write compile_commands.json next to this script.
 *
 * Without it clangd answers about pointers.cpp from fallback flags rather than
 * from a project it has been told about. Completion still works, so most rows
 * of README.md pass either way - the database is what makes a row that fails
 * mean something about this extension rather than about clangd guessing. It
 * cannot be committed, because clangd ignores an entry whose "directory" is
 * relative (measured on clangd 22), and an absolute one differs per machine.
 *
 *   node fixtures/dot-arrow/make-compile-db.js
 */

const fs = require('fs');
const path = require('path');

const entries = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.cpp'))
  // -Wno-unused-value: every position is an expression statement written for
  // the cursor to sit at the end of, so the warning fires on all of them and
  // fills the file with squiggles that have nothing to do with what is tested.
  .map((file) => ({
    directory: __dirname,
    file,
    arguments: ['clang++', '-std=c++17', '-Wno-unused-value', file],
  }));

fs.writeFileSync(path.join(__dirname, 'compile_commands.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`compile_commands.json: ${entries.length} files. Restart clangd to pick it up.`);
