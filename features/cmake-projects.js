'use strict';

// The CMake projects a file search can be narrowed to - each project() the last
// configure went through, and the folder it was declared in.
//
// They come from CMake Tools (ms-vscode.cmake-tools, MIT) through the API it
// exports, not from reading CMakeLists.txt: the code model it holds is the one
// its active preset or kit last configured, so a subdirectory an option left
// out is not there, and neither is a project in it. The API is the
// vscode-cmake-tools-api package's (api.ts, checked on main 2026-10-12); this
// file uses getApi, getProject and Project.codeModel, all of them in version 1.
//
// The scope chosen is one for both searches, Alt+E and Shift+Alt+S: kept in
// workspaceState under the key the file search first stored it with.
//
// A project is its folder and everything under it, the folders of the projects
// it adds included - so the top one, at the root CMakeLists.txt, is the whole
// tree, and a project below it is a part of that. Target source lists were the
// other way to draw the line and were left: a target lists sources from other
// folders and leaves out most headers.

const vscode = require('vscode');
const { trace } = require('./trace');

const CMAKE_TOOLS = 'ms-vscode.cmake-tools';
const SCOPE_KEY = 'assist.fileSearch.project';

/** @type {vscode.Memento | undefined} */
let store;

/**
 * A path in one spelling: forward slashes, no slash at the end, and on Windows
 * lowered - CMake writes `C:/src`, a VS Code uri's fsPath `c:\src`.
 * @param {string} path @param {boolean} windows
 */
function normal(path, windows) {
  const slashed = path.replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  return windows ? slashed.toLowerCase() : slashed;
}

/**
 * Whether `path` is `dir` or under it. `src/core2` is not under `src/core`.
 * @param {string} path @param {string} dir @param {boolean} windows
 */
function within(path, dir, windows) {
  const p = normal(path, windows);
  const d = normal(dir, windows);
  return p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`);
}

/**
 * The projects in a code model, once each. A multi-config generator gives one
 * configuration per build type, each naming the same projects.
 * @param {{configurations?: {projects?: {name: string, sourceDirectory: string}[]}[]} | undefined} model
 * @param {boolean} windows
 * @returns {{name: string, dir: string}[]}
 */
function projectsFrom(model, windows) {
  const seen = new Set();
  const projects = [];
  for (const configuration of (model && model.configurations) || []) {
    for (const project of configuration.projects || []) {
      if (!project.name || !project.sourceDirectory) continue;
      const key = `${project.name}\n${normal(project.sourceDirectory, windows)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      projects.push({ name: project.name, dir: project.sourceDirectory });
    }
  }
  return projects;
}

/**
 * The remembered scope, if the last configure still has it. A project that a
 * reconfigure dropped or moved is forgotten rather than searched as an empty
 * folder.
 * @param {{name: string, dir: string} | undefined} stored
 * @param {{name: string, dir: string}[]} projects @param {boolean} windows
 */
function restore(stored, projects, windows) {
  if (!stored) return undefined;
  return projects.find((p) => p.name === stored.name && normal(p.dir, windows) === normal(stored.dir, windows));
}

/**
 * Every workspace folder's projects. Empty when CMake Tools is missing, not
 * running, or has not configured yet - CMake Tools is never started from here,
 * since it starts itself in a folder with a CMakeLists.txt.
 * @returns {Promise<{name: string, dir: string}[]>}
 */
async function cmakeProjects() {
  const windows = process.platform === 'win32';
  const extension = vscode.extensions.getExtension(CMAKE_TOOLS);
  if (!extension || !extension.isActive) {
    trace(`cmake projects: CMake Tools ${extension ? 'not running' : 'not installed'}`);
    return [];
  }
  const api = extension.exports && extension.exports.getApi ? extension.exports.getApi(1) : undefined;
  if (!api || !api.getProject) {
    trace('cmake projects: CMake Tools gave no API');
    return [];
  }
  const seen = new Set();
  const projects = [];
  for (const folder of vscode.workspace.workspaceFolders || []) {
    let project;
    try {
      project = await api.getProject(folder.uri);
    } catch (error) {
      trace(`cmake projects: ${folder.name}: ${error && error.message}`);
      continue;
    }
    if (!project) continue;
    if (!project.codeModel) {
      trace(`cmake projects: ${folder.name}: not configured yet`);
      continue;
    }
    // Two workspace folders inside one CMake tree answer with the same tree.
    for (const found of projectsFrom(project.codeModel, windows)) {
      const key = `${found.name}\n${normal(found.dir, windows)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      projects.push(found);
    }
  }
  trace(`cmake projects: ${projects.length} from the last configure`);
  return projects;
}

/**
 * The projects of the last configure and the one the searches are narrowed to,
 * if any. A remembered project the configure no longer has is forgotten here.
 * @param {string} who what to call the search in the trace
 */
async function currentScope(who) {
  const projects = await cmakeProjects();
  const stored = store ? store.get(SCOPE_KEY) : undefined;
  const scope = restore(stored, projects, process.platform === 'win32');
  if (stored && !scope) {
    trace(`${who}: CMake project ${stored.name} is gone from the last configure; searching everything`);
    if (store) store.update(SCOPE_KEY, undefined);
  }
  return { projects, scope };
}

/**
 * The project list behind a search's button: the whole workspace first, then
 * each project with the CMakeLists.txt that declared it. What is chosen is
 * remembered. Resolves to false when it was closed without a choice.
 * @param {{name: string, dir: string}[]} projects
 * @param {{name: string, dir: string} | undefined} scope
 * @param {string} who
 */
async function chooseScope(projects, scope, who) {
  const items = [
    { label: `$(${scope ? 'files' : 'check'}) ${vscode.l10n.t('Whole workspace')}`, project: null },
    ...projects.map((project) => ({
      label: `$(${project === scope ? 'check' : 'project'}) ${project.name}`,
      description: vscode.workspace.asRelativePath(`${project.dir.replace(/[\\/]+$/, '')}/CMakeLists.txt`, true),
      project,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Choose the CMake project to search in'),
    matchOnDescription: true,
  });
  if (!picked) return false;
  const chosen = picked.project;
  if (store) await store.update(SCOPE_KEY, chosen ? { name: chosen.name, dir: chosen.dir } : undefined);
  trace(`${who}: scope set to ${chosen ? `CMake project ${chosen.name}` : 'the workspace'}`);
  return true;
}

/** The button a search shows when there are projects to choose from. */
function scopeButton(scope) {
  return {
    iconPath: new vscode.ThemeIcon(scope ? 'filter-filled' : 'filter'),
    tooltip: scope ? vscode.l10n.t('CMake project: {0}', scope.name) : vscode.l10n.t('Search one CMake project'),
  };
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  store = context.workspaceState;
}

module.exports = { activate, cmakeProjects, currentScope, chooseScope, scopeButton, within, projectsFrom, restore, normal };
