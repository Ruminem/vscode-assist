// SPDX-License-Identifier: MIT
'use strict';

// What was typed, when the Korean input method was on and the file name is not.
//
// Code is written in English and file names follow it, but the input method
// does not know that. Reaching for `abcd` with Hangul still switched on puts
// `뮻ㅇ` in the box: the keys land as jamo, the jamo compose into syllables, and
// nothing matches. The usual fix is to notice, clear the box, press the Hangul
// key and type it again - three steps for a mistake the letters already
// describe, because every jamo came from exactly one key.
//
// So a query is read twice: as itself, and as the keys that produced it. No
// language is detected and no guess is made about intent; the second reading is
// simply offered alongside the first and whichever matches better wins.

// The 2-set (두벌식) layout, which every Korean keyboard sold uses: jamo to the
// key it sits on. Compound vowels and compound final consonants are two
// keystrokes, so they map to two characters - `ㅘ` is `ㅗ` then `ㅏ`, which is
// `h` then `k`.
const KEY = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
  // Shifted keys. Lower case is what comes back: a file name match ignores case
  // anyway, and `Q` would otherwise have to survive every caller's toLowerCase.
  ㅃ: 'q', ㅉ: 'w', ㄸ: 'e', ㄲ: 'r', ㅆ: 't', ㅒ: 'o', ㅖ: 'p',
  ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl', ㅢ: 'ml',
  ㄳ: 'rt', ㄵ: 'sw', ㄶ: 'sg', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft',
  ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg', ㅄ: 'qt',
};

// A composed syllable is one code point holding three slots, in this order.
const LEAD = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const VOWEL = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const TAIL = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

const FIRST = 0xac00; // 가
const LAST = 0xd7a3; // 힣
const TAILS = TAIL.length; // 28
const VOWELS = VOWEL.length; // 21

/**
 * The keys that would have produced this text.
 *
 * A composed syllable is split back into its three slots and each is looked up;
 * a lone jamo, which is what a half-finished syllable leaves behind, is looked
 * up directly. Anything else - letters, digits, punctuation, a space - is
 * already what was typed and is passed through, so a query that mixes the two
 * (`뮻ㅇ_test`) comes out whole.
 * @param {string} text
 */
function toKeys(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= FIRST && code <= LAST) {
      const n = code - FIRST;
      out += KEY[LEAD[Math.floor(n / (VOWELS * TAILS))]] || '';
      out += KEY[VOWEL[Math.floor(n / TAILS) % VOWELS]] || '';
      out += KEY[TAIL[n % TAILS]] || '';
    } else {
      out += KEY[ch] !== undefined ? KEY[ch] : ch;
    }
  }
  return out;
}

/** Whether there is any Hangul here at all - a syllable or a lone jamo. */
function hasHangul(text) {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= FIRST && code <= LAST) return true;
    if (code >= 0x3131 && code <= 0x3163) return true; // the compatibility jamo block
  }
  return false;
}

/**
 * The readings of a query worth matching against, best-known first.
 *
 * The query itself always comes first: a file really can be named in Korean,
 * and a reading that was never Hangul has nothing to add. The keyed reading is
 * offered second and only when there is Hangul to key, so the common case - an
 * English query - allocates nothing and matches once.
 * @param {string} query
 * @returns {string[]}
 */
function readings(query) {
  if (!hasHangul(query)) return [query];
  const keyed = toKeys(query);
  return keyed && keyed !== query ? [query, keyed] : [query];
}

module.exports = { toKeys, hasHangul, readings };
