// SPDX-License-Identifier: MIT
'use strict';

// Matching a query against a name, and showing which letters matched.
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
 * Every character of the query, in order, anywhere in the name - so "ce" finds
 * Circle. That is the match clangd will not make on its own: it only matches at
 * the start of the name or at word starts, and answers "ce" with nothing.
 * Scored so the names a person meant come first: runs of adjacent characters,
 * characters that start a word, and shorter names.
 *
 * Of all the ways the query fits into a name, the best-scoring one is kept, not
 * the first one found. It matters because the positions are shown in bold: taking
 * the first "a" after the "t" of totalArea marks the "a" inside "total", where
 * anyone typing "ta" meant the t and the A. One pass per query character keeps
 * the best score for every place that character could land, which is length of
 * query times length of name - small at symbol-name sizes.
 * @param {string} query @param {string} name
 * @returns {{score: number, positions: number[]} | null}
 */
function fuzzyMatch(query, name) {
  const q = query.toLowerCase();
  const t = name.toLowerCase();
  const n = t.length;
  if (!q.length || q.length > n) return null;
  // Most of the list does not hold the letters in order at all. Rule those out
  // with one pass before the scoring below allocates two arrays per letter.
  let k = 0;
  for (let i = 0; i < n && k < q.length; i++) if (t[i] === q[k]) k++;
  if (k < q.length) return null;

  let prev = [];
  const back = [];
  for (let j = 0; j < q.length; j++) {
    const cur = new Array(n).fill(-Infinity);
    const link = new Array(n).fill(-1);
    // The best score among earlier characters that ended at least two places
    // back - landing right after one of those is not a run.
    let apart = -Infinity;
    let apartAt = -1;
    for (let i = 0; i < n; i++) {
      if (j > 0 && i >= 2 && prev[i - 2] > apart) {
        apart = prev[i - 2];
        apartAt = i - 2;
      }
      if (t[i] !== q[j]) continue;
      const gain = 1 + (startsWord(name, i) ? 2 : 0);
      if (j === 0) {
        cur[i] = gain;
        continue;
      }
      const run = i >= 1 ? prev[i - 1] + 3 : -Infinity;
      if (run === -Infinity && apart === -Infinity) continue;
      // A tie goes to the run.
      if (run >= apart) {
        cur[i] = run + gain;
        link[i] = i - 1;
      } else {
        cur[i] = apart + gain;
        link[i] = apartAt;
      }
    }
    back.push(link);
    prev = cur;
  }

  let end = -1;
  for (let i = 0; i < n; i++) if (prev[i] > -Infinity && (end < 0 || prev[i] > prev[end])) end = i;
  if (end < 0) return null;

  const positions = new Array(q.length);
  for (let j = q.length - 1, i = end; j >= 0; j--) {
    positions[j] = i;
    i = back[j][i];
  }
  return { score: prev[end] - name.length / 100, positions };
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

// Put between every character of a label. Invisible, and it keeps VS Code from
// finding any run of the query in the label to highlight on its own.
const JOINER = '⁠';

/**
 * VS Code gives an extension no say in which letters of a quick pick label are
 * highlighted. It bolds whatever its own matcher finds, which is adjacent
 * letters, so for "ta" it lights up the "ta" inside "total" while the fuzzy
 * match chose the t and the A - and for "ce" it lights up nothing. So the
 * letters that matched are drawn in Mathematical Sans-Serif Bold instead, and a
 * word joiner between every character leaves VS Code nothing of its own to find.
 * ponytail: a Unicode trick, not an API. Only A-Z, a-z and 0-9 have bold forms,
 * screen readers announce them as mathematical letters, and the glyphs come from
 * whichever font covers that block. QuickPickItem has no highlight property,
 * stable or proposed, as of VS Code 1.137; switch to it if one appears.
 * @param {string} name @param {number[]} positions
 */
function decorate(name, positions) {
  const bold = new Set(positions);
  return Array.from(name, (ch, i) => {
    if (!bold.has(i)) return ch;
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
    return ch;
  }).join(JOINER);
}

module.exports = { startsWord, fuzzyMatch, exactMatch, decorate, JOINER };
