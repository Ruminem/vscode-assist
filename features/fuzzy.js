// SPDX-License-Identifier: MIT
'use strict';

// Matching a query against a name.
//
// Lifted out of symbol-search.js when the file search wanted the same thing.
// Nothing here knows what it is matching - it takes two strings - so a symbol
// name and a workspace-relative path go through the same scoring, and there is
// one copy of it to keep correct rather than two that drift.

/**
 * Where a word begins, for the bonus the scoring gives those positions.
 *
 * `_` and `:` are the symbol-name ones. `/`, `-` and `.` were added for paths,
 * where the parts a person remembers are the folder, the file and the
 * extension: typing `fda` should reach `features/dot-arrow.js` by its three
 * beginnings rather than by three letters buried mid-word. They cost the symbol
 * names nothing, which almost never contain any of the three.
 * @param {string} text @param {number} i
 */
const BOUNDARY = new Set(['_', ':', '/', '\\', '-', '.']);
function startsWord(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  const here = text[i];
  return BOUNDARY.has(prev) || (prev === prev.toLowerCase() && here !== here.toLowerCase());
}

/**
 * The quick pick's own word starts in a label: where it lets a highlighted
 * letter land after a gap (filters.ts matchesCamelCase and nextAnchor, main
 * 2026-09-28). A capital, a digit, or anything after a character that is not an
 * ASCII letter or digit - a space or a bracket as much as a dash.
 *
 * The pick looks at the first PICKER_CUT characters only, and sizes them up
 * first. A label that does not read as camel case - a fifth or more digits, a
 * fifth or fewer small letters, four fifths capitals, or two fifths neither
 * letter nor digit - gets no word starts at all, and only a run is highlighted
 * in it: null comes back. CODE_OF_CONDUCT.md is one. The exception is a label
 * of capitals with no small letter, which is lowered first: README keeps its
 * start at R and loses the D that README.md has.
 *
 * Spelled out as one flag per character, past the cut too: the sizing-up reads
 * the first PICKER_CUT, but a run found past them still scores its word starts.
 * @param {string} label
 * @returns {Uint8Array | null}
 */
const PICKER_CUT = 60;
const WORD = /[A-Za-z0-9]/;
function pickerAnchors(label) {
  const n = Math.min(label.length, PICKER_CUT);
  let upper = 0;
  let lower = 0;
  let digits = 0;
  for (let i = 0; i < n; i++) {
    const c = label[i];
    if (c >= 'A' && c <= 'Z') upper++;
    else if (c >= 'a' && c <= 'z') lower++;
    else if (c >= '0' && c <= '9') digits++;
  }
  const camel = lower / n > 0.2 && upper / n < 0.8 && (upper + lower + digits) / n > 0.6 && digits / n < 0.2;
  if (!camel && !(lower === 0 && upper / n > 0.6)) return null;
  const start = camel ? /[A-Z0-9]/ : /[0-9]/;
  const flags = new Uint8Array(label.length);
  for (let i = 0; i < label.length; i++) flags[i] = i === 0 || start.test(label[i]) || !WORD.test(label[i - 1]) ? 1 : 0;
  return flags;
}

/**
 * startsWord for every character of a text, as pickerAnchors spells its own.
 * @param {string} text
 */
function wordStarts(text) {
  const flags = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) flags[i] = startsWord(text, i) ? 1 : 0;
  return flags;
}

/**
 * Whether every character of q is in t, in order. Most of a list fails this,
 * and finding out costs one pass - so a caller holding a lot of names asks it
 * first and works out the word starts only for the names that pass.
 * @param {string} q @param {string} t
 */
function inOrder(q, t) {
  let k = 0;
  for (let i = 0; i < t.length && k < q.length; i++) if (t.charCodeAt(i) === q.charCodeAt(k)) k++;
  return k === q.length;
}

// Two rows of the pass below, kept between calls: the file search runs it on
// tens of thousands of paths a keystroke, and two fresh arrays per letter per
// path were most of what that cost.
let cur = new Float64Array(64);
let prev = new Float64Array(64);

/**
 * The score of the best fit of q in t, or null - fuzzyMatch's work, for a
 * caller that has lowered both strings and worked out the word starts once.
 * `len` is the length of the name before lowering, which the score is
 * shortened by. Assumes inOrder(q, t).
 *
 * One pass per query character keeps the best score for every place that
 * character could land: a character scores 1, or 3 where a word starts, and 3
 * more for landing right after the one before. A tie goes to the run. A row
 * where no place is left ends the passes early - a first letter that starts no
 * word, anchored, is decided in one row instead of one per letter.
 * @param {string} q @param {string} t @param {number} len
 * @param {Uint8Array | null} anchors @param {boolean} anchored
 * @returns {number | null}
 */
function fit(q, t, len, anchors, anchored) {
  if (!q.length) return null;
  // Anchored, the word starts are the pick's, and so is the cut: past it only
  // the run at the end can reach.
  const n = anchored ? Math.min(t.length, PICKER_CUT) : t.length;
  if (n > cur.length) {
    cur = new Float64Array(n * 2);
    prev = new Float64Array(n * 2);
  }
  let reached = true;
  for (let j = 0; j < q.length && reached; j++) {
    const c = q.charCodeAt(j);
    reached = false;
    // The best score among earlier characters that ended at least two places
    // back - landing right after one of those is not a run.
    let apart = -Infinity;
    for (let i = 0; i < n; i++) {
      if (j > 0 && i >= 2 && prev[i - 2] > apart) apart = prev[i - 2];
      cur[i] = -Infinity;
      if (t.charCodeAt(i) !== c) continue;
      const starts = anchors !== null && anchors[i] === 1;
      const gain = starts ? 3 : 1;
      if (j === 0) {
        if (!anchored || starts) {
          cur[i] = gain;
          reached = true;
        }
        continue;
      }
      const run = i >= 1 ? prev[i - 1] + 3 : -Infinity;
      // Anchored, a letter that does not start a word can only extend a run.
      const jump = anchored && !starts ? -Infinity : apart;
      const best = run >= jump ? run : jump;
      if (best === -Infinity) continue;
      cur[i] = best + gain;
      reached = true;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  if (reached) {
    let best = -Infinity;
    for (let i = 0; i < n; i++) if (prev[i] > best) best = prev[i];
    return best - len / 100;
  }
  // The one fit the anchoring skipped that the picker still draws: the query
  // as a run starting mid-word, `sets` in CMakePresets.json. Scored as the
  // pass above would have.
  const at = anchored ? t.indexOf(q) : -1;
  if (at < 0) return null;
  let score = 3 * (q.length - 1);
  for (let k = 0; k < q.length; k++) score += anchors !== null && anchors[at + k] === 1 ? 3 : 1;
  return score - len / 100;
}

/**
 * Every character of the query, in order, anywhere in the name - so "ce" finds
 * Circle. That is the match clangd will not make on its own: it only matches at
 * the start of the name or at word starts, and answers "ce" with nothing.
 * Scored so the names a person meant come first: runs of adjacent characters,
 * characters that start a word, and shorter names (fit, above).
 *
 * Of all the ways the query fits into a name, the best-scoring one is kept, not
 * the first one found: the first "a" after the "t" of totalArea is the one
 * inside "total", where anyone typing "ta" meant the t and the A, and the score
 * has to say so. Where the letters land does not come back: a quick pick
 * highlights what its own matcher finds, and the bold look-alike letters this
 * file used to draw were too faint to read.
 *
 * `anchored` narrows the fits to the ones that matcher can draw (filters.ts
 * matchesFuzzy, 2026-09-28): the query as one run wherever it sits, or else a
 * first letter that starts a word and every next letter either starting a word
 * or following the one before - word starts as the pick counts them
 * (pickerAnchors), within its first PICKER_CUT characters. The file search asks
 * for this, so that no row it shows is one the picker leaves unhighlighted -
 * `ckjs` no longer reaches package.json through pa[ck]age.[js]on, and `ckc`
 * reaches `check-keys copy.js`. The symbol search does not: `ce` on Circle is
 * the match it exists for, highlight or not.
 * @param {string} query @param {string} name @param {boolean} [anchored]
 * @returns {{score: number} | null}
 */
function fuzzyMatch(query, name, anchored = false) {
  const q = query.toLowerCase();
  const t = name.toLowerCase();
  if (!q.length || !inOrder(q, t)) return null;
  const score = fit(q, t, name.length, anchored ? pickerAnchors(name) : wordStarts(name), anchored);
  return score === null ? null : { score };
}

/**
 * With fuzzy off the query has to appear as typed, letters adjacent, ignoring
 * case. An earlier position ranks higher, a name that starts with it highest.
 * @param {string} query @param {string} name
 * @returns {{score: number, positions: number[]} | null}
 */
function exactMatch(query, name) {
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return null;
  return { score: 100 - i - name.length / 100, positions: Array.from(query, (_, k) => i + k) };
}

/**
 * Whether a name or a path holds a word that starts with "test": test_foo.py,
 * foo.test.js, tests/, FooTest.cpp, TestFoo, testdata/. Both searches rank
 * these below everything else unless the query itself has "test" in it - test
 * files share the names of what they test, and push the real one down a list
 * where it was typed for.
 *
 * A word start here is the first character, a capital after a small letter, or
 * anything after a character that is not a letter - wider than startsWord, so
 * `my test.cpp` and `v2test` count. What it cannot see is "test" fused into a
 * word, googletest or unittest; a test/ folder under those still counts.
 * latest, contest and Attestation are the reason it looks for word starts at all.
 * @param {string} text
 */
function mentionsTest(text) {
  for (const { index: i } of text.matchAll(/test/gi)) {
    const prev = i > 0 ? text[i - 1] : '';
    if (!/[A-Za-z]/.test(prev) || (/[a-z]/.test(prev) && text[i] === 'T')) return true;
  }
  return false;
}

module.exports = { startsWord, pickerAnchors, wordStarts, inOrder, fit, fuzzyMatch, exactMatch, mentionsTest };
