'use strict';

const vscode = require('vscode');

// Most of what this extension contributes is keybindings onto commands VS Code
// already has, and those need no code at all - they live in package.json under
// contributes.keybindings. Only the handful of moves VS Code has no command for
// end up here, one module each, exporting { commands: { id: handler } }.
//
// Adding one of those is: a file in features/, a line in this list, and a
// contributes entry. Nothing else in this file changes.
//
// A feature that answers something other than a key press - dot-arrow watches
// what is typed - exports activate(context) as well and puts its listener
// there, so that nothing registers a listener merely by being required.
const FEATURES = [
  require('./features/round-trip'),
  require('./features/function-step'),
  require('./features/symbol-search'),
  require('./features/file-search'),
  require('./features/process-attach'),
  require('./features/dot-arrow'),
  require('./features/enum-values'),
  require('./features/note'),
  require('./features/trace'),
];

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  for (const feature of FEATURES) {
    if (feature.activate) feature.activate(context);
    for (const [id, handler] of Object.entries(feature.commands || {})) {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }
    // Disposed when the window closes, which is a feature's last chance to clean up.
    if (feature.deactivate) context.subscriptions.push({ dispose: feature.deactivate });
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
