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

// features/fuzzy.js has no vscode import, but hangul.js is required beside it
// in the feature, so the stub stays for symmetry and for anything added later.
const load = Module._load;
Module._load = (request, parent, isMain) => (request === 'vscode' ? {} : load(request, parent, isMain));

const ROOT = path.join(__dirname, '..');
const { toKeys, hasHangul, readings } = require(path.join(ROOT, 'features', 'hangul.js'));
const { fuzzyMatch, startsWord } = require(path.join(ROOT, 'features', 'fuzzy.js'));

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

const { matchPath, rgArgs } = require(path.join(ROOT, 'features', 'file-search.js'));
const rank = (query, target, nameOnly = false) => {
  const match = matchPath(query, target, nameOnly);
  return match ? match.score : null;
};
const above = (query, first, second) => rank(query, first) > rank(query, second);

// The Quick Open ordering, in its three tiers. Each pair is chosen so that the
// old whole-path scoring ranks it the other way - a pair both orderings agree
// on pins nothing.
check('a name that starts with the query beats a name that holds it', above('arrow', 'z/arrow-key.js', 'dot-arrow.js'), true);
// Scored as one string, `features/dot-arrow.js` wins this: three word starts
// against one word start and a run.
check('a name that holds the letters beats folders that hold them', above('fda', 'zzz/fdxa.js', 'features/dot-arrow.js'), true);
check('the folders are still searched when the name misses', rank('fda', 'features/dot-arrow.js') !== null, true);
check('a slash sends the piece to the path', rank('features/dot', 'features/dot-arrow.js') !== null, true);

// Pieces split on spaces, all required, in any order.
check('pieces match in any order', rank('js dot', 'features/dot-arrow.js') !== null, true);
check('every piece has to match', rank('dot zzz', 'features/dot-arrow.js'), null);
check('a Hangul piece is read through its keys', rank('애 ㅓㄴ', 'features/dot-arrow.js') !== null, true);

// The recent section: as loose as the rest, but the name alone - unless the
// piece is a path.
check('a recent file matches scattered letters in its name', rank('dar', 'features/dot-arrow.js', true) !== null, true);
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

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
