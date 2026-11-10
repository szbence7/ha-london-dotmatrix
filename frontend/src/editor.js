/* Visual editor shared by the three cards: live stop search (adds the stop to the integration
 * with one click) + the card options, with platform and line choices taken from the stop. */
import { COLORS, DOMAIN } from "./base-card.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MODE_ICONS = {
  tube: "🚇", bus: "🚌", dlr: "🚈", overground: "🚆", "elizabeth-line": "🚄", tram: "🚊", "river-bus": "⛴️", "cable-car": "🚡",
};

const LABELS = {
  entity: "Stop sensor",
  title: "Title (default: stop name)",
  header: "Header text (default: platform or line)",
  platform: "Platform (empty: every platform)",
  lines: "Only these lines / routes (empty: all)",
  color: "LED colour",
  rows: "Departure rows",
  max_boards: "Max. boards (one per platform)",
  scroll_speed: "Scroll speed (dots/s)",
  columns: "Dots per row (empty: automatic)",
  dot_shape: "LED shape",
  show_title: "Show title",
  show_platform: "Platform caption above each board",
  show_header: "Header row on the board",
  show_clock: "Clock",
  stand_back: "“STAND BACK” when a train is due",
  show_status: "Disruption messages",
  group_by_platform: "One board per platform",
  show_line: "Line name on each row",
  background: "Black board with bezel",
  show_attribution: "“Powered by TfL Open Data”",
  empty_text: "Text when nothing is due",
};

const SEARCH_HINT = {
  "glowboard-tube-card": "e.g. Oxford Circus, Bank or King's Cross",
  "glowboard-bus-card": "e.g. Oxford Circus, Brixton Station or Camden Town",
  "glowboard-rail-card": "e.g. Stratford, Canary Wharf, Wimbledon or Greenwich Pier",
};

function options(attrs, cardType) {
  const deps = Array.isArray(attrs?.departures) ? attrs.departures : [];
  const platforms = [...new Set(deps.map((d) => d.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const directions = [...new Set(platforms.map((p) => /^(\w+bound)\b/i.exec(p)?.[1]).filter(Boolean))];
  const platformOptions = [
    { value: "", label: "Every platform" },
    ...directions.map((d) => ({ value: d, label: `${d} (every ${d.toLowerCase()} platform)` })),
    ...platforms.map((p) => ({ value: p, label: p })),
  ];
  const known = new Map();
  for (const l of Array.isArray(attrs?.lines) ? attrs.lines : []) known.set(l.id, `${MODE_ICONS[l.mode] || ""} ${l.name}`.trim());
  for (const d of deps) if (!known.has(d.line)) known.set(d.line, `${MODE_ICONS[d.mode] || ""} ${d.line_name}`.trim());
  const wantBus = cardType === "glowboard-bus-card";
  const lineOptions = [...known.entries()]
    .filter(([id]) => {
      const mode = (attrs?.lines || []).find((l) => l.id === id)?.mode || deps.find((d) => d.line === id)?.mode;
      return wantBus ? mode === "bus" : mode !== "bus";
    })
    .map(([value, label]) => ({ value, label }));
  return { platformOptions, lineOptions };
}

function schema(cardType, attrs) {
  const { platformOptions, lineOptions } = options(attrs, cardType);
  const entity = { name: "entity", required: true, selector: { entity: { domain: "sensor", filter: { integration: DOMAIN } } } };
  const platform = { name: "platform", selector: { select: { options: platformOptions, custom_value: true, mode: "dropdown" } } };
  const lines = lineOptions.length
    ? { name: "lines", selector: { select: { options: lineOptions, multiple: true, mode: "list" } } }
    : null;
  const color = { name: "color", selector: { select: { options: COLORS, custom_value: true, mode: "dropdown" } } };
  const num = (name, min, max, step = 1) => ({ name, selector: { number: { min, max, step, mode: "box" } } });
  const bool = (name) => ({ name, selector: { boolean: {} } });
  const grid = (...schema) => ({ type: "grid", name: "", schema });
  const shape = { name: "dot_shape", selector: { select: { mode: "dropdown", options: [{ value: "round", label: "Round" }, { value: "square", label: "Square" }] } } };

  if (cardType === "glowboard-bus-card") {
    return [entity, { name: "title", selector: { text: {} } }, lines,
      grid(num("rows", 1, 12), color, num("scroll_speed", 5, 60), num("columns", 80, 400, 10), shape, { name: "empty_text", selector: { text: {} } }),
      grid(bool("show_title"), bool("show_header"), bool("show_clock"), bool("show_status"), bool("background"), bool("show_attribution")),
    ].filter(Boolean);
  }
  if (cardType === "glowboard-rail-card") {
    return [entity, { name: "title", selector: { text: {} } }, platform, lines, { name: "header", selector: { text: {} } },
      grid(num("rows", 1, 10), color, num("max_boards", 1, 8), num("scroll_speed", 5, 60), num("columns", 80, 400, 10), shape),
      grid(bool("show_title"), bool("show_header"), bool("show_clock"), bool("show_status"), bool("group_by_platform"),
        bool("show_line"), bool("background"), bool("show_attribution")),
    ].filter(Boolean);
  }
  return [entity, { name: "title", selector: { text: {} } }, platform, lines,
    grid(color, num("max_boards", 1, 8), num("scroll_speed", 5, 60), num("columns", 80, 400, 10), shape, { name: "empty_text", selector: { text: {} } }),
    grid(bool("show_title"), bool("show_platform"), bool("show_clock"), bool("stand_back"), bool("show_status"), bool("background"), bool("show_attribution")),
  ].filter(Boolean);
}

export class GlowboardCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._seq = 0;
  }

  get _cardType() {
    return String(this._config?.type || "").replace(/^custom:/, "") || "glowboard-tube-card";
  }

  get _cardClass() {
    return customElements.get(this._cardType);
  }

  setConfig(config) {
    const defaults = this._cardClass?.defaults || {};
    this._config = { ...config };
    this._formData = { ...defaults, ...config };
    this._refreshForm();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (this._form) this._form.hass = hass;
    const id = this._config?.entity;
    if (id && old?.states[id] !== hass.states[id]) this._refreshForm();
  }

  _attrs() {
    const id = this._config?.entity;
    return (id && this._hass?.states[id]?.attributes) || {};
  }

  _refreshForm() {
    if (!this._form) return;
    // keep the schema stable while the same stop is selected (options change every poll)
    const key = `${this._cardType}|${this._config?.entity || ""}|${JSON.stringify(options(this._attrs(), this._cardType))}`;
    if (key !== this._schemaKey) {
      this._schemaKey = key;
      this._form.schema = schema(this._cardType, this._attrs());
    }
    this._form.data = this._formData;
  }

  async _build() {
    this._built = true;
    if (!customElements.get("ha-form") && window.loadCardHelpers) {
      try {
        const helpers = await window.loadCardHelpers();
        const card = await helpers.createCardElement({ type: "entities", entities: [] });
        await card.constructor.getConfigElement();
      } catch (e) { /* ignore */ }
    }
    this.shadowRoot.innerHTML = `
      <style>
        .search { margin-bottom: 20px; }
        .label { font-weight: 500; margin: 0 0 6px; color: var(--primary-text-color); }
        .hint { font-size: 12px; color: var(--secondary-text-color); margin: 4px 0 0; }
        input { box-sizing: border-box; width: 100%; height: 48px; padding: 0 14px; font-size: 16px; border-radius: 10px;
          border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color); outline: none; }
        input:focus { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
        .status { font-size: 13px; color: var(--secondary-text-color); margin: 8px 2px 0; min-height: 18px; }
        .status.err { color: var(--error-color, #db4437); }
        .results { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; max-height: 420px; overflow: auto; }
        .item { all: unset; box-sizing: border-box; cursor: pointer; display: block; width: 100%; padding: 10px 12px; border-radius: 10px;
          border: 1px solid var(--divider-color, #ddd); background: var(--card-background-color, #fff); }
        .item:hover, .item:focus-visible { border-color: var(--primary-color); background: var(--secondary-background-color, #f5f5f5); }
        .item.selected { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
        .modes { font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; color: var(--secondary-text-color); }
        .line { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 6px; color: var(--primary-text-color); flex-wrap: wrap; }
        .name { font-size: 15px; font-weight: 600; }
        .letter { font: 700 11px/1 Roboto, Arial, sans-serif; background: #dc241f; color: #fff; border-radius: 50%; min-width: 14px; padding: 3px; text-align: center; }
        .dir { font-size: 13px; color: var(--secondary-text-color); }
        .added { margin-left: auto; font-size: 12px; color: var(--success-color, #43a047); font-weight: 600; white-space: nowrap; }
        .badges { display: flex; flex-wrap: wrap; gap: 4px; }
        .badge { font: 700 12px/1 Roboto, Arial, sans-serif; padding: 4px 6px; border-radius: 4px; min-width: 14px; text-align: center; }
        .badge.dark { box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
      </style>
      <div class="search">
        <div class="label">Find a station or stop</div>
        <input type="search" autocomplete="off" placeholder="Start typing, ${esc(SEARCH_HINT[this._cardType] || SEARCH_HINT["glowboard-tube-card"])}">
        <div class="hint">Click a result: if it is not added yet, it is added to the Glowboard London integration automatically.</div>
        <div class="status"></div>
        <div class="results"></div>
      </div>
      <ha-form></ha-form>`;
    this._input = this.shadowRoot.querySelector("input");
    this._status = this.shadowRoot.querySelector(".status");
    this._results = this.shadowRoot.querySelector(".results");
    this._form = this.shadowRoot.querySelector("ha-form");
    this._form.computeLabel = (s) => LABELS[s.name] || s.name;
    this._form.hass = this._hass;
    this._refreshForm();
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._update(ev.detail.value);
    });
    this._input.addEventListener("input", () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._search(), 300);
    });
  }

  _setStatus(text, err = false) {
    this._status.textContent = text || "";
    this._status.classList.toggle("err", !!err);
  }

  async _search() {
    const q = this._input.value.trim();
    const seq = ++this._seq;
    if (q.length < 3) {
      this._results.innerHTML = "";
      this._setStatus(q.length ? "Type at least 3 letters…" : "");
      return;
    }
    this._setStatus("Searching…");
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/search`, query: q, modes: this._cardClass?.modes || [] });
      if (seq !== this._seq) return; // a newer search is running
      this._renderResults(res.stops || []);
      this._setStatus(res.stops?.length ? `${res.stops.length} result${res.stops.length === 1 ? "" : "s"}` : "Nothing found. Try a shorter name.");
    } catch (e) {
      if (seq !== this._seq) return;
      this._results.innerHTML = "";
      this._setStatus(e?.code === "unknown_command"
        ? "Install and set up the Glowboard London integration first."
        : e?.message || "Search failed.", true);
    }
  }

  _renderResults(stops) {
    this._stops = stops;
    this._results.innerHTML = stops.map((s, i) => {
      const badges = (s.lines || []).slice(0, 24).map((l) => {
        const dark = /^#(0{6}|1|2)/i.test(l.color);
        return `<span class="badge${dark ? " dark" : ""}" style="background:${esc(l.color)};color:${esc(l.text_color)}">${esc(l.name)}</span>`;
      }).join("");
      const modes = (s.modes || []).map((m) => `${MODE_ICONS[m] || ""} ${m.replace("-", " ")}`).join(" · ");
      const selected = s.entity_id && s.entity_id === this._config?.entity;
      return `<button class="item${selected ? " selected" : ""}" data-i="${i}">
        <div class="modes">${esc(modes)}</div>
        <div class="line"><span class="name">${esc(s.name)}</span>${s.letter ? `<span class="letter">${esc(s.letter)}</span>` : ""}${s.towards ? `<span class="dir">→ ${esc(s.towards)}</span>` : ""}${s.added ? `<span class="added">✓ added</span>` : ""}</div>
        <div class="badges">${badges}</div>
      </button>`;
    }).join("");
    this._results.querySelectorAll(".item").forEach((el) =>
      el.addEventListener("click", () => this._pick(this._stops[Number(el.dataset.i)]))
    );
  }

  async _pick(stop) {
    try {
      let entity = stop.entity_id;
      if (!stop.added || !entity) {
        this._setStatus(`Adding ${stop.name}…`);
        const res = await this._hass.callWS({ type: `${DOMAIN}/add_stop`, stop_id: stop.id });
        entity = res.entity_id;
        stop.added = true;
        stop.entity_id = entity;
      }
      const config = { ...this._config, entity };
      delete config.platform; // platforms and lines belong to the old stop
      delete config.lines;
      this._update(config);
      this._setStatus(`Selected: ${stop.name}${stop.letter ? ` (Stop ${stop.letter})` : ""}`);
      this._renderResults(this._stops);
    } catch (e) {
      this._setStatus(e?.message || "Could not add the stop.", true);
    }
  }

  _update(value) {
    // only keep options that differ from the card defaults, so YAML stays short
    const defaults = this._cardClass?.defaults || {};
    const config = { type: this._config?.type };
    for (const [k, v] of Object.entries(value)) {
      if (k === "type" || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
      if (k in defaults && defaults[k] === v) continue;
      config[k] = v;
    }
    this._config = config;
    this._formData = { ...defaults, ...config };
    this._refreshForm();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}
