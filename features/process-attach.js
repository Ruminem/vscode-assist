// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const { execFile } = require('child_process');

// The debugger belongs to the C/C++ extension, not to this one. What that
// extension exposes is its process picker - extension.pickNativeProcess, which
// resolves to the chosen process id and rejects when the picker is closed (see
// Extension/src/Debugger/attachQuickPick.ts in microsoft/vscode-cpptools, MIT) -
// and the cppvsdbg debug type. Nothing of it is bundled here: its debugger
// binaries are under Microsoft's own licence, and both are reached through
// VS Code at run time.
const CPPTOOLS = 'ms-vscode.cpptools';

// The executable name of the process attached last, for Reattach.
// ponytail: kept per window and forgotten when the window reloads. Move it into
// workspaceState if features ever get the extension context.
let lastName = null;

function supported() {
  if (process.platform !== 'win32') {
    // ponytail: cppvsdbg is Windows only, and it is the debugger that attaches
    // from a process id alone. cppdbg (gdb/lldb) would cover Linux and macOS but
    // also wants the executable's path.
    vscode.window.showInformationMessage(
      vscode.l10n.t('Attaching the debugger is only available on Windows for now.'),
    );
    return false;
  }
  if (!vscode.extensions.getExtension(CPPTOOLS)) {
    vscode.window.showWarningMessage(
      vscode.l10n.t('Attaching needs the C/C++ extension (ms-vscode.cpptools), which provides the debugger.'),
    );
    return false;
  }
  return true;
}

/**
 * tasklist prints each process as a quoted CSV row and, when nothing matches, a
 * sentence in the system's language and code page instead. Only the quoted rows
 * are read, so that sentence is never interpreted. The memory column carries a
 * comma of its own ("167,564 K"), which is why fields are split on the
 * quote-comma-quote between them rather than on commas.
 * @param {string} filter e.g. "PID eq 1234" or "IMAGENAME eq app.exe"
 * @returns {Promise<{name: string, pid: string, memory: string}[]>}
 */
function tasklist(filter) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', filter, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith('"'))
          .map((line) => line.slice(1, -1).split('","'))
          .map(([name, pid, , , memory]) => ({ name, pid, memory: memory || '' })),
      );
    });
  });
}

/** @param {string} pid @param {string} name */
async function attach(pid, name) {
  const folders = vscode.workspace.workspaceFolders;
  const started = await vscode.debug.startDebugging(folders && folders[0], {
    type: 'cppvsdbg',
    request: 'attach',
    name: vscode.l10n.t('Attach: {0} (PID {1})', name, pid),
    processId: pid,
  });
  if (started) {
    lastName = name;
  } else {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not start the debugger for PID {0}.', pid));
  }
}

async function attachToProcess() {
  if (!supported()) return;

  let pid;
  try {
    pid = await vscode.commands.executeCommand('extension.pickNativeProcess');
  } catch {
    // Closing the picker rejects rather than resolving empty. Nothing to do.
    return;
  }
  if (!pid) return;

  const [found] = await tasklist(`PID eq ${pid}`);
  await attach(String(pid), found ? found.name : String(pid));
}

/**
 * Attach again to the process attached last, found by its executable name
 * rather than its id - a program that was stopped and started again has a new
 * id, and that is the usual reason for reaching for this key. Several processes
 * with the name are offered as a choice; before anything has been attached in
 * this window, it is the ordinary attach picker.
 */
async function reattachToProcess() {
  if (!supported()) return;
  if (!lastName) {
    await attachToProcess();
    return;
  }

  const running = await tasklist(`IMAGENAME eq ${lastName}`);
  if (running.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('No running process named {0}.', lastName));
    return;
  }

  let chosen = running[0];
  if (running.length > 1) {
    const picked = await vscode.window.showQuickPick(
      running.map((proc) => ({
        label: proc.name,
        description: vscode.l10n.t('PID {0} · {1}', proc.pid, proc.memory),
        proc,
      })),
      { placeHolder: vscode.l10n.t('Several processes are named {0}. Pick one to reattach to.', lastName) },
    );
    if (!picked) return;
    chosen = picked.proc;
  }
  await attach(chosen.pid, chosen.name);
}

module.exports = {
  commands: {
    'assist.attachToProcess': attachToProcess,
    'assist.reattachToProcess': reattachToProcess,
  },
};
