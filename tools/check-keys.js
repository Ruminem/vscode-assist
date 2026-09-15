#!/usr/bin/env node
'use strict';

// Before adding a keybinding, ask whether the key is already spoken for.
//
// An extension cannot release a key it has taken - keybindings.json has the
// leading-minus removal rule and extensions have no equivalent, and the request
// for low-priority extension bindings (microsoft/vscode#10004) is still open.
// So the cheapest moment to avoid a conflict is before the binding is written,
// and the only way to know is to look at the default keymap.
//
//   node tools/check-keys.js            check every contributed binding
//   node tools/check-keys.js alt+o      check a key we have not bound yet
//   node tools/check-keys.js --refresh  re-download the default keymaps
//
// Exits non-zero when any checked key already has a default rule, so it can sit
// in front of a release.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const BASE = 'https://raw.githubusercontent.com/codebling/vs-code-default-keybindings/master';
const PLATFORMS = ['windows', 'macos', 'linux'];

/**
 * VS Code writes modifiers in a fixed order, but there is no rule saying a
 * hand-written binding has to. Sort the modifiers so "shift+alt+s" and
 * "alt+shift+s" compare equal, and keep the last segment as the key itself.
 * Chords are space-separated and each half normalises on its own.
 * @param {string} key
 */
function normalize(key) {
  return key
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      const parts = stroke.split('+');
      const base = parts.pop();
      return [...parts.sort(), base].join('+');
    })
    .join(' ');
}

/** @param {string} platform @returns {Promise<string>} */
async function localCopy(platform, refresh) {
  const file = path.join(CACHE, `${platform}.keybindings.json`);
  if (refresh || !fs.existsSync(file)) {
    const res = await fetch(`${BASE}/${platform}.keybindings.json`);
    if (!res.ok) throw new Error(`${platform}: ${res.status} ${res.statusText}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * The published defaults are JSONC - a version banner on the first line and
 * comments between sections. Strip whole-line comments only; nothing in the
 * file puts one after a value, and a blunter regex would eat the "//" inside a
 * regex-valued when clause.
 * @param {string} text
 */
function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

/** Every key one contributed binding can occupy, across platforms. */
function keysOf(binding) {
  const keys = new Set();
  for (const field of ['key', 'win', 'linux', 'mac']) {
    if (binding[field]) keys.add(normalize(binding[field]));
  }
  return [...keys];
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const asked = args.filter((a) => !a.startsWith('--'));

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const contributed = (pkg.contributes && pkg.contributes.keybindings) || [];

  /** @type {{key: string, label: string}[]} */
  const targets = asked.length
    ? asked.map((k) => ({ key: normalize(k), label: '(not bound yet)' }))
    : contributed.flatMap((b) => keysOf(b).map((key) => ({ key, label: b.command })));

  if (targets.length === 0) {
    console.log('No keybindings contributed and no key given. Nothing to check.');
    return 0;
  }

  const defaults = {};
  for (const platform of PLATFORMS) {
    defaults[platform] = parseJsonc(await localCopy(platform, refresh));
  }

  // A default rule this extension binds again - same key, same command, with the
  // default's own when clause at the end of ours - is being handed back rather
  // than taken: later rules win, so wherever the default fired it still does.
  const handedBack = (key, rule) =>
    contributed.some(
      (b) =>
        keysOf(b).includes(key) &&
        b.command === rule.command &&
        (b.when || '').endsWith(rule.when || '')
    );

  // A default rule is only an alias when the same platform binds its command,
  // under the same when clause, to another key as well. Taking this key then
  // costs nothing: the command is still one keystroke away on the other.
  // Platforms are judged apart - Ctrl+Shift+Up is an alias of Shift+Up on
  // Windows and a multi-cursor command of its own on Linux.
  const isAlias = (platform, key, rule) =>
    defaults[platform].some(
      (other) =>
        other.command === rule.command &&
        (other.when || '') === (rule.when || '') &&
        other.key &&
        normalize(other.key) !== key
    );

  let collisions = 0;
  for (const { key, label } of targets) {
    const hits = [];
    const aliases = [];
    let yields = false;
    for (const platform of PLATFORMS) {
      for (const rule of defaults[platform]) {
        if (!rule.key || normalize(rule.key) !== key) continue;
        if (handedBack(key, rule)) yields = true;
        else if (isAlias(platform, key, rule)) aliases.push(`${platform.padEnd(8)} ${rule.command}`);
        else hits.push({ platform, rule });
      }
    }

    if (hits.length === 0) {
      const status = yields ? 'yields' : aliases.length ? 'alias ' : 'free  ';
      console.log(`  ${status} ${key.padEnd(16)} ${label}`);
      for (const a of aliases) console.log(`         ${a}  (alias: also bound to another key)`);
      continue;
    }

    collisions += 1;
    console.log(`  TAKEN  ${key.padEnd(16)} ${label}`);
    for (const a of aliases) console.log(`         ${a}  (alias: also bound to another key)`);
    for (const { platform, rule } of hits) {
      const when = rule.when ? `  when: ${rule.when}` : '  (no when clause - always active)';
      console.log(`         ${platform.padEnd(8)} ${rule.command}${when}`);
    }
    console.log(
      '         -> a default rule already answers here. Either pick another key, or\n' +
        '            narrow the when clause so the two cannot both be true at once.'
    );
  }

  console.log('');
  console.log(
    collisions === 0
      ? `All ${targets.length} key(s) are free in the default keymap.`
      : `${collisions} of ${targets.length} key(s) collide with a default rule.`
  );
  return collisions === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(2);
  }
);
