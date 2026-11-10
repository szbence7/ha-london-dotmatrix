/* Shared card shell: Home Assistant plumbing, layout, visibility and the render scheduler. */
import { Panel, ROW } from "./engine.js";

export const DOMAIN = "london_dotmatrix";

export const COLORS = [
  { value: "#ffb000", label: "Amber (Underground)" },
  { value: "#ff8a00", label: "Orange" },
  { value: "#ffd200", label: "Yellow" },
  { value: "#3dff6e", label: "Green" },
  { value: "#f4f4f4", label: "White" },
  { value: "#ff3b30", label: "Red" },
];

const MIN_PITCH = 1.4;
const MAX_PITCH = 4.5;

const clockFormats = new Map();
/** Board clock, always London time (GMT/BST), whatever the viewer's timezone. */
export function londonClock(now, seconds = true) {
  const key = seconds ? "s" : "m";
  let fmt = clockFormats.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
      ...(seconds ? { second: "2-digit" } : {}),
    });
    clockFormats.set(key, fmt);
  }
  return fmt.format(new Date(now));
}

export const secondsTo = (dep, now) => dep.expected - now / 1000;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [255, 176, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Departures of the card's stop that pass the card's filters (still visible for 30 s after due). */
export function filterDepartures(attrs, config, now) {
  const lines = (config.lines || []).map((l) => String(l).toLowerCase());
  const platform = String(config.platform || "").trim().toLowerCase();
  const direction = String(config.direction || "").trim().toLowerCase();
  return (Array.isArray(attrs?.departures) ? attrs.departures : [])
    .filter((d) => d.expected * 1000 > now - 30000)
    .filter((d) => !lines.length || lines.includes(String(d.line).toLowerCase()))
    .filter((d) => !platform || String(d.platform || "").toLowerCase() === platform ||
      String(d.platform || "").toLowerCase().includes(platform))
    .filter((d) => !direction || String(d.direction || "").toLowerCase() === direction)
    .sort((a, b) => a.expected - b.expected);
}

/** Disruption text for the given lines (only lines that are not running a good service). */
export function statusText(attrs, lineIds) {
  const wanted = new Set(lineIds.map((l) => String(l).toLowerCase()));
  const seen = new Set();
  return (Array.isArray(attrs?.line_status) ? attrs.line_status : [])
    .filter((s) => wanted.has(s.line) && s.severity !== 10 && s.severity !== 18 && s.reason)
    .map((s) => s.reason.replace(/\s+/g, " ").trim())
    .filter((r) => !seen.has(r) && seen.add(r))
    .join("   ***   ");
}

export class DotmatrixCard extends HTMLElement {
  static defaults = {};
  static idealColumns = 170;
  static modes = [];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._timer = null;
    this._visible = false;
    this._panels = [];
    this._onVisibilityChange = () => this._render();
  }

  static getStubConfig(hass) {
    const modes = this.modes;
    const ids = Object.keys(hass.states).filter((id) => {
      const a = hass.states[id].attributes;
      return id.startsWith("sensor.") && Array.isArray(a.departures) && Array.isArray(a.modes) && a.stop_id;
    });
    const entity = ids.find((id) => hass.states[id].attributes.modes.some((m) => modes.includes(m))) || "";
    return { entity };
  }

  static getConfigElement() {
    return document.createElement("dotmatrix-card-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...this.constructor.defaults, ...config };
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    const state = this._config?.entity ? hass.states[this._config.entity] : undefined;
    if (state !== this._state) {
      this._state = state;
      this._dirty = true;
      this._render();
    }
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => {
      this._dirty = true;
      this._render();
    });
    this._intersectionObserver = new IntersectionObserver(([entry]) => {
      this._visible = entry.isIntersecting;
      this._render();
    });
    if (this._root) this._resizeObserver.observe(this._root);
    this._intersectionObserver.observe(this);
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    this._render();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    clearTimeout(this._timer);
    this._timer = null;
    this._visible = false;
  }

  _build() {
    const c = this._config;
    this._resizeObserver?.disconnect();
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { display: block; overflow: hidden; box-sizing: border-box; }
        .wrap { padding: 14px; }
        .title { color: var(--primary-text-color); font-size: 1.2em; font-weight: 500; margin: 0 0 10px 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .title:empty, .caption:empty { display: none; }
        .panels { display: flex; flex-direction: column; gap: 12px; }
        .caption { color: var(--secondary-text-color); font-size: 0.85em; font-weight: 500; margin: 0 0 5px 2px;
          display: flex; align-items: center; gap: 6px; }
        .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
        .board { border-radius: 6px; padding: 10px; }
        .board.bezel { background: #050505; border: 1px solid #2a2a2a;
          box-shadow: inset 0 0 14px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.04); }
        canvas { display: block; width: 100%; }
        .attribution { color: var(--secondary-text-color); font-size: 10px; text-align: right; margin: 6px 2px 0; opacity: .7; }
        .attribution:empty { display: none; }
      </style>
      <ha-card>
        <div class="wrap">
          <div class="title"></div>
          <div class="panels"></div>
          <div class="attribution"></div>
        </div>
      </ha-card>`;
    this._root = this.shadowRoot.querySelector(".panels");
    this._titleEl = this.shadowRoot.querySelector(".title");
    this._attributionEl = this.shadowRoot.querySelector(".attribution");
    this._panels = [];
    this._model = null;
    this._dirty = true;
    if (this.isConnected) this._resizeObserver?.observe(this._root);
    this._state = c.entity ? this._hass?.states[c.entity] : undefined;
    this._render();
  }

  _style() {
    const c = this._config;
    const [r, g, b] = hexToRgb(c.color);
    return {
      color: c.color,
      dim: c.background === false ? "rgba(127,127,127,0.14)" : `rgba(${r},${g},${b},0.075)`,
      round: c.dot_shape !== "square",
      speed: Number(c.scroll_speed) > 0 ? Number(c.scroll_speed) : 22,
    };
  }

  /** Subclasses: (attrs, now, cols) -> { title, panels: [{ key, caption, swatch, rows, lines }] } */
  // eslint-disable-next-line no-unused-vars
  _buildModel(attrs, now, cols) {
    return { title: "", panels: [] };
  }

  _message(text) {
    return { title: this._config.title || "", panels: [{ key: "msg", rows: ROW + 4, lines: [{ y: 2, cells: [{ text, flex: true, align: "center" }] }] }] };
  }

  _idealColumns() {
    return this.constructor.idealColumns;
  }

  _geometry() {
    const width = this._root.clientWidth - 20; // board padding
    if (width <= 0) return null;
    const dpr = window.devicePixelRatio || 1;
    const ideal = Number(this._config.columns) > 0 ? Number(this._config.columns) : this._idealColumns();
    let pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, width / ideal));
    if (Number(this._config.columns) > 0) pitch = Math.max(0.5, width / ideal);
    pitch = Math.max(1 / dpr, Math.round(pitch * dpr) / dpr);
    const cols = Math.max(20, Math.floor((width * dpr) / Math.round(pitch * dpr)));
    return { width, dpr, pitch, cols };
  }

  _syncPanels(model, geo) {
    const panels = model.panels;
    // (re)create DOM only when the set of panels changed
    const keys = panels.map((p) => p.key).join("|");
    if (keys !== this._panelKeys) {
      this._panelKeys = keys;
      const bezel = this._config.background !== false;
      this._root.innerHTML = panels.map(() => `
        <div class="panel"><div class="caption"></div><div class="board${bezel ? " bezel" : ""}"><canvas></canvas></div></div>`).join("");
      const style = this._style();
      this._panels = [...this._root.querySelectorAll(".panel")].map((el) => ({
        el,
        caption: el.querySelector(".caption"),
        panel: new Panel(el.querySelector("canvas"), style),
      }));
    }
    const style = this._style();
    panels.forEach((p, i) => {
      const slot = this._panels[i];
      const caption = p.caption || "";
      const html = caption ? `${p.swatch ? `<span class="swatch" style="background:${p.swatch}"></span>` : ""}<span></span>` : "";
      if (slot.captionKey !== caption + (p.swatch || "")) {
        slot.captionKey = caption + (p.swatch || "");
        slot.caption.innerHTML = html;
        if (caption) slot.caption.lastElementChild.textContent = caption;
      }
      slot.panel.setStyle(style);
      slot.panel.setGeometry({ cols: geo.cols, rows: p.rows, pitch: geo.pitch, dpr: geo.dpr, cssWidth: geo.width });
    });
  }

  _render() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this._root || !this.isConnected || !this._visible || document.hidden) return;
    const geo = this._geometry();
    if (!geo) return;

    const t = performance.now();
    const now = Date.now();
    const geoKey = `${geo.width}|${geo.pitch}|${geo.dpr}|${geo.cols}`;
    if (this._dirty || geoKey !== this._geoKey || !this._model || now >= this._nextModel) {
      this._dirty = false;
      this._geoKey = geoKey;
      const s = this._state;
      let model;
      if (!this._config.entity) model = this._message(this.constructor.emptyText || "Select a stop");
      else if (!s || s.state === "unavailable") model = this._message("No data");
      else model = this._buildModel(s.attributes || {}, now, geo.cols);
      this._model = model;
      const title = this._config.show_title === false ? "" : this._config.title || model.title || "";
      if (this._titleEl.textContent !== title) this._titleEl.textContent = title;
      const nr = (this._state?.attributes?.modes || []).includes("national-rail");
      const credit = this._config.show_attribution !== true ? ""
        : nr ? "Powered by National Rail Enquiries" : "Powered by TfL Open Data";
      if (this._attributionEl.textContent !== credit) this._attributionEl.textContent = credit;
      this._syncPanels(model, geo);
      model.panels.forEach((p, i) => this._panels[i].panel.setLines(p.lines, t));
      // rebuild on the next full second (clock, countdowns)
      this._nextModel = Math.floor(now / 1000) * 1000 + 1000;
    }
    let delay = this._nextModel - now;
    for (const { panel } of this._panels) delay = Math.min(delay, panel.frame(t));
    this._timer = setTimeout(() => this._render(), Math.max(16, Math.ceil(delay)));
  }
}
