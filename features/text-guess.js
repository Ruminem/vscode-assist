// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Stop-gap for the round trip while clangd is not ready yet. Two things, both
// read from outside clangd rather than from its protocol, which another
// extension cannot see: how far the background index has got, from the files it
// leaves on disk, and a plain text search that guesses where a name is defined.
// Neither is an index of this extension's own - the guesses are thrown away as
// soon as they are shown.

const CPP = /^(c|cpp|cuda-cpp|objective-c|objective-cpp)$/;
const GLOBS = ['*.c', '*.cc', '*.cpp', '*.cxx', '*.h', '*.hh', '*.hpp', '*.hxx', '*.inl', '*.ipp'];

// The limits that keep a guess from turning into a scan of the whole disk.
// Collected past what the menu shows, so the ranking has something to choose from.
const MAX_CANDIDATES = 50;
const PER_FILE = 5;
const MAX_FILESIZE = '2M';
const SEARCH_MS = 1500;
const MIN_WORD = 3;

// Names a text search would find everywhere and learn nothing from.
const SKIP = new Set(
  'auto bool break case catch char class const continue default delete do double else enum explicit extern false float for friend goto if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' '),
);

/**
 * Where clangd would find the compilation database for this file: walking up
 * from it, the first folder holding compile_commands.json directly or under
 * build/. clangd keeps the index in .cache/clangd/index of that folder - for
 * build/ too, measured on clangd 22.
 * ponytail: ignores --compile-commands-dir and .clangd's CompilationDatabase;
 * a project that moves the database there reads as having none.
 * @param {vscode.TextDocument} document
 */
function findDatabase(document, folder) {
  const top = folder.uri.fsPath;
  for (let dir = path.dirname(document.uri.fsPath); ; dir = path.dirname(dir)) {
    for (const candidate of [path.join(dir, 'compile_commands.json'), path.join(dir, 'build', 'compile_commands.json')]) {
      if (fs.existsSync(candidate)) return { db: candidate, root: dir };
    }
    if (dir === top || path.dirname(dir) === dir) return null;
  }
}

// A real database runs to megabytes; read it again only when it changes.
let cached = { db: '', mtime: 0, names: [] };

/** @param {string} db */
function sourceNames(db) {
  const mtime = fs.statSync(db).mtimeMs;
  if (cached.db !== db || cached.mtime !== mtime) {
    const entries = JSON.parse(fs.readFileSync(db, 'utf8'));
    const files = new Set(entries.map((entry) => path.resolve(entry.directory || '', entry.file)));
    cached = { db, mtime, names: [...files].map((file) => path.basename(file)) };
  }
  return cached.names;
}

/**
 * How much of the project clangd has indexed, or null where that does not
 * apply. clangd writes one "<file>.<hash>.idx" per indexed file and keeps them
 * across restarts, so the count of database entries that have one is the
 * share done.
 * ponytail: matched by file name, so two main.cpp in one project count as one.
 * Good enough for a percentage; wrong for anything exact.
 * @param {vscode.TextDocument} document
 * @returns {{done: number, total: number} | {missing: true} | null}
 */
function indexProgress(document) {
  if (!CPP.test(document.languageId) || document.uri.scheme !== 'file') return null;
  // A file outside every workspace folder has no project to have indexed.
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return null;
  const found = findDatabase(document, folder);
  if (!found) return { missing: true };
  try {
    const names = sourceNames(found.db);
    let indexed = new Set();
    try {
      indexed = new Set(
        fs.readdirSync(path.join(found.root, '.cache', 'clangd', 'index')).map((file) => file.replace(/\.[0-9A-F]+\.idx$/, '')),
      );
    } catch {
      // No index folder yet: nothing done.
    }
    return { done: names.filter((name) => indexed.has(name)).length, total: names.length };
  } catch {
    return null;
  }
}

/** @param {ReturnType<typeof indexProgress>} progress */
function isComplete(progress) {
  return !progress || (!progress.missing && progress.done >= progress.total);
}

/** @param {ReturnType<typeof indexProgress>} progress */
function describeProgress(progress) {
  if (!progress) return '';
  if (progress.missing) return vscode.l10n.t('clangd index: no compile_commands.json found, so only open files are indexed');
  const percent = progress.total ? Math.floor((progress.done / progress.total) * 100) : 100;
  return vscode.l10n.t('clangd index: {0}% ({1}/{2} files)', percent, progress.done, progress.total);
}

/**
 * VS Code ships ripgrep for its own search, and the extension API that would
 * use it (findTextInFiles) is still proposed, so run the binary directly. Its
 * place inside the install has moved between releases, hence the list.
 */
function ripgrep() {
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const arch = `${process.platform}-${process.arch}`;
  const root = vscode.env.appRoot;
  return [
    path.join(root, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', arch, exe),
    path.join(root, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe),
    path.join(root, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
  ].find((candidate) => fs.existsSync(candidate));
}

let running = null;

// Files enclosing() has read during the current search, so fifty matches in one
// file read it once. Cleared per search.
const read = new Map();

/**
 * Lines that look like a definition or declaration of `word`: a type keyword
 * before it, or a line that starts with a type and has the name right before
 * a paren. Calls mostly fail the second shape - they follow `=`, `(`, `.` or
 * `->` - and the keywords that can start a call statement are dropped after.
 * @param {vscode.TextDocument} document @param {vscode.Position} pos
 * @param {vscode.Location[]} related where the language server did answer
 * @returns {Promise<{kind: string, label: string, similarity: number, loc: vscode.Location}[]>}
 *   most similar first, all of them - the caller drops what it already has
 *   before cutting the list
 */
function textGuesses(document, pos, related) {
  const range = document.getWordRangeAtPosition(pos);
  const word = range ? document.getText(range) : '';
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder || word.length < MIN_WORD || SKIP.has(word) || !/^\w+$/.test(word)) return Promise.resolve([]);
  const rg = ripgrep();
  if (!rg) return Promise.resolve([]);

  // One search at a time: a second press while the first is still out means
  // the first answer is no longer wanted.
  if (running) running.kill();
  const pattern = `\\b(class|struct|union|enum|namespace)\\s+${word}\\b|^\\s*[A-Za-z_][\\w:<>,*&\\s]*[\\s*&:]${word}\\s*\\(`;
  const args = ['--no-heading', '--line-number', '--max-count', String(PER_FILE), '--max-filesize', MAX_FILESIZE];
  for (const glob of GLOBS) args.push('-g', glob);
  args.push('-e', pattern, '--', folder.uri.fsPath);

  return new Promise((resolve) => {
    const child = execFile(rg, args, { timeout: SEARCH_MS, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
      if (running === child) running = null;
      const guesses = [];
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const match = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!match || /^\s*(return|else|case|throw|co_return|new|delete|goto)\b/.test(match[3])) continue;
        // Land on the name, not on the start of the line the pattern matched from.
        const column = Math.max(0, match[3].search(new RegExp(`\\b${word}\\b`)));
        guesses.push({
          kind: 'text',
          label: match[3].trim().slice(0, 60),
          text: match[3],
          rest: match[3].slice(column + word.length),
          loc: new vscode.Location(vscode.Uri.file(match[1]), new vscode.Position(Number(match[2]) - 1, column)),
        });
        if (guesses.length >= MAX_CANDIDATES) break;
      }
      read.clear();
      const context = callSite(document.lineAt(pos.line).text, range ? range.start.character : 0, word);
      for (const guess of guesses) guess.similarity = similarity(guess, context, document, related);
      resolve(guesses.sort((a, b) => b.similarity - a.similarity));
    });
    running = child;
  });
}

/**
 * What the cursor's own line says about the symbol: the qualifier written in
 * front of the name (`geo::scale` gives `geo`), and how many arguments follow
 * it when it is a call. Either is null when the line does not say.
 * @param {string} line @param {number} start @param {string} word
 */
function callSite(line, start, word) {
  const before = /(\w+)::$/.exec(line.slice(0, start));
  return { qualifier: before ? before[1] : null, arity: arity(line.slice(start + word.length)) };
}

/**
 * Top-level arguments in the parenthesis that opens `rest`, or null when rest
 * does not open one or does not close it on this line.
 * @param {string} rest
 */
function arity(rest) {
  const open = /^\s*\(/.exec(rest);
  if (!open) return null;
  let depth = 0;
  let commas = 0;
  let empty = true;
  for (const char of rest.slice(open[0].length)) {
    if (depth === 0 && char === ')') return empty ? 0 : commas + 1;
    if ('([{<'.includes(char)) depth++;
    else if (')]}>'.includes(char)) depth--;
    else if (depth === 0 && char === ',') commas++;
    if (!/\s/.test(char)) empty = false;
  }
  return null;
}

/**
 * The name of the nearest namespace, class or struct opened above `line`, for a
 * definition that sits inside `namespace geo {` rather than spelling `geo::`.
 * ponytail: nearest opener, not the enclosing one - a namespace closed just
 * above still counts. Brace matching would fix it; a guess does not need it.
 * @param {string} file @param {number} line
 */
function enclosing(file, line) {
  if (!read.has(file)) {
    try {
      read.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/));
    } catch {
      read.set(file, []);
    }
  }
  const lines = read.get(file);
  for (let i = line - 1; i >= 0; i--) {
    const match = /^\s*(?:namespace|class|struct)\s+(\w+)[^;]*$/.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

/**
 * How much a text match looks like the symbol asked about, as a whole percent.
 * Only signals a line of text can carry, each weighted, and a signal the
 * cursor's line gives nothing to compare with (no qualifier written, not a
 * call) is left out of the total rather than counted as a miss. Ties keep
 * ripgrep's order.
 * @param {{text: string, rest: string, loc: vscode.Location}} guess
 * @param {{qualifier: string | null, arity: number | null}} context
 * @param {vscode.TextDocument} document @param {vscode.Location[]} related
 */
function similarity(guess, context, document, related) {
  const file = guess.loc.uri.fsPath;
  const stem = (p) => path.basename(p).replace(/\.[^.]*$/, '');
  const signals = [
    // shape.h answered, shape.cpp guessed: the other half of the same pair.
    [3, [document.uri.fsPath, ...related.map((loc) => loc.uri.fsPath)].some((p) => p !== file && stem(p) === stem(file))],
    [3, context.qualifier === null ? null : guess.text.includes(`${context.qualifier}::`) || enclosing(file, guess.loc.range.start.line) === context.qualifier],
    [2, context.arity === null ? null : arity(guess.rest) === context.arity],
    [1, !guess.text.trimEnd().endsWith(';')],
    [1, path.dirname(file) === path.dirname(document.uri.fsPath)],
  ].filter(([, hit]) => hit !== null);
  const possible = signals.reduce((sum, [weight]) => sum + weight, 0);
  const earned = signals.reduce((sum, [weight, hit]) => sum + (hit ? weight : 0), 0);
  return Math.round((earned / possible) * 100);
}

module.exports = { indexProgress, isComplete, describeProgress, textGuesses };
