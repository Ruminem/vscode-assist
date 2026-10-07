#!/usr/bin/env node
'use strict';

// What the file search decides before VS Code is involved: the Hangul reading
// of a query, and how a path scores against it.
//
//   node tools/check-fuzzy.js
//
// Both are pure string work, so neither needs an editor. The Hangul table is
// the part worth pinning: every jamo maps to exactly one key, the mapping is
// a keyboard layout rather than a judgement, and a single wrong entry silently
// turns one query into a different one. The scoring is pinned by its ordering
// rather than by its numbers - what the score is does not matter, what is
// ranked above what does.
//
// Exits non-zero on any failure, so it can sit in front of a release.

const path = require('path');
const Module = require('module');

// file-search.js imports vscode; only the recent section's check at the end
// calls into it, and fills in what it needs.
const vscode = {};
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? vscode : load(request, parent, isMain));

const ROOT = path.join(__dirname, '..');
const { toKeys, hasHangul, readings } = require(path.join(ROOT, 'features', 'hangul.js'));
const { fuzzyMatch, startsWord, mentionsTest } = require(path.join(ROOT, 'features', 'fuzzy.js'));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

// --- the keys a Hangul query came from ----------------------------------------

// The case this exists for: `abcd` typed with the input method on.
check('abcd', toKeys('뮻ㅇ'), 'abcd');
check('hello', toKeys('ㅎ디ㅣㅐ'), 'gello');
check('a lone lead jamo', toKeys('ㅇ'), 'd');
check('a syllable with no final', toKeys('가'), 'rk');
check('a syllable with a final', toKeys('강'), 'rkd');
// Two keys, because that is how many were pressed.
check('a compound vowel', toKeys('과'), 'rhk');
check('a compound final', toKeys('닭'), 'ekfr');
// A shifted key comes back lower case: the match ignores case anyway, and an
// upper-case letter here would have to survive every caller's toLowerCase.
check('a doubled consonant', toKeys('까'), 'rk');
check('letters and digits pass through', toKeys('main2'), 'main2');
check('punctuation passes through', toKeys('src/뮻ㅇ.js'), 'src/abcd.js');
check('an empty query', toKeys(''), '');

check('hangul is seen in a syllable', hasHangul('뮻'), true);
check('hangul is seen in a lone jamo', hasHangul('ㅇ'), true);
check('plain English is not hangul', hasHangul('abcd'), false);

// An English query costs nothing: one reading, no second pass over the list.
check('an English query has one reading', readings('abcd'), ['abcd']);
check('a Hangul query has two', readings('뮻ㅇ'), ['뮻ㅇ', 'abcd']);
// The query itself stays first, because a file really can be named in Korean.
check('the query stays first', readings('한글')[0], '한글');

// --- how a path scores --------------------------------------------------------

const score = (query, target) => {
  const match = fuzzyMatch(query, target);
  return match ? match.score : null;
};
const ranks = (query, first, second) => score(query, first) > score(query, second);

check('a path is matched at all', score('fda', 'features/dot-arrow.js') !== null, true);
check('letters out of order do not match', score('adf', 'features/dot-arrow.js'), null);
check('a query longer than the path does not match', score('featuresfeatures', 'features'), null);

// The folder, the file and the extension are what a person remembers, so the
// letters that begin them have to outrank the same letters buried mid-word.
check('beginnings beat middles', ranks('fda', 'features/dot-arrow.js', 'xfxxxdxxxaxx'), true);
check('the extension is a beginning', ranks('fj', 'features/a.js', 'ffffffffj'), true);
check('a shorter path wins a tie', ranks('ext', 'extension.js', 'extension.js.map'), true);

// Anchored: only the fits the quick pick highlights. The symbol search stays
// loose - `ce` on Circle is what it exists for.
check('loose, ce finds Circle', score('ce', 'Circle') !== null, true);
check('anchored, ce does not', fuzzyMatch('ce', 'Circle', true), null);
check('anchored, the first letter has to start a word', fuzzyMatch('ej', 'check-keys.json', true), null);
check('anchored, a later letter starts a word or follows the last', fuzzyMatch('ckjs', 'check-keys.js', true) !== null, true);
check('anchored, a run may start mid-word', fuzzyMatch('sets', 'CMakePresets.json', true) !== null, true);
check('anchored, a mid-word run ranks below one at a word start', fuzzyMatch('sets', 'x-sets', true).score > fuzzyMatch('sets', 'xxsets', true).score, true);

check('a slash starts a word', startsWord('a/b', 2), true);
check('a dash starts a word', startsWord('a-b', 2), true);
check('a dot starts a word', startsWord('a.b', 2), true);
check('a backslash starts a word', startsWord('a\\b', 2), true);
check('an underscore still does', startsWord('a_b', 2), true);
check('a capital still does', startsWord('aB', 1), true);
check('an ordinary letter does not', startsWord('ab', 1), false);

// --- the two together ---------------------------------------------------------

// The point of the whole feature, end to end: the Hangul that the keys `fda`
// produce still reaches the file those keys spell.
//
// `ㄹㅇㅁ` rather than a syllable, because `fda` is three consonants and the
// input method has no vowel to compose them with - it leaves the jamo standing
// apart. A query that never finishes a syllable is the common shape here, since
// the letters of an English name rarely spell Korean.
const query = 'ㄹㅇㅁ';
check('the keys behind ㄹㅇㅁ', toKeys(query), 'fda');
check('a Hangul query reaches an English path', readings(query).some((r) => fuzzyMatch(r, 'features/dot-arrow.js')), true);

// --- how the file search orders a whole path ----------------------------------

const { matchPath, sortResults, rgArgs } = require(path.join(ROOT, 'features', 'file-search.js'));
const rank = (query, target, nameOnly = false) => {
  const match = matchPath(query, target, nameOnly);
  return match ? match.score : null;
};
const above = (query, first, second) => rank(query, first) > rank(query, second);

// The Quick Open ordering, in its three tiers. Each pair is chosen so that the
// old whole-path scoring ranks it the other way - a pair both orderings agree
// on pins nothing.
check('a name that starts with the query beats a name that holds it', above('arrow', 'z/arrow-key.js', 'dot-arrow.js'), true);
// Scored as one string, `fda-folder/x.js` wins this: a word start and a run
// against three word starts.
check('a name that holds the letters beats folders that hold them', above('fda', 'zzz/f-d-a.js', 'fda-folder/x.js'), true);
check('the folders are still searched when the name misses', rank('fda', 'features/dot-arrow.js') !== null, true);
check('a slash sends the piece to the path', rank('features/dot', 'features/dot-arrow.js') !== null, true);
check('a piece with a slash is matched loosely, its slash landing anywhere', rank('feat/dot', 'features/dot-arrow.js') !== null, true);

// The rows the screenshots showed unhighlighted, each a fit the picker cannot
// draw: letters in order but not at word starts nor in a run.
check('sd does not reach std.h', rank('sd', 'x/std.h'), null);
check('ckjs does not reach package.json', rank('ckjs', 'x/package.json'), null);
check('ckjs does not reach a name through Che[c][k]…[j][s]on', rank('ckjs', 'x/target-NightlyMemCheck-Debug-86d3614bfbe55db1eb46.json'), null);
check('ckjs still reaches check-keys.js', rank('ckjs', 'tools/check-keys.js') !== null, true);
check('the consonant skeleton is what this gives up', rank('fzy', 'features/fuzzy.js'), null);

// Word starts as the picker counts them, which is more than startsWord does.
check('a letter after a space starts a word', rank('ckc', 'tools/check-keys copy.js') !== null, true);
check('a digit starts a word', rank('f2', 'x/file2.txt') !== null, true);
check('a capital after a capital starts a word in a camel-looking name', rank('rd', 'x/README.md') !== null, true);
check('but not in a name of capitals alone, which the picker lowers', rank('rd', 'x/README'), null);
// And less: a name the picker does not read as words at all gets runs only.
check('a name of mostly capitals is matched by runs only', rank('coc', 'x/CODE_OF_CONDUCT.md'), null);
check('past the picker\'s 60 characters only a run reaches', rank('ab', `x/a${'x'.repeat(60)}-b.js`), null);

// Pieces split on spaces, all required, in any order.
check('pieces match in any order', rank('js dot', 'features/dot-arrow.js') !== null, true);
check('every piece has to match', rank('dot zzz', 'features/dot-arrow.js'), null);
check('a Hangul piece is read through its keys', rank('애 ㅓㄴ', 'features/dot-arrow.js') !== null, true);

// Test files go below the rest unless the query asks for them. The pair is one
// the scores alone rank the other way, so the check pins the lowering and not
// the scoring.
const testPair = () => [
  { file: { path: 'tests/widget.cpp' }, match: { score: rank('widget', 'tests/widget.cpp') } },
  { file: { path: 'src/ui/widget_impl.cpp' }, match: { score: rank('widget', 'src/ui/widget_impl.cpp') } },
];
const order = (query) => sortResults(query, testPair()).map((hit) => hit.file.path);
check('the pair scores the test file higher on its own', above('widget', 'tests/widget.cpp', 'src/ui/widget_impl.cpp'), true);
check('a test file goes below the rest', order('widget'), ['src/ui/widget_impl.cpp', 'tests/widget.cpp']);
check('a query on its way to "test" still lowers it', order('tes'), ['src/ui/widget_impl.cpp', 'tests/widget.cpp']);
check('"test" in the query keeps the scores\' order', order('widget test'), ['tests/widget.cpp', 'src/ui/widget_impl.cpp']);
check('"test" typed with the input method on counts', order('ㅅㄷㄴㅅ'), ['tests/widget.cpp', 'src/ui/widget_impl.cpp']);

// What counts as a test file: a word that starts with "test", nothing fused.
for (const name of ['test_foo.py', 'foo.test.js', 'tests/x.cpp', 'src/FooTest.cpp', 'TestFoo', 'testing/x.h', 'testdata/a', 'my test.cpp']) {
  check(`${name} is a test file`, mentionsTest(name), true);
}
for (const name of ['latest.js', 'contest/x.cpp', 'Attestation.h', 'googletest/gtest.h', 'unittest.py', 'widget.cpp']) {
  check(`${name} is not`, mentionsTest(name), false);
}

// The recent section: matched like the rest, but the name alone - unless the
// piece is a path.
check('a recent file matches an abbreviation of its name', rank('dar', 'features/dot-arrow.js', true) !== null, true);
check('a recent file does not match through its folder', rank('feat', 'features/dot-arrow.js', true), null);
check('a recent file matches a piece with a slash by its path', rank('feat/dot', 'features/dot-arrow.js', true) !== null, true);

// --- what the file list leaves out --------------------------------------------

const quickOpen = { useIgnoreFiles: true, useParentIgnoreFiles: false, useGlobalIgnoreFiles: false, followSymlinks: true };
const args = rgArgs(
  {
    '**/node_modules': true,
    '**/gone': false,
    '**/*.js': { when: '$(basename).ts' },
    'build/': true,
    '/abs': true,
  },
  quickOpen,
);
const globs = args.filter((_, i) => args[i - 1] === '-g');
check('exclude entries are passed on', globs.includes('!**/node_modules'), true);
check('an entry turned off is not', globs.includes('!**/gone'), false);
check('a sibling rule is left out', globs.some((g) => g.includes('*.js')), false);
// To ripgrep a bare `build` means "anywhere"; VS Code means "at the root".
check('a plain key is anchored to the root, its slash trimmed', globs.includes('!/build'), true);
check('an anchored key stays as it is', globs.includes('!/abs'), true);
check(
  "with Quick Open's settings, the folder's ignore files are read and parents' and the global one are not",
  !args.includes('--no-ignore') && args.includes('--no-ignore-parent') && args.includes('--no-ignore-global'),
  true,
);
check('search.useIgnoreFiles off turns them all off', rgArgs({}, { ...quickOpen, useIgnoreFiles: false }).includes('--no-ignore'), true);

// --- the recent section forgets files that are gone ---------------------------

const { recentFiles, activate } = require(path.join(ROOT, 'features', 'file-search.js'));
const onDisk = new Set(['file:///w/kept.js']);
Object.assign(vscode, {
  Uri: { parse: (key) => ({ key, toString: () => key }) },
  window: { activeTextEditor: undefined, tabGroups: { all: [] }, onDidChangeActiveTextEditor: () => ({}) },
  workspace: {
    fs: { stat: (uri) => (onDisk.has(uri.key) ? Promise.resolve({}) : Promise.reject(new Error('gone'))) },
    asRelativePath: (uri) => uri.key.slice('file:///w/'.length),
  },
});
let stored = ['file:///w/kept.js', 'file:///w/deleted.js'];
activate({ workspaceState: { get: () => stored, update: (_, value) => (stored = value) }, subscriptions: [] });

recentFiles().then((files) => {
  check('a deleted file leaves the recent section', files.map((file) => file.path), ['kept.js']);
  check('and the history it was remembered in', stored, ['file:///w/kept.js']);
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
});
