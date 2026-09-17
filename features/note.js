// SPDX-License-Identifier: MIT
'use strict';

const vscode = require('vscode');
const os = require('os');
const { measure } = require('./round-trip');
const { recent, tracing } = require('./trace');
const { indexProgress, describeProgress } = require('./text-guess');
const { version } = require('../package.json');

// Settings that decide which language server answers and how, read at the
// cursor's file so a workspace override shows rather than the user value.
const SETTINGS = [
  'clangd.enable',
  'clangd.arguments',
  'C_Cpp.intelliSenseEngine',
  'C_Cpp.default.compileCommands',
  'C_Cpp.workspaceParsingPriority',
  'assist.roundTrip',
  'assist.symbolSearch',
];
const SERVERS = ['llvm-vs-code-extensions.vscode-clangd', 'ms-vscode.cpptools'];
const TRACE_LINES = 50;

/** @template T @param {Thenable<T>} thenable */
async function timed(thenable) {
  const start = Date.now();
  const value = await Promise.resolve(thenable).catch(() => undefined);
  return { value, ms: Date.now() - start };
}

/**
 * A note to take to where the code gets changed: what felt wrong, in the user's
 * own words, next to what is needed to look into it away from the machine it
 * happened on - the language servers and their settings, fresh timings of every
 * stage at the cursor, and the recent trace. It opens as an unsaved Markdown
 * document, so nothing is written anywhere until it is saved, and it can be read
 * first: it holds file paths, symbol names and the cursor's line of code.
 * The body stays in English, like the trace it quotes.
 */
async function saveNote() {
  const memo = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('What felt wrong? Timings at the cursor and the recent trace are added below it.'),
    placeHolder: vscode.l10n.t('e.g. Alt+G took about three seconds here'),
  });
  if (memo === undefined) return;

  const editor = vscode.window.activeTextEditor;
  const document = editor && editor.document;
  const out = [`# Assist note - ${new Date().toLocaleString()}`, '', memo || '(no memo)', ''];

  out.push('## Environment', '');
  out.push(`- VS Code ${vscode.version}, ${os.platform()} ${os.release()}, Assist ${version}`);
  for (const id of SERVERS) {
    const found = vscode.extensions.getExtension(id);
    out.push(`- ${id}: ${found ? `${found.packageJSON.version}${found.isActive ? '' : ' (not active)'}` : 'not installed'}`);
  }
  const config = vscode.workspace.getConfiguration(undefined, document && document.uri);
  for (const key of SETTINGS) out.push(`- \`${key}\`: \`${JSON.stringify(config.get(key))}\``);
  out.push('');

  if (document) {
    const pos = editor.selection.active;
    const range = document.getWordRangeAtPosition(pos);
    out.push('## Cursor', '');
    out.push(`- ${vscode.workspace.asRelativePath(document.uri)}:${pos.line + 1}:${pos.character + 1} (${document.languageId})`);
    out.push(`- word: \`${range ? document.getText(range) : ''}\``);
    const progress = describeProgress(indexProgress(document));
    if (progress) out.push(`- ${progress}`);
    out.push('', '```', document.lineAt(pos.line).text, '```', '');

    const rows = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Assist: measuring at the cursor') },
      async () => {
        const measured = await measure(document, pos);
        const full = await timed(vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', ''));
        measured.push(['symbol search full list (empty query)', full.ms, (full.value || []).length]);
        return measured;
      },
    );
    out.push('## Timings at the cursor', '', 'Asked one at a time, so each row is that stage alone.', '');
    out.push('| stage | ms | count |', '|---|---:|---:|');
    for (const [what, ms, count] of rows) out.push(`| ${what} | ${ms} | ${count} |`);
    out.push('');
  }

  const traced = recent().slice(-TRACE_LINES);
  if (traced.length) out.push('## Recent trace', '', '```', ...traced, '```', '');
  else if (!tracing()) out.push('## Recent trace', '', 'Tracing was off. Start it with Assist: Start or stop tracing, press the slow key again, then write the note.', '');

  const note = await vscode.workspace.openTextDocument({ language: 'markdown', content: out.join('\n') });
  await vscode.window.showTextDocument(note, { preview: false });
}

module.exports = {
  commands: {
    'assist.saveNote': saveNote,
  },
};
