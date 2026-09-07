'use strict';

const vscode = require('vscode');

// Every one of these is served by whatever language server is already installed
// - clangd, cpptools, rust-analyzer, tsserver. This extension owns none of the
// analysis; it only decides which question to ask next.
const PROVIDERS = {
  definition: 'vscode.executeDefinitionProvider',
  declaration: 'vscode.executeDeclarationProvider',
  implementation: 'vscode.executeImplementationProvider',
  typeDefinition: 'vscode.executeTypeDefinitionProvider',
};

/**
 * Providers answer with either a Location or a LocationLink, and which one you
 * get depends on the server rather than on the request. Flatten both to
 * Location, preferring targetSelectionRange: that is the name of the symbol,
 * where targetRange is the whole body. The distinction matters below - a body
 * contains the cursor for every call made inside it, and the round trip would
 * read those as "already here".
 * @param {unknown} raw
 * @returns {vscode.Location[]}
 */
function toLocations(raw) {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item.targetUri) {
      out.push(new vscode.Location(item.targetUri, item.targetSelectionRange || item.targetRange));
    } else if (item.uri && item.range) {
      out.push(new vscode.Location(item.uri, item.range));
    }
  }
  return out;
}

/** @param {vscode.Location} loc @param {vscode.Uri} uri @param {vscode.Position} pos */
function isHere(loc, uri, pos) {
  return loc.uri.toString() === uri.toString() && loc.range.contains(pos);
}

/** @param {vscode.Location[]} locs */
function dedupe(locs) {
  const seen = new Set();
  return locs.filter((l) => {
    const key = `${l.uri.toString()}:${l.range.start.line}:${l.range.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {vscode.Location} loc */
async function reveal(loc) {
  const doc = await vscode.workspace.openTextDocument(loc.uri);
  const editor = await vscode.window.showTextDocument(doc);
  const start = loc.range.start;
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** @param {vscode.Location[]} locs @returns {Promise<vscode.Location | undefined>} */
async function pick(locs) {
  const items = locs.map((loc) => ({
    label: `$(symbol-method) ${loc.uri.path.split('/').pop()}:${loc.range.start.line + 1}`,
    description: vscode.workspace.asRelativePath(loc.uri),
    loc,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: 'Round Trip: several places answer to this name',
    matchOnDescription: true,
  });
  return chosen && chosen.loc;
}

async function go() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const uri = editor.document.uri;
  const pos = editor.selection.active;
  const config = vscode.workspace.getConfiguration('roundTrip');
  const chain = config.get('chain', ['definition', 'declaration', 'implementation']);
  const pickWhenAmbiguous = config.get('pickWhenAmbiguous', true);

  for (const step of chain) {
    const command = PROVIDERS[step];
    if (!command) continue;

    let raw;
    try {
      raw = await vscode.commands.executeCommand(command, uri, pos);
    } catch {
      // A server that does not implement this request rejects rather than
      // answering empty. That is not an error here, it is just a dead end.
      continue;
    }

    const targets = dedupe(toLocations(raw).filter((l) => !isHere(l, uri, pos)));
    if (targets.length === 0) continue;

    const target = targets.length > 1 && pickWhenAmbiguous ? await pick(targets) : targets[0];
    if (target) await reveal(target);
    return;
  }

  vscode.window.setStatusBarMessage('$(circle-slash) Round Trip: nowhere to go from here', 2000);
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('roundTrip.go', go));
}

function deactivate() {}

module.exports = { activate, deactivate };
