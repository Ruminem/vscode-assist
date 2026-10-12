#!/usr/bin/env node
'use strict';

// What narrowing a file search to a CMake project decides without an editor:
// which files a project's folder takes in, which projects a code model names,
// whether a remembered project is still there, and when CMake Tools is asked.
//
//   node tools/check-cmake-projects.js
//
// The code model here has the shape CMake Tools hands out (Project.codeModel,
// vscode-cmake-tools-api api.ts): sourceDirectory is the folder of the first
// directory the File API gives each project. The folders are the ones CMake
// 3.28 gave for a tree with a top project, one in src/core and one in libs/net.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const path = require('path');
const Module = require('module');

const vscode = {};
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? vscode : load(request, parent, isMain));

const ROOT = path.join(__dirname, '..');
const { cmakeProjects, within, projectsFrom, restore } = require(path.join(ROOT, 'features', 'cmake-projects.js'));
const { scoped } = require(path.join(ROOT, 'features', 'file-search.js'));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

// --- which files a folder takes in --------------------------------------------

check('a file under the folder is in it', within('/r/src/core/a.c', '/r/src/core', false), true);
check('the folder itself is in it', within('/r/src/core', '/r/src/core', false), true);
check('a deeper file is in it', within('/r/src/core/x/y.h', '/r/src/core', false), true);
check('a folder whose name only starts the same is not', within('/r/src/core2/a.c', '/r/src/core', false), false);
check('a folder written with a slash at the end still works', within('/r/src/core/a.c', '/r/src/core/', false), true);
check('the root takes in everything', within('/r/a.c', '/', false), true);
// CMake writes C:/src/core; a uri's fsPath is c:\src\core.
check('on Windows, the drive letter case and backslashes do not matter', within('c:\\Src\\core\\a.c', 'C:/src/core', true), true);
check('elsewhere, case does', within('/R/src/core/a.c', '/r/src/core', false), false);

// --- the projects a code model names ------------------------------------------

const tree = (configuration) => ({
  name: configuration,
  projects: [
    { name: 'Top', sourceDirectory: '/r', targets: [] },
    { name: 'Core', sourceDirectory: '/r/src/core', targets: [] },
    { name: 'Net', sourceDirectory: '/r/libs/net', targets: [] },
  ],
});
// A multi-config generator: one configuration per build type, the same projects in each.
const model = { configurations: [tree('Debug'), tree('Release')] };
const projects = projectsFrom(model, false);
check('each project once, however many configurations name it', projects.map((p) => p.name), ['Top', 'Core', 'Net']);
check('no model, no projects', projectsFrom(undefined, false), []);
check(
  'a project without a folder is left out',
  projectsFrom({ configurations: [{ projects: [{ name: 'X' }] }] }, false),
  [],
);

// The top project is the whole tree - the folders of the projects it adds included.
const listed = ['/r/main.c', '/r/src/app/app.c', '/r/src/core/core.c', '/r/src/core/core.h', '/r/libs/net/net.c', '/elsewhere/z.c'];
const files = listed.map((fsPath) => ({ uri: { fsPath } }));
const names = (list) => list.map((file) => file.uri.fsPath);
const [top, core, net] = projects;
check('the top project takes in the whole tree', names(scoped(files, top)), listed.slice(0, 5));
check('a project below takes in its own folder', names(scoped(files, core)), ['/r/src/core/core.c', '/r/src/core/core.h']);
check('and only that', names(scoped(files, net)), ['/r/libs/net/net.c']);
check('no scope keeps the very same list', scoped(files, undefined) === files, true);

// --- whether a remembered project is still there ------------------------------

check('a project still configured comes back', restore({ name: 'Core', dir: '/r/src/core' }, projects, false), core);
check('a project the last configure left out is forgotten', restore({ name: 'Gone', dir: '/r/gone' }, projects, false), undefined);
check('a project moved to another folder is forgotten', restore({ name: 'Core', dir: '/r/core' }, projects, false), undefined);
check(
  'on Windows, the same folder in another case is the same project',
  restore({ name: 'Core', dir: 'c:\\r\\src\\core' }, projectsFrom({ configurations: [{ projects: [{ name: 'Core', sourceDirectory: 'C:/r/src/core' }] }] }, true), true) !== undefined,
  true,
);
check('nothing remembered, nothing restored', restore(undefined, projects, false), undefined);

// --- when CMake Tools is asked ------------------------------------------------

let activated = 0;
const extension = (isActive, getProject) => ({
  isActive,
  activate: () => {
    activated++;
    return Promise.resolve();
  },
  exports: { getApi: () => ({ getProject }) },
});
const folders = [
  { name: 'r', uri: { fsPath: '/r' } },
  { name: 'core', uri: { fsPath: '/r/src/core' } },
];
vscode.workspace = { workspaceFolders: folders };

async function asking() {
  vscode.extensions = { getExtension: () => undefined };
  check('no CMake Tools, no projects', await cmakeProjects(), []);

  vscode.extensions = { getExtension: () => extension(false, async () => ({ codeModel: model })) };
  check('CMake Tools not running gives none', await cmakeProjects(), []);
  check('and is not started from here', activated, 0);

  vscode.extensions = { getExtension: () => extension(true, async () => ({ codeModel: undefined })) };
  check('not configured yet gives none', await cmakeProjects(), []);

  // Both folders sit in one CMake tree, so both answer with it.
  vscode.extensions = { getExtension: () => extension(true, async () => ({ codeModel: model })) };
  check('two folders in one tree list it once', (await cmakeProjects()).map((p) => p.name), ['Top', 'Core', 'Net']);

  vscode.extensions = {
    getExtension: () =>
      extension(true, async (uri) => {
        if (uri.fsPath === '/r') throw new Error('busy');
        return { codeModel: { configurations: [{ projects: [{ name: 'Core', sourceDirectory: '/r/src/core' }] }] } };
      }),
  };
  check('a folder that fails does not lose the others', (await cmakeProjects()).map((p) => p.name), ['Core']);
}

// --- the picker, on a stand-in ------------------------------------------------
//
// Opened with the list already made (the way it comes back from the project
// list), so no ripgrep runs. What is checked is the wiring: the remembered
// project narrows both sections, the button is there, and choosing another
// project from it brings the picker back with the query it had.

const pickers = [];
function createQuickPick() {
  const on = {};
  const picker = {
    items: [],
    value: '',
    buttons: [],
    selectedItems: [],
    show() {},
    hide() {
      on.hide && on.hide();
    },
    dispose() {},
  };
  for (const event of ['ChangeValue', 'Accept', 'Hide', 'TriggerButton']) picker[`onDid${event}`] = (fn) => (on[event.toLowerCase().replace('changevalue', 'value').replace('triggerbutton', 'button')] = fn);
  picker.fire = on;
  pickers.push(picker);
  return picker;
}

async function picking() {
  const { open, activate, prepare } = require(path.join(ROOT, 'features', 'file-search.js'));
  const uri = (fsPath) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` });
  let store = { 'assist.fileSearch.recent': ['file:///r/src/core/core.h', 'file:///r/libs/net/net.c'], 'assist.fileSearch.project': { name: 'Core', dir: '/r/src/core' } };
  let chosen = net;
  Object.assign(vscode, {
    Uri: { parse: (key) => uri(key.slice('file://'.length)) },
    ThemeIcon: function ThemeIcon(id) {
      this.id = id;
    },
    QuickPickItemKind: { Separator: -1 },
    l10n: { t: (text, ...args) => text.replace(/\{(\d)\}/g, (_, i) => args[i]) },
    extensions: { getExtension: () => extension(true, async () => ({ codeModel: model })) },
    window: {
      activeTextEditor: undefined,
      tabGroups: { all: [] },
      onDidChangeActiveTextEditor: () => ({}),
      createQuickPick,
      showQuickPick: async (items) => items.find((item) => item.project === chosen || (item.project && chosen && item.project.name === chosen.name)),
    },
  });
  vscode.workspace = {
    workspaceFolders: folders.slice(0, 1),
    fs: { stat: () => Promise.resolve({}) },
    asRelativePath: (at) => (typeof at === 'string' ? at : at.fsPath).replace(/^\/r\//, ''),
  };
  activate({ workspaceState: { get: (key, fallback) => (key in store ? store[key] : fallback), update: async (key, value) => (store[key] = value) }, subscriptions: [] });

  const listedFiles = listed.map((fsPath) => prepare(fsPath.replace(/^\/r\//, ''), uri(fsPath)));
  await open({ value: '', found: { files: listedFiles, cut: false } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const first = pickers[0];
  const rows = (picker) => picker.items.filter((item) => item.uri).map((item) => item.uri.fsPath);
  check('the remembered project names the picker', first.placeholder, 'Search files in CMake project Core');
  check('the button says which', first.buttons.map((b) => [b.iconPath.id, b.tooltip]), [['filter-filled', 'CMake project: Core']]);
  check('with no query, only its recent files', rows(first), ['/r/src/core/core.h']);
  first.value = 'c';
  first.fire.value();
  check('a query finds only its files', rows(first).sort(), ['/r/src/core/core.c', '/r/src/core/core.h']);

  // Another project from the button; the picker comes back with `c` still typed.
  first.fire.button();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = pickers[1];
  check('the choice is remembered', store['assist.fileSearch.project'], { name: 'Net', dir: '/r/libs/net' });
  check('the picker comes back with the query', second && second.value, 'c');
  check('and the new scope', second && rows(second), ['/r/libs/net/net.c']);

  // The whole workspace again.
  chosen = null;
  second.fire.button();
  await new Promise((resolve) => setTimeout(resolve, 10));
  check('choosing all files forgets the project', store['assist.fileSearch.project'], undefined);
  check('and searches everything', pickers[2] && pickers[2].placeholder, 'Search files in the workspace');

  // A project the last configure no longer has.
  store['assist.fileSearch.project'] = { name: 'Gone', dir: '/r/gone' };
  await open({ value: '', found: { files: listedFiles, cut: false } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  check('a project gone from the configure is forgotten', store['assist.fileSearch.project'], undefined);
  check('and the search covers everything', pickers[3].placeholder, 'Search files in the workspace');

  // No CMake Tools: no button at all.
  vscode.extensions = { getExtension: () => undefined };
  await open({ value: '', found: { files: listedFiles, cut: false } });
  check('without projects there is no button', pickers[4].buttons, []);
}

asking()
  .then(picking)
  .then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
  });
