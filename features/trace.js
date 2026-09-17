// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');

// Where the time of a key press went, one line per press, in the output channel
// named Assist. Always on: a line costs nothing next to a language server
// request, and the slow press is never the one somebody switched logging on
// for. The lines stay in English - they are measurements for whoever reads the
// code next, not interface text - and the last ones go into a saved note.
const KEEP = 200;
const lines = [];
let channel = null;

/** @param {string} text */
function trace(text) {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${text}`;
  lines.push(line);
  if (lines.length > KEEP) lines.shift();
  if (!channel) channel = vscode.window.createOutputChannel('Assist');
  channel.appendLine(line);
}

/** Milliseconds since `start`, as a trace spells them. @param {number} start */
function since(start) {
  return `${Date.now() - start}ms`;
}

function recent() {
  return [...lines];
}

module.exports = { trace, since, recent };
