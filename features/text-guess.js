// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
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

/** @param {vscode.TextDocument} document */
function findDatabase(document, folder) {
  const first = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? folder.uri.fsPath;
  const args = vscode.workspace.getConfiguration('clangd', document.uri).get('arguments', []);
  return locateDatabase(document.uri.fsPath, folder.uri.fsPath, args, first);
}

/**
 * Where clangd would find the compilation database for this file, in the order
 * clangd 22 lets them win (measured):
 *  1. --compile-commands-dir in clangd.arguments. The clangd extension expands
 *     ${workspaceFolder} (and workspaceRoot, cwd) to the first workspace folder,
 *     ${userHome} to home, and starts clangd there, so relative paths start
 *     there too - read from its bundle.js, 0.6.0.
 *  2. CompilationDatabase in the nearest .clangd above the file, relative to
 *     that .clangd. It beats a compile_commands.json next to the file.
 *  3. Walking up to the workspace folder, the first folder holding
 *     compile_commands.json directly or under build/.
 * clangd keeps the index in .cache/clangd/index of the database's own folder
 * for 1 and 2, but of the folder above build/ for 3.
 * ponytail: .clangd is read with a regex, first CompilationDatabase line wins;
 * If: blocks, several --- documents and the user's own config.yaml are not
 * seen. A YAML parser is a dependency; add one only if a real project needs it.
 * @param {string} file
 * @param {string} top the file's workspace folder
 * @param {string[]} args clangd.arguments
 * @param {string} first the first workspace folder, where clangd is started
 * @returns {{db: string, root: string} | null}
 */
function locateDatabase(file, top, args, first) {
  const at = (dir) => {
    const db = path.join(dir, 'compile_commands.json');
    return fs.existsSync(db) ? { db, root: dir } : null;
  };

  const flag = args.findIndex((arg) => arg.startsWith('--compile-commands-dir'));
  if (flag >= 0) {
    const raw = args[flag].includes('=') ? args[flag].slice(args[flag].indexOf('=') + 1) : args[flag + 1] || '';
    const dir = raw.replace(/\$\{(workspaceFolder|workspaceRoot|cwd)\}/g, first).replace(/\$\{userHome\}/g, os.homedir());
    return at(path.resolve(first, dir));
  }

  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(dir, '.clangd'), 'utf8');
    } catch {
      // No .clangd here.
    }
    const value = /^\s*CompilationDatabase:\s*['"]?([^'"#\r\n]*?)['"]?\s*(#.*)?$/m.exec(text)?.[1];
    if (value === 'None') return null;
    if (value && value !== 'Ancestors') return at(path.resolve(dir, value));
    if (path.dirname(dir) === dir) break;
  }

  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    for (const candidate of [path.join(dir, 'compile_commands.json'), path.join(dir, 'build', 'compile_commands.json')]) {
      if (fs.existsSync(candidate)) return { db: candidate, root: dir };
    }
    if (dir === top || path.dirname(dir) === dir) return null;
  }
}

// Both reads below block the extension host, and on a large project they are
// not free - measured with 20,000 entries and 40,000 index files: 250 ms to
// parse the database, 60 ms to list the index folder. So the database is read
// again only when it changes, the folder at most every few seconds, and not at
// all once every entry has been seen indexed: clangd does not delete index
// files, so "done" only goes back when the database gains files, which changes
// its mtime.
const RECOUNT_MS = 5000;
let cached = { db: '', mtime: 0, names: [], progress: null, countedAt: 0 };

/** @param {{db: string, root: string}} found */
function counted(found) {
  const mtime = fs.statSync(found.db).mtimeMs;
  if (cached.db !== found.db || cached.mtime !== mtime) {
    const entries = JSON.parse(fs.readFileSync(found.db, 'utf8'));
    const files = new Set(entries.map((entry) => path.resolve(entry.directory || '', entry.file)));
    cached = { db: found.db, mtime, names: [...files].map((file) => path.basename(file)), progress: null, countedAt: 0 };
  }
  const { progress } = cached;
  if (progress && (progress.done >= progress.total || Date.now() - cached.countedAt < RECOUNT_MS)) return progress;

  let indexed = new Set();
  try {
    indexed = new Set(
      fs.readdirSync(path.join(found.root, '.cache', 'clangd', 'index')).map((file) => file.replace(/\.[0-9A-F]+\.idx$/, '')),
    );
  } catch {
    // No index folder yet: nothing done.
  }
  cached.progress = { done: cached.names.filter((name) => indexed.has(name)).length, total: cached.names.length };
  cached.countedAt = Date.now();
  return cached.progress;
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
  // Everything below is clangd's index. With clangd not installed or switched
  // off, cpptools answers on its own schedule, and reading clangd's files would
  // cut its answers short at the indexing wait and blame a missing database.
  if (!clangdRunning(document)) return null;
  // A file outside every workspace folder has no project to have indexed.
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return null;
  const found = findDatabase(document, folder);
  if (!found) return { missing: true };
  try {
    return counted(found);
  } catch {
    return null;
  }
}

/**
 * The clangd extension activates on C++ files whether or not it starts the
 * server, so being active is not enough - `clangd.enable: false` keeps it idle.
 * @param {vscode.TextDocument} document
 */
function clangdRunning(document) {
  const clangd = vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd');
  return !!clangd && vscode.workspace.getConfiguration('clangd', document.uri).get('enable', true);
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

  const guesses = [];
  const found = new Promise((resolve) => {
    // Read as it arrives and stop ripgrep the moment there are enough
    // candidates - waiting for it to exit would spend the whole time limit
    // walking the rest of a large tree for matches nobody will see.
    const child = spawn(rg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    running = child;
    const timer = setTimeout(() => child.kill(), SEARCH_MS);
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        if (guesses.length >= MAX_CANDIDATES) break;
        const guess = toGuess(line, word);
        if (guess) guesses.push(guess);
      }
      if (guesses.length >= MAX_CANDIDATES) child.kill();
    });
    child.on('error', () => resolve());
    child.on('close', () => {
      clearTimeout(timer);
      const last = pending && guesses.length < MAX_CANDIDATES ? toGuess(pending, word) : null;
      if (last) guesses.push(last);
      if (running === child) running = null;
      resolve();
    });
  });

  return found.then(async () => {
    const context = callSite(document.lineAt(pos.line).text, range ? range.start.character : 0, word);
    // The namespace signal needs the text above each match. Read each file once,
    // off the extension host's thread, and only when there is a qualifier to check.
    const texts = new Map();
    if (context.qualifier) {
      const files = [...new Set(guesses.map((guess) => guess.loc.uri.fsPath))];
      await Promise.all(
        files.map((file) =>
          fs.promises.readFile(file, 'utf8').then(
            (text) => texts.set(file, text.split(/\r?\n/)),
            () => texts.set(file, []),
          ),
        ),
      );
    }
    for (const guess of guesses) guess.similarity = similarity(guess, context, document, related, texts);
    return guesses.sort((a, b) => b.similarity - a.similarity);
  });
}

/**
 * One line of ripgrep output as a guess, or null for a line that is not one.
 * @param {string} line @param {string} word
 */
function toGuess(line, word) {
  const match = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!match || /^\s*(return|else|case|throw|co_return|new|delete|goto)\b/.test(match[3])) return null;
  // Land on the name, not on the start of the line the pattern matched from.
  const column = Math.max(0, match[3].search(new RegExp(`\\b${word}\\b`)));
  return {
    kind: 'text',
    label: match[3].trim().slice(0, 60),
    text: match[3],
    rest: match[3].slice(column + word.length),
    loc: new vscode.Location(vscode.Uri.file(match[1]), new vscode.Position(Number(match[2]) - 1, column)),
  };
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
 * @param {string[]} lines @param {number} line
 */
function enclosing(lines, line) {
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
 * @param {Map<string, string[]>} texts each guessed file's lines, when a qualifier needs them
 */
function similarity(guess, context, document, related, texts) {
  const file = guess.loc.uri.fsPath;
  const stem = (p) => path.basename(p).replace(/\.[^.]*$/, '');
  const signals = [
    // shape.h answered, shape.cpp guessed: the other half of the same pair.
    [3, [document.uri.fsPath, ...related.map((loc) => loc.uri.fsPath)].some((p) => p !== file && stem(p) === stem(file))],
    [3, context.qualifier === null ? null : guess.text.includes(`${context.qualifier}::`) || enclosing(texts.get(file) || [], guess.loc.range.start.line) === context.qualifier],
    [2, context.arity === null ? null : arity(guess.rest) === context.arity],
    [1, !guess.text.trimEnd().endsWith(';')],
    [1, path.dirname(file) === path.dirname(document.uri.fsPath)],
  ].filter(([, hit]) => hit !== null);
  const possible = signals.reduce((sum, [weight]) => sum + weight, 0);
  const earned = signals.reduce((sum, [weight, hit]) => sum + (hit ? weight : 0), 0);
  return Math.round((earned / possible) * 100);
}

module.exports = { indexProgress, isComplete, describeProgress, textGuesses, locateDatabase };
