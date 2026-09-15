'use strict';

const vscode = require('vscode');

// Most of what this extension contributes is keybindings onto commands VS Code
// already has, and those need no code at all - they live in package.json under
// contributes.keybindings. Only the handful of moves VS Code has no command for
// end up here, one module each, exporting { commands: { id: handler } }.
//
// Adding one of those is: a file in features/, a line in this list, and a
// contributes entry. Nothing else in this file changes.
const FEATURES = [
  require('./features/round-trip'),
  require('./features/function-step'),
  require('./features/symbol-search'),
];

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  for (const feature of FEATURES) {
    for (const [id, handler] of Object.entries(feature.commands)) {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
