#!/usr/bin/env node
'use strict';

// Ask clangd itself what it answers to a dot, one fixture position at a time.
//
//   node tools/probe-clangd.js                       fixtures/dot-arrow
//   node tools/probe-clangd.js <fixture dir>
//   node tools/probe-clangd.js --clangd=<path>       or set CLANGD
//
// No editor and no extension host: this speaks LSP to clangd over a pipe. That
// is the point. features/dot-arrow.js decides whether to convert a dot purely
// from the shape of a completion answer, and the only way to know what that
// shape really is, is to ask the server rather than to reason about C++.
//
// It matters because reasoning about C++ got it wrong once. The rule used to be
// "the server offered an arrow", which sounds right and is not: a class with
// operator-> offers one too, so unique_ptr, shared_ptr and every iterator would
// have had `.reset()` rewritten to `->reset()`. One run of this printed the
// counts that show why - and it is countEdits() itself, the shipped function,
// that is run against the answers below, so the verdict column is the real
// decision on real server output rather than a second copy of the rule.
//
// This measures; it does not assert. The expected outcome of each position
// lives in the fixture's own README, in one place, and a second copy here would
// be one more thing to keep in step. Exit code is 0 when it measured, 2 when it
// could not (no clangd, no compile database, no answers) - never 1, so that a
// failure to measure is never read as a measurement.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'fixtures', 'dot-arrow'));

function give(up) {
  console.log(up);
  process.exit(2);
}

/** Repository-relative while that is shorter, absolute once it starts climbing out. */
function show(target) {
  const relative = path.relative(ROOT, target);
  return relative.startsWith('..') ? target : relative;
}

/**
 * A clangd to talk to. The one the clangd extension downloads lives under the
 * editor's globalStorage and is named in the `clangd.path` setting, so it is
 * given rather than guessed at; the versioned names are for a clangd installed
 * by a package manager, which is what a machine without the extension has.
 */
function findClangd() {
  const named = flag('clangd') || process.env.CLANGD;
  const candidates = named
    ? [named]
    : ['clangd', 'clangd-20', 'clangd-19', 'clangd-18', 'clangd-17', 'clangd-16'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return { bin: candidate, version: (probe.stdout || '').split('\n')[0] };
  }
  return null;
}

// features/dot-arrow.js requires vscode, which exists only inside the editor.
// countEdits touches Position.isAfter and nothing else.
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
  Range: class {},
  workspace: { onDidChangeTextDocument() {} },
  window: {},
  commands: {},
  WorkspaceEdit: class {},
};
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? stub : load(request, parent, isMain));
const { countEdits, leftOfDot, ASKED } = require(path.join(ROOT, 'features', 'dot-arrow.js'));

/** An LSP item, with its ranges rebuilt out of the Positions countEdits expects. */
function asVsCode(item) {
  const edit = (e) =>
    e && e.range ? { range: { start: new Position(e.range.start.line, e.range.start.character), end: new Position(e.range.end.line, e.range.end.character) }, newText: e.newText } : undefined;
  return {
    textEdit: edit(item.textEdit),
    additionalTextEdits: (item.additionalTextEdits || []).map(edit),
  };
}

const clangd = findClangd();
if (!clangd) {
  give(
    'No clangd to ask.\n' +
      '  Pass one with --clangd=<path>, or set CLANGD.\n' +
      "  The clangd extension keeps its own under the editor's globalStorage; the\n" +
      '  `clangd.path` setting names it. A package manager one (clangd-18 and the\n' +
      '  like) is found on PATH automatically.',
  );
}

const file = path.join(dir, 'pointers.cpp');
if (!fs.existsSync(file)) give(`No ${show(file)} to probe.`);
if (!fs.existsSync(path.join(dir, 'compile_commands.json'))) {
  give(
    `No compile_commands.json in ${show(dir)}.\n` +
      `  Run: node ${show(path.join(dir, 'make-compile-db.js'))}`,
  );
}

// pathToFileURL, not `file://` glued to the path: on Windows that gives
// `file://C:\...`, which clangd 22 drops without a word - the file is never
// parsed and every run times out.
const uri = pathToFileURL(file).href;
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Each position is the line after its `// [n]` marker, with the dot typed just
// before the `;` that ends the statement - how the fixture README says to press
// it. A row whose case is the marker line itself, a dot inside a comment or a
// string, cannot be reached this way; tools/check-dot-arrow.js covers those.
const spots = [];
lines.forEach((line, i) => {
  const marker = /^\s*\/\/ \[(\d+)\]/.exec(line);
  if (!marker) return;
  const target = lines[i + 1];
  const semi = target ? target.lastIndexOf(';') : -1;
  if (semi < 0) return;
  spots.push({ n: Number(marker[1]), line: i + 1, character: semi, text: target.trim() });
});
if (spots.length === 0) give('No `// [n]` positions found.');

const child = spawn(clangd.bin, [`--compile-commands-dir=${dir}`, '--background-index=false'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.on('error', (error) => give(`Could not start ${clangd.bin}: ${error.message}`));

let seq = 0;
const waiting = new Map();
const seen = new Set();
let watch = null;

function send(method, params, notify) {
  const message = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++seq, method, params };
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
  if (notify) return Promise.resolve();
  return new Promise((resolve) => waiting.set(message.id, resolve));
}

/**
 * Wait until clangd has built the AST for this version of the file.
 *
 * Without this the answers are worthless in a way that looks like data: clangd
 * falls back to identifiers out of its index, every position comes back with
 * the same long list, and nothing carries an edit. Diagnostics carrying the
 * version are clangd saying the real parse is done.
 */
function built(version) {
  if (seen.has(version)) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => (watch = { version, resolve })),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 20000)),
  ]);
}

let buffer = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const header = buffer.indexOf('\r\n\r\n');
    if (header < 0) return;
    const match = /Content-Length: (\d+)/.exec(buffer.slice(0, header).toString());
    if (!match) return;
    const length = Number(match[1]);
    if (buffer.length < header + 4 + length) return;
    const message = JSON.parse(buffer.slice(header + 4, header + 4 + length).toString('utf8'));
    buffer = buffer.slice(header + 4 + length);
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message.result);
      waiting.delete(message.id);
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      seen.add(message.params.version);
      if (watch && watch.version === message.params.version) {
        watch.resolve();
        watch = null;
      }
    }
  }
});

/** The document as it is the instant after the dot was typed. */
function typed(spot) {
  const copy = [...lines];
  copy[spot.line] = copy[spot.line].slice(0, spot.character) + '.' + copy[spot.line].slice(spot.character);
  return copy.join('\n');
}

(async () => {
  await send('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(dir).href,
    capabilities: {
      textDocument: {
        publishDiagnostics: { versionSupport: true },
        completion: {
          // clangd's own capability. Without it clangd keeps every edit at or
          // after the cursor, which would leave the dot standing and make the
          // arrow invisible here. VS Code's clangd client sets it, so setting
          // it is what makes this run resemble the editor rather than differ
          // from it - measured: with it off, every position answers `no`.
          editsNearCursor: true,
          completionItem: { snippetSupport: true },
        },
      },
    },
  });
  await send('initialized', {}, true);

  console.log(`${clangd.version}`);
  console.log(`${show(dir)}\n`);
  console.log('  #  typed here              answers   arrow  plain   dot-arrow would');
  console.log('  -  ----------              -------   -----  -----   ---------------');

  let version = 1;
  await send('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version, text: lines.join('\n') } }, true);
  if ((await built(version)) === 'timeout') give('\nclangd never reported the file as parsed. Check compile_commands.json.');

  let answered = 0;
  for (const spot of spots) {
    await send('textDocument/didChange', {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text: typed(spot) }],
    }, true);
    await built(version);

    const dot = new Position(spot.line, spot.character);
    const answer = await send('textDocument/completion', {
      textDocument: { uri },
      position: { line: spot.line, character: spot.character + 1 },
      context: { triggerKind: 2, triggerCharacter: '.' },
    });
    const items = (Array.isArray(answer) ? answer : (answer && answer.items) || []).map(asVsCode);
    if (items.length) answered++;

    // The shipped rule, run on what the server actually said. The left-of-dot
    // test comes first in the feature, so a position it never asks about is
    // reported as such rather than as a server answer.
    const left = leftOfDot(lines[spot.line].slice(0, spot.character));
    const { arrowed, plain } = countEdits({ items }, dot);
    const verdict =
      !ASKED.has(left) ? `not ask (${left})` : arrowed > 0 && plain === 0 ? 'CONVERT' : 'leave the dot';

    console.log(
      `  ${String(spot.n).padStart(2)}  ${spot.text.slice(0, 22).padEnd(22)}  ` +
        `${String(items.length).padStart(7)}  ${String(arrowed).padStart(5)}  ${String(plain).padStart(5)}   ${verdict}`,
    );
  }

  console.log(`\nExpected outcomes are in ${show(path.join(dir, 'README.md'))}.`);
  console.log('Rows whose case is a comment or a string interior are not reachable this way;');
  console.log('tools/check-dot-arrow.js covers those.');

  await send('shutdown', {});
  await send('exit', {}, true);
  child.kill();
  process.exit(answered === 0 ? 2 : 0);
})();
