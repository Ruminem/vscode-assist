#!/usr/bin/env node
'use strict';
/**
 * Render the extension icon.
 *
 *   node tools/make-icon.js [outfile]
 *
 * Lifted from vscode-neon-glow's renderer with its variants cut down to the one
 * this extension uses. No dependencies: the shapes are signed distance fields
 * and the PNG is assembled by hand on top of zlib.
 *
 * Two arrows, one each way - the round trip Alt+G makes between a declaration
 * and its definition.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4; /* supersample factor, downsampled at the end */
const W = SIZE * SS;

/* A tight, dim halo keeps the strokes readable at the 40px the list shows. */
const GLOW_RADIUS = 5.5; /* in icon-space pixels */
const GLOW_LEVEL = 0.5;
const CORE_WHITE = 0.6; /* white lift at the centre line of a stroke, 0 at its edge */

const CYAN = [0x66, 0xd9, 0xef];
const PINK = [0xf9, 0x26, 0x72];
const BG = [0x0e, 0x0e, 0x16];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance to a capsule: a stroke from a to b with radius r. */
function sdSegment(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - r;
}

const S = (v) => v * SS; /* icon-space (128) -> render-space */

function shapes() {
  const r = S(7);
  const stroke = (colour, segments) => ({
    colour,
    r,
    sdf: (x, y) =>
      Math.min(...segments.map((p) => sdSegment(x, y, S(p[0]), S(p[1]), S(p[2]), S(p[3]), r))),
  });
  return [
    /* out: left to right, head on the right */
    stroke(CYAN, [[28, 46, 98, 46], [98, 46, 82, 30], [98, 46, 82, 62]]),
    /* back: right to left, head on the left */
    stroke(PINK, [[100, 82, 30, 82], [30, 82, 46, 66], [30, 82, 46, 98]]),
  ];
}

function render(list) {
  const px = new Float32Array(W * W * 3);
  const alpha = new Float32Array(W * W);
  const panelHalf = S(64);
  const panelR = S(28);
  const glowSigma = S(GLOW_RADIUS);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const p3 = i * 3;
      const dPanel = sdRoundRect(x + 0.5, y + 0.5, panelHalf, panelHalf, panelHalf, panelHalf, panelR);
      const cover = Math.max(0, Math.min(1, 0.5 - dPanel));
      if (cover <= 0) continue;

      alpha[i] = cover;
      px[p3] = BG[0];
      px[p3 + 1] = BG[1];
      px[p3 + 2] = BG[2];

      for (const s of list) {
        const d = s.sdf(x + 0.5, y + 0.5);
        const g = Math.exp(-(Math.max(0, d) ** 2) / (2 * glowSigma * glowSigma));
        const core = Math.max(0, Math.min(1, 0.5 - d));
        const wh = CORE_WHITE * Math.max(0, Math.min(1, -d / (s.r * 0.85)));
        for (let k = 0; k < 3; k++) {
          const hot = s.colour[k] + (255 - s.colour[k]) * wh;
          const lit = px[p3 + k] + s.colour[k] * g * GLOW_LEVEL;
          px[p3 + k] = lit * (1 - core) + hot * core;
        }
      }
    }
  }

  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * W + (x * SS + sx);
          r += px[i * 3];
          g += px[i * 3 + 1];
          b += px[i * 3 + 2];
          a += alpha[i];
        }
      }
      const n = SS * SS;
      const o = (y * SIZE + x) * 4;
      out[o] = Math.min(255, Math.round(r / n));
      out[o + 1] = Math.min(255, Math.round(g / n));
      out[o + 2] = Math.min(255, Math.round(b / n));
      out[o + 3] = Math.min(255, Math.round((a / n) * 255));
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; /* bit depth */
  ihdr[9] = 6; /* colour type: RGBA */

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outFile = process.argv[2] || path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(outFile, encodePng(render(shapes()), SIZE));
console.log('icon -> ' + outFile);
