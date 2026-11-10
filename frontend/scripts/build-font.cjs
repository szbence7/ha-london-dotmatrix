#!/usr/bin/env node
/**
 * Rasterises the dot-matrix typefaces into per-glyph LED bitmaps: frontend/src/font-data.js.
 *
 *   lu      "London Underground" dot-matrix typeface by petykowski (SIL OFL): Tube boards.
 *   dm      "Dot Matrix Regular" by Daniel Hart (SIL OFL): UK station boards and bus Countdown (5x7).
 *   dmTall  "Dot Matrix Bold Tall" by Daniel Hart (SIL OFL): the big station board clock digits.
 *
 * Each font is drawn on a canvas so that one font dot = P pixels, and the centre of every grid cell
 * is sampled. The cards then draw from these bitmaps (pre-rendered LED strips, bitmap copies only)
 * instead of calling fillText with a web font.
 *
 * Run once (needs Playwright): node frontend/scripts/build-font.cjs
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src", "font-data.js");

const FONTS = {
  lu: {
    file: "LondonUnderground-Regular.ttf",
    // native dot pitch: 33.35 px at 300 px
    size: (P) => (300 * P) / 33.35,
    chars: null, // every printable ASCII glyph the font has
    // The typeface draws capitals and digits one dot below the lowercase baseline; on the real
    // indicators every letter stands on the same baseline (checked against platform photos).
    raise: /^[A-Z0-9&]$/,
  },
  dm: {
    file: "Dot Matrix Regular.ttf",
    size: (P) => P * 10, // 1 dot = size / 10
    chars: null,
  },
  dmTall: {
    file: "Dot Matrix Bold Tall.ttf",
    size: (P) => P * 10,
    chars: "0123456789: ",
  },
};

// Glyphs the LU font does not have, drawn in the same style (rows top -> bottom: 8 … -2).
const LU_EXTRA = {
  "(": ["..#.", ".#..", "#...", "#...", "#...", "#...", "#...", ".#..", "..#.", "....", "...."],
  ")": [".#..", "..#.", "...#", "...#", "...#", "...#", "...#", "..#.", ".#..", "....", "...."],
  "/": ["....#.", "....#.", "...#..", "...#..", "..#...", ".#....", ".#....", "#.....", "#.....", "......", "......"],
  "!": ["#.", "#.", "#.", "#.", "#.", "#.", "#.", "..", "#.", "..", ".."],
  "?": [".####..", "#....#.", ".....#.", "....#..", "...#...", "...#...", ".......", "...#...", "...#...", ".......", "......."],
  ";": ["...", "...", "...", "##.", "##.", "...", "##.", "##.", ".#.", "#..", "..."],
  '"': ["#.#.", "#.#.", "#.#.", "....", "....", "....", "....", "....", "....", "....", "...."],
  "£": ["..###..", ".#...#.", ".#.....", ".#.....", "####...", ".#.....", ".#.....", ".#.....", "######.", ".......", "......."],
  "#": [".#.#..", ".#.#..", "#####.", ".#.#..", ".#.#..", "#####.", ".#.#..", ".#.#..", "......", "......", "......"],
  "@": [".####..", "#....#.", "#.##.#.", "#.#.##.", "#.#.##.", "#..##..", "#......", ".####..", ".......", ".......", "......."],
  "%": ["##...#.", "##..#..", "...#...", "...#...", "..#....", "..#....", ".#...##", "#....##", ".......", ".......", "......."],
  "=": ["......", "......", "......", "#####.", "......", "#####.", "......", "......", "......", "......", "......"],
  "_": ["......", "......", "......", "......", "......", "......", "......", "......", "#####.", "......", "......"],
  "<": ["....#.", "...#..", "..#...", ".#....", "#.....", ".#....", "..#...", "...#..", "....#.", "......", "......"],
  ">": ["#.....", ".#....", "..#...", "...#..", "....#.", "...#..", "..#...", ".#....", "#.....", "......", "......"],
  "[": ["###.", "#...", "#...", "#...", "#...", "#...", "#...", "#...", "###.", "....", "...."],
  "]": ["###.", "..#.", "..#.", "..#.", "..#.", "..#.", "..#.", "..#.", "###.", "....", "...."],
};

async function rasterise(page, key, cfg) {
  const font = fs.readFileSync(path.join(ROOT, "fonts", cfg.file)).toString("base64");
  return page.evaluate(async ({ font, key, size, chars, raise }) => {
    const face = new FontFace(key, `url(data:font/ttf;base64,${font})`);
    await face.load();
    document.fonts.add(face);
    const P = 20, S = size, W = 600, H = 600, BASE = 400, X0 = 60;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const list = chars ? [...chars] : Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    const raiseRe = raise ? new RegExp(raise) : null;
    const out = {};
    for (const ch of list) {
      ctx.font = `${S}px ${key}, monospace`;
      const a = ctx.measureText(ch).width;
      ctx.font = `${S}px ${key}, serif`;
      if (Math.abs(a - ctx.measureText(ch).width) > 0.01) continue; // not in the font
      ctx.font = `${S}px ${key}`;
      ctx.clearRect(0, 0, W, H);
      ctx.fillText(ch, X0, BASE);
      const adv = Math.round(a / P);
      const data = ctx.getImageData(0, 0, W, H).data;
      const rows = {};
      for (let r = -4; r <= 12; r++) {
        let bits = "";
        for (let k = 0; k < adv; k++) {
          const x = Math.round(X0 + (k + 0.5) * P);
          const y = Math.round(BASE - (r + 0.5) * P);
          bits += data[(y * W + x) * 4 + 3] > 128 ? "#" : ".";
        }
        rows[raiseRe && raiseRe.test(ch) ? r + 1 : r] = bits;
      }
      out[ch] = { adv, rows };
    }
    return out;
  }, { font, key, size: cfg.size(20), chars: cfg.chars, raise: cfg.raise ? cfg.raise.source : null });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  const tables = {};
  for (const [key, cfg] of Object.entries(FONTS)) {
    const raw = await rasterise(page, key, cfg);
    // global row range actually used by the font
    let top = -Infinity, bottom = Infinity;
    for (const g of Object.values(raw)) {
      for (const [r, bits] of Object.entries(g.rows)) {
        if (bits.includes("#")) { top = Math.max(top, +r); bottom = Math.min(bottom, +r); }
      }
    }
    const glyphs = {};
    for (const [ch, g] of Object.entries(raw)) {
      const rows = [];
      for (let r = top; r >= bottom; r--) rows.push(g.rows[r] ?? ".".repeat(g.adv));
      glyphs[ch] = rows;
    }
    if (key === "lu") {
      for (const [ch, rows] of Object.entries(LU_EXTRA)) {
        if (rows.length !== top - bottom + 1) throw new Error(`LU extra ${ch}: ${rows.length} rows, font has ${top - bottom + 1}`);
        glyphs[ch] = rows;
      }
    }
    const height = top - bottom + 1;
    const encode = (rows) => [rows[0].length, ...rows.map((r) => [...r].reduce((m, c, i) => m | (c === "#" ? 1 << i : 0), 0))];
    tables[key] = { height, baseline: top, glyphs: Object.fromEntries(Object.entries(glyphs).sort().map(([c, r]) => [c, encode(r)])) };
    console.log(`${key}: ${Object.keys(glyphs).length} glyphs, ${height} rows (${top} … ${bottom})`);
  }
  await browser.close();
  const header = `/* Generated by frontend/scripts/build-font.cjs. Do not edit.
 * LED bitmaps rasterised from SIL Open Font License 1.1 typefaces (see frontend/fonts/):
 *   lu      "London Underground" dot-matrix typeface by petykowski
 *           https://github.com/petykowski/London-Underground-Dot-Matrix-Typeface (plus extra punctuation)
 *   dm      "Dot Matrix Regular" by Daniel Hart, https://github.com/DanielHartUK/Dot-Matrix-Typeface
 *   dmTall  "Dot Matrix Bold Tall" (digits) by Daniel Hart
 * Format: char -> [width, row0 … rowN] (top to bottom, bit 0 = left column). */
`;
  fs.writeFileSync(OUT, `${header}export const FONT_DATA = ${JSON.stringify(tables)};\n`);
})();
