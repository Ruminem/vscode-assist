// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A debugging aid: where the time of a key press went, one line per press. Off
// until started, because the lines carry file paths, symbol names and search
// queries. While it runs they go to a temporary file - not an output channel,
// which VS Code copies into its session logs - and the status bar says so;
// clicking it stops. Stopping asks where to save the file, and the temporary
// one is deleted whether it was saved or not. The lines stay in English - they
// are measurements for whoever reads the code next, not interface text - and
// the last ones also go into a saved note.
const KEEP = 200;
const PREFIX = 'assist-trace-';
const lines = [];
let file = null;
// A stopped trace waiting on the save dialog, still to be deleted.
let saving = null;
let item = null;

/** @param {string} text */
function trace(text) {
  if (!file) return;
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${text}`;
  lines.push(line);
  if (lines.length > KEEP) lines.shift();
  try {
    fs.appendFileSync(file, line + os.EOL);
  } catch {
    // A temp folder that went away loses the file, not the key press.
  }
}

/** Milliseconds since `start`, as a trace spells them. @param {number} start */
function since(start) {
  return `${Date.now() - start}ms`;
}

function recent() {
  return [...lines];
}

function tracing() {
  return !!file;
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

/** @param {string | null} target */
function remove(target) {
  if (!target) return;
  try {
    fs.unlinkSync(target);
  } catch {
    // Already gone.
  }
}

/**
 * Files left by a window that closed without shutting down - a crash, a killed
 * process, the machine turning off. Each file names the extension host that
 * wrote it, and only files whose process is gone are removed: another window
 * tracing right now has its own extension host and its file stays.
 */
function sweep() {
  let names = [];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    const match = new RegExp(`^${PREFIX}(\\d+)-`).exec(name);
    if (!match || Number(match[1]) === process.pid) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      // EPERM means the process exists and belongs to someone else.
      if (error.code === 'ESRCH') remove(path.join(os.tmpdir(), name));
    }
  }
}

async function toggle() {
  if (!item) {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    item.text = `$(record) ${vscode.l10n.t('Assist: tracing')}`;
    item.tooltip = vscode.l10n.t('Click to stop tracing');
    item.command = 'assist.toggleTrace';
  }
  if (!file) {
    // A fresh start, so a note taken later holds only this run's presses.
    lines.length = 0;
    file = path.join(os.tmpdir(), `${PREFIX}${process.pid}-${stamp()}.txt`);
    trace('tracing started');
    item.show();
    return;
  }

  trace('tracing stopped');
  const temp = file;
  saving = temp;
  file = null;
  item.hide();
  try {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `assist-trace-${stamp()}.txt`)),
      filters: { [vscode.l10n.t('Text')]: ['txt'] },
      title: vscode.l10n.t('Save the trace'),
    });
    if (target) {
      fs.copyFileSync(temp, target.fsPath);
      vscode.window.setStatusBarMessage(`$(check) ${vscode.l10n.t('Trace saved to {0}', target.fsPath)}`, 5000);
    }
  } catch (error) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not save the trace: {0}', String(error.message || error)));
  } finally {
    remove(temp);
    saving = null;
  }
}

// Closing the window ends the extension host, which calls this: an unsaved
// trace is not kept.
function deactivate() {
  remove(file);
  remove(saving);
  file = null;
}

sweep();

module.exports = {
  trace,
  since,
  recent,
  tracing,
  deactivate,
  commands: {
    'assist.toggleTrace': toggle,
  },
};
