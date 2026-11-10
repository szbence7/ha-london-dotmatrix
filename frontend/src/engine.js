/*
 * Dot-matrix engine shared by the three Dotmatrix cards.
 *
 * Performance model (same as the Budapest FUTÁR card, which fixed the slow dashboards):
 * - nothing runs while the card is off-screen or the tab is hidden;
 * - no animation loop: one setTimeout to the next visible change (scroll step, carousel
 *   step, next second for the clock);
 * - the dim LED grid and every text strip (with its glow) are rendered once into offscreen
 *   canvases; a frame is only drawImage copies, and identical frames are skipped.
 */
import { FONT_HEIGHT, GLYPHS } from "./font-data.js";

export const ROW = FONT_HEIGHT; // dot rows per text line (incl. the descender row)
const MARQUEE_GAP = 24; // blank dots between marquee repeats
const SCROLL_PAUSE_MS = 1500; // marquee rests at its start, like the real boards
const FALLBACK = "?";

const CHAR_MAP = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
  "•": ".", "·": ".", "…": "...", " ": " ", "→": ">", "←": "<",
};

const glyphCache = new Map();

function glyph(ch) {
  let g = glyphCache.get(ch);
  if (g) return g;
  let raw = GLYPHS[ch];
  if (!raw) {
    const mapped = CHAR_MAP[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    raw = mapped.length === 1 ? GLYPHS[mapped] : null;
    if (!raw && mapped.length > 1) {
      g = textMatrix(mapped);
      glyphCache.set(ch, g);
      return g;
    }
    raw = raw || GLYPHS[FALLBACK];
  }
  const width = raw[0];
  const rows = [];
  for (let r = 0; r < ROW; r++) {
    const row = new Uint8Array(width);
    for (let c = 0; c < width; c++) row[c] = (raw[r + 1] >> c) & 1;
    rows.push(row);
  }
  g = { width, rows };
  glyphCache.set(ch, g);
  return g;
}

/** Text -> { width, rows[ROW] of Uint8Array } (proportional, glyphs carry their own spacing). */
export function textMatrix(text) {
  const glyphs = [...String(text ?? "")].map(glyph);
  const width = glyphs.reduce((w, g) => w + g.width, 0);
  const rows = Array.from({ length: ROW }, () => new Uint8Array(width));
  let x = 0;
  for (const g of glyphs) {
    for (let r = 0; r < ROW; r++) rows[r].set(g.rows[r], x);
    x += g.width;
  }
  // the last glyph's trailing blank column is spacing, not ink
  return { width: Math.max(0, width - (glyphs.length ? 1 : 0)), rows };
}

export const textWidth = (text) => textMatrix(text).width;

/**
 * Lay out one line of cells into `cols` dots.
 * cell: { text, w?: fixed width in dots (default: text width), flex?: true, align?: left|right|center,
 *         gap?: blank dots after the cell, color?, scroll?: false to clip instead of scrolling }
 */
function layoutCells(cells, cols) {
  const fixed = cells.reduce((sum, c) => sum + (c.flex ? 0 : c.w ?? textWidth(c.text)) + (c.gap || 0), 0);
  const flexCount = cells.filter((c) => c.flex).length || 1;
  const flexWidth = Math.max(0, Math.floor((cols - fixed) / flexCount));
  let x = 0;
  return cells.map((c) => {
    const width = Math.max(0, Math.min(cols - x, c.flex ? flexWidth : c.w ?? textWidth(c.text)));
    const out = { ...c, x, width };
    x += width + (c.gap || 0);
    return out;
  });
}

export class Panel {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, style) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.style = style; // { color, dim, round }
    this.lines = [];
    this.sprites = null;
    this.geometry = "";
  }

  setStyle(style) {
    const key = JSON.stringify(style);
    if (key === this._styleKey) return;
    this._styleKey = key;
    this.style = style;
    this.background = null;
    this.lines = [];
    this.sprites = null;
  }

  /** cols x rows dots, pitch in CSS px, cssWidth = space available. */
  setGeometry({ cols, rows, pitch, dpr, cssWidth }) {
    const key = `${cols}|${rows}|${pitch}|${dpr}|${cssWidth}`;
    if (key === this.geometry) return;
    this.geometry = key;
    this.cols = cols;
    this.rows = rows;
    this.pitch = pitch;
    this.dpr = dpr;
    this.pp = Math.max(1, Math.round(pitch * dpr)); // device px per dot (integer: crisp LEDs)
    this.offsetX = Math.max(0, Math.floor((cssWidth * dpr - cols * this.pp) / 2));
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = rows * this.pp;
    this.canvas.style.height = `${(rows * this.pp) / dpr}px`;
    this.background = null;
    this.lines = [];
    this.sprites = null;
  }

  /**
   * lines: [{ y, cells } | { y, items: [cells, …], showMs, transMs }]
   * Layers are reused while their text, colour and box are unchanged (scroll phase survives updates).
   */
  setLines(lines, t) {
    const prev = this.lines;
    this.lines = lines.map((line, i) => {
      const old = prev[i];
      if (line.items) {
        const items = line.items.map((cells, k) => this._lineLayers(cells, old?.items?.[k], t));
        // keep the carousel phase while the same number of items is shown (times tick every minute)
        const same = old?.items && old.items.length === items.length;
        return {
          y: line.y,
          items,
          showMs: line.showMs || 3500,
          transMs: line.transMs || 450,
          start: same ? old.start : t,
        };
      }
      return { y: line.y, layers: this._lineLayers(line.cells, old?.layers ? old : null, t).layers };
    });
  }

  _lineLayers(cells, old, t) {
    const placed = layoutCells(cells, this.cols);
    const layers = placed.map((cell, i) => {
      if (cell.width <= 0 || !cell.text) return null;
      const color = cell.color || this.style.color;
      const prior = old?.layers?.[i];
      if (prior && prior.text === cell.text && prior.x === cell.x && prior.width === cell.width &&
          prior.color === color && prior.align === (cell.align || "left")) {
        return prior;
      }
      const m = textMatrix(cell.text);
      const scroll = m.width > cell.width && cell.scroll !== false;
      let offset = 0;
      if (!scroll) {
        if (cell.align === "right") offset = Math.max(0, cell.width - m.width);
        else if (cell.align === "center") offset = Math.max(0, Math.floor((cell.width - m.width) / 2));
      }
      return {
        text: cell.text, x: cell.x, width: cell.width, color, align: cell.align || "left",
        matrix: m, length: scroll ? m.width + MARQUEE_GAP : m.width, offset, scroll,
        start: t, tileStart: -Infinity, bitmap: null,
      };
    });
    return { layers };
  }

  _dotPath(cols, rows, test) {
    const pp = this.pp;
    const size = Math.max(1, Math.round(pp * 0.78));
    const pad = (pp - size) / 2;
    const path = new Path2D();
    const round = this.style.round !== false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!test(x, y)) continue;
        if (round) {
          path.moveTo(x * pp + pp / 2 + size / 2, y * pp + pp / 2);
          path.arc(x * pp + pp / 2, y * pp + pp / 2, size / 2, 0, Math.PI * 2);
        } else if (path.roundRect) {
          path.roundRect(x * pp + pad, y * pp + pad, size, size, Math.min(size / 2, pp * 0.2));
        } else {
          path.rect(x * pp + pad, y * pp + pad, size, size);
        }
      }
    }
    return path;
  }

  _strip(cols, test, color) {
    // 1 dot of margin above and below so the glow is not cut
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cols * this.pp);
    canvas.height = (ROW + 2) * this.pp;
    const ctx = canvas.getContext("2d");
    ctx.translate(0, this.pp);
    ctx.fillStyle = ctx.shadowColor = color;
    ctx.shadowBlur = this.pp * 0.9;
    ctx.fill(this._dotPath(cols, ROW, test));
    return canvas;
  }

  /** Visible state at time t: sprites + ms until the next change. */
  _sprites(t) {
    const sprites = [];
    let delay = Infinity;
    const addLayers = (layers, y, dy, clip, t0) => {
      for (const layer of layers) {
        if (!layer) continue;
        let step = 0;
        if (layer.scroll) {
          const stepMs = 1000 / this.style.speed;
          const cycle = SCROLL_PAUSE_MS + layer.length * stepMs;
          const e = (t - Math.max(layer.start, t0 ?? -Infinity)) % cycle;
          if (e < SCROLL_PAUSE_MS) {
            delay = Math.min(delay, SCROLL_PAUSE_MS - e);
          } else {
            step = Math.floor((e - SCROLL_PAUSE_MS) / stepMs) + 1;
            if (step >= layer.length) step = 0;
            delay = Math.min(delay, SCROLL_PAUSE_MS + step * stepMs - e);
          }
        }
        sprites.push({ layer, y, dy, step, clip });
      }
    };
    for (const line of this.lines) {
      if (line.layers) {
        addLayers(line.layers, line.y, 0, false);
        continue;
      }
      const n = line.items.length;
      if (!n) continue;
      if (n === 1) {
        addLayers(line.items[0].layers, line.y, 0, false);
        continue;
      }
      const cycle = line.showMs + line.transMs;
      const e = t - line.start;
      const idx = Math.floor(e / cycle) % n;
      const within = e % cycle;
      const itemStart = t - within;
      if (within < line.showMs) {
        addLayers(line.items[idx].layers, line.y, 0, false, itemStart);
        delay = Math.min(delay, line.showMs - within);
      } else {
        // swipe up, one dot row at a time
        const span = ROW;
        const stepMs = line.transMs / span;
        const shift = Math.min(span, Math.floor((within - line.showMs) / stepMs) + 1);
        addLayers(line.items[idx].layers, line.y, -shift, true, itemStart);
        addLayers(line.items[(idx + 1) % n].layers, line.y, span - shift, true, t);
        delay = Math.min(delay, shift >= span ? cycle - within : line.showMs + shift * stepMs - within);
      }
    }
    return { sprites, delay };
  }

  /** Draw if anything visible changed. Returns ms until the next change. */
  frame(t) {
    if (!this.cols) return Infinity;
    const { sprites, delay } = this._sprites(t);
    const old = this.sprites;
    if (!old || old.length !== sprites.length || sprites.some((s, i) => {
      const o = old[i];
      return s.layer !== o.layer || s.y !== o.y || s.dy !== o.dy || s.step !== o.step;
    })) {
      this._draw(sprites);
      this.sprites = sprites;
    }
    return Math.max(16, delay);
  }

  _draw(sprites) {
    const { ctx, pp } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.background) {
      const bg = document.createElement("canvas");
      bg.width = this.cols * pp;
      bg.height = this.rows * pp;
      const b = bg.getContext("2d");
      b.fillStyle = this.style.dim;
      b.fill(this._dotPath(this.cols, this.rows, () => true));
      this.background = bg;
    }
    ctx.drawImage(this.background, this.offsetX, 0);
    for (const { layer, y, dy, step, clip } of sprites) {
      const { width, length, matrix, scroll, offset } = layer;
      const tileStart = scroll ? Math.floor(step / width) * width : 0;
      if (!layer.bitmap || tileStart !== layer.tileStart) {
        const tileWidth = scroll ? width * 2 : width;
        const rows = matrix.rows;
        layer.bitmap = this._strip(tileWidth, (col, row) => {
          if (scroll) {
            const i = (tileStart + col) % length;
            return i < matrix.width && rows[row][i] === 1;
          }
          const i = col - offset;
          return i >= 0 && i < matrix.width && rows[row][i] === 1;
        }, layer.color);
        layer.tileStart = tileStart;
      }
      const sx = (step - tileStart) * pp;
      const dx = this.offsetX + layer.x * pp;
      const top = (y + dy - 1) * pp;
      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, y * pp, width * pp, ROW * pp);
        ctx.clip();
      }
      ctx.drawImage(layer.bitmap, sx, 0, width * pp, (ROW + 2) * pp, dx, top, width * pp, (ROW + 2) * pp);
      if (clip) ctx.restore();
    }
  }
}
