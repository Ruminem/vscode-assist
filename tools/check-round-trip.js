#!/usr/bin/env node
'use strict';

// What features/round-trip.js offers for one press of Alt+G, checked without an
// editor or a language server.
//
//   node tools/check-round-trip.js
//
// This exists for the name search while clangd is still indexing. The providers
// are cut at the indexing deadline then, nothing anchors the name search to a
// namespace, and every symbol that shares the name used to come back - a call
// to geo::scale(2) offered ui::scale on top. The qualifier written at the call
// is what tells them apart, and the cases below pin that.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const path = require('path');
const Module = require('module');

// --- a vscode small enough to stand in for honestly --------------------------

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  translate(dl = 0, dc = 0) {
    return new Position(this.line + dl, this.character + dc);
  }
  isEqual(o) {
    return this.line === o.line && this.character === o.character;
  }
  compare(o) {
    return this.line - o.line || this.character - o.character;
  }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'number') {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    } else {
      this.start = a;
      this.end = b;
    }
  }
  contains(p) {
    return this.start.compare(p) <= 0 && p.compare(this.end) <= 0;
  }
}
const uri = (p) => ({ path: p, fsPath: p, scheme: 'file', toString: () => `file://${p}` });
class Location {
  constructor(u, r) {
    this.uri = u;
    this.range = r instanceof Range ? r : new Range(r, r);
  }
}

// The shape of fixtures/round-trip case [8]: one name in two namespaces, and a
// third namespace nested so that its container ends in the qualifier.
const FILES = {
  '/w/main.cpp': ['#include "shape.h"', 'int main() {', '  geo::scale(2);', '  scale(2);', '  gfx::scale(2);', '}'],
  '/w/shape.cpp': ['namespace geo {', 'void scale(int) {}', '}', 'namespace ui {', 'void scale(int) {}', '}'],
  '/w/app.cpp': ['namespace app::geo {', 'void scale(int) {}', '}'],
};
const doc = (p) => ({
  uri: uri(p),
  languageId: 'cpp',
  version: 1,
  lineCount: FILES[p].length,
  lineAt: (l) => ({ text: FILES[p][l] }),
  getText: (r) => FILES[p][r.start.line].slice(r.start.character, r.end.character),
  getWordRangeAtPosition(pos) {
    const re = /\w+/g;
    let m;
    while ((m = re.exec(FILES[p][pos.line])))
      if (m.index <= pos.character && pos.character <= m.index + m[0].length)
        return new Range(pos.line, m.index, pos.line, m.index + m[0].length);
    return undefined;
  },
});
const L = (p, line, ch, len) => new Location(uri(p), new Range(line, ch, line, ch + len));

const UI = { name: 'scale', containerName: 'ui', location: L('/w/shape.cpp', 4, 5, 5) };
const GEO = { name: 'scale', containerName: 'geo', location: L('/w/shape.cpp', 1, 5, 5) };
const APP_GEO = { name: 'scale', containerName: 'app::geo', location: L('/w/app.cpp', 1, 5, 5) };

// One press: where the cursor is, whether the index is done, what the providers
// and the name search answer. 'hang' is clangd sitting on a request mid-index.
let press = null;
let seen = null;
let provider = null;
const editor = { document: doc('/w/main.cpp'), selection: null };
const stub = {
  Position,
  Range,
  Location,
  Selection: class {
    constructor(a) {
      this.active = a;
    }
  },
  Uri: { file: uri },
  l10n: { t: (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]) },
  CodeActionKind: { Empty: { append: (v) => ({ value: v, contains: (o) => o.value === v }) } },
  CodeAction: class {
    constructor(title, kind) {
      this.title = title;
      this.kind = kind;
    }
  },
  ProgressLocation: { Window: 10 },
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
  languages: {
    registerCodeActionsProvider: (_s, p) => {
      provider = p;
      return { dispose() {} };
    },
  },
  workspace: {
    textDocuments: Object.keys(FILES).map(doc),
    openTextDocument: async (u) => doc(u.fsPath),
    asRelativePath: (u) => u.fsPath.replace('/w/', ''),
    getConfiguration: () => ({ get: (_k, d) => d }),
  },
  window: {
    activeTextEditor: editor,
    withProgress: (_o, task) => task(),
    setStatusBarMessage() {},
    showTextDocument: async (d) => ({
      set selection(s) {
        seen = [`jump @ ${d.uri.fsPath.replace('/w/', '')}:${s.active.line + 1}`];
      },
      revealRange() {},
    }),
    visibleTextEditors: [],
  },
  commands: {
    async executeCommand(cmd) {
      if (cmd === 'editor.action.codeAction') {
        const rows = provider.provideCodeActions(editor.document, null, {
          only: { value: 'assist.roundTrip', contains: () => true },
        });
        // The preview of the target line sits between the name and the place.
        seen = rows.map((row) => row.title.replace(/  —  .*  ·  /, ' @ '));
        return;
      }
      if (cmd === 'vscode.executeWorkspaceSymbolProvider') return press.symbols;
      if (press.providers === 'hang') return new Promise(() => {});
      const step = {
        'vscode.executeDefinitionProvider': 'definition',
        'vscode.executeDeclarationProvider': 'declaration',
      }[cmd];
      return press.providers[step] || [];
    },
  },
};

const load = Module._load;
Module._load = (request, parent, isMain) => {
  if (request === 'vscode') return stub;
  if (/trace$/.test(request)) return { trace() {}, since: () => '' };
  return load(request, parent, isMain);
};
// Everything of text-guess but the index and the disk: callSite is the real one.
const textGuess = require(path.join(__dirname, '..', 'features', 'text-guess.js'));
textGuess.indexProgress = () => (press.indexing ? { done: 10, total: 100 } : null);
textGuess.isComplete = (p) => !p;
textGuess.describeProgress = () => 'index 10%';
textGuess.textGuesses = async () => [];
// The indexing deadline is two seconds of nothing happening; a few milliseconds
// of nothing happening reads the same here.
const realTimeout = setTimeout;
global.setTimeout = (fn, ms, ...rest) => realTimeout(fn, Math.min(ms, 20), ...rest);
const { commands } = require(path.join(__dirname, '..', 'features', 'round-trip.js'));

let failed = 0;
async function check(name, setup, expect) {
  press = setup;
  seen = null;
  editor.selection = { active: new Position(setup.line, setup.col) };
  await commands['assist.roundTrip']();
  const ok = JSON.stringify(seen) === JSON.stringify(expect);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(seen)}\n     want ${JSON.stringify(expect)}`}`);
}

(async () => {
  // --- while indexing: the providers never answer -----------------------------

  await check(
    'the written qualifier keeps its own namespace',
    { line: 2, col: 7, indexing: true, providers: 'hang', symbols: [UI, GEO] },
    ['jump @ shape.cpp:2'],
  );
  await check(
    'a nested namespace ending in the qualifier counts',
    { line: 2, col: 7, indexing: true, providers: 'hang', symbols: [UI, APP_GEO, GEO] },
    ['By name · app::geo::scale @ app.cpp:2', 'By name · geo::scale @ shape.cpp:2', 'index 10%'],
  );
  await check(
    'no qualifier keeps every name',
    { line: 3, col: 3, indexing: true, providers: 'hang', symbols: [UI, GEO] },
    ['By name · ui::scale @ shape.cpp:5', 'By name · geo::scale @ shape.cpp:2', 'index 10%'],
  );
  await check(
    'a qualifier nothing matches keeps every name',
    { line: 4, col: 7, indexing: true, providers: 'hang', symbols: [UI, GEO] },
    ['By name · ui::scale @ shape.cpp:5', 'By name · geo::scale @ shape.cpp:2', 'index 10%'],
  );

  // --- a finished index: the providers decide ---------------------------------

  await check(
    'two provider answers do not wait for the name search',
    {
      line: 2,
      col: 7,
      indexing: false,
      providers: { definition: [L('/w/shape.cpp', 1, 5, 5)], declaration: [L('/w/main.cpp', 0, 0, 1)] },
      symbols: [UI, GEO],
    },
    ['Definition @ shape.cpp:2', 'Declaration @ main.cpp:1'],
  );

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
