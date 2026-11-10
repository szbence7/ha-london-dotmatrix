/* London bus stop Countdown sign: stop name and clock on top, then route / destination / minutes. */
import { fontHeight, textWidth as fontWidth } from "./engine.js";

const FONT = "dm"; // 5x7 LED font of the Countdown signs
const ROW = fontHeight(FONT);
const textWidth = (t) => fontWidth(t, FONT);
import { DotmatrixCard, filterDepartures, londonClock, secondsTo, statusText } from "./base-card.js";

const GAP = 2;
const PAD = 1;

/** Countdown wording: "due", "2min" (no space, checked on stop photos). */
export function busTime(seconds) {
  if (seconds < 60) return "due";
  return `${Math.floor(seconds / 60)}min`;
}

export class DotmatrixBusCard extends DotmatrixCard {
  static modes = ["bus"];
  static idealColumns = 160;
  static emptyText = "Select a bus stop";
  static defaults = {
    color: "#ff8a00",
    rows: 3,
    departures: 5,
    show_title: true,
    show_header: false,
    show_clock: false,
    show_status: true,
    scroll_speed: 22,
    background: true,
    show_attribution: false,
    dot_shape: "round",
    empty_text: "No buses due",
  };

  /* Countdown sign: amber LEDs, 5x7 font, "1  31  Camden Town  due".
   * Like the real signs, the first bus stays put and the rows below page through the later
   * buses with a swipe-up ("2, 3" -> "4, 5" -> "2, 3" …). */
  _buildModel(attrs, now) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    const rows = Math.max(1, Math.min(8, Number(c.rows) || 3));
    const total = Math.max(rows, Math.min(20, Number(c.departures) || 5));
    const shown = deps.slice(0, total);
    const idxW = textWidth(String(Math.max(1, shown.length)));
    const routeW = Math.max(textWidth("888"), ...shown.map((d) => textWidth(String(d.line_name))));
    const timeW = Math.max(textWidth("88min"), ...shown.map((d) => textWidth(busTime(secondsTo(d, now)))));
    const lines = [];
    const cell = (o) => ({ font: FONT, ...o });
    const row = (d, i) => [
      cell({ text: String(i + 1), w: idxW, gap: 4 }),
      cell({ text: String(d.line_name), w: routeW, align: "right", gap: 6 }),
      cell({ text: String(d.destination), flex: true, gap: 4 }),
      cell({ text: busTime(secondsTo(d, now)), w: timeW, align: "right" }),
    ];
    let y = PAD;
    if (c.show_header) {
      const name = attrs.letter ? `${attrs.stop_name}  ${attrs.letter}` : attrs.stop_name || "";
      const cells = [cell({ text: name, flex: true, gap: 4 })];
      if (c.show_clock) cells.push(cell({ text: londonClock(now, false), align: "right" }));
      lines.push({ y, cells });
      y += ROW + GAP + 2;
    }
    if (!shown.length) {
      lines.push({ y, cells: [cell({ text: c.empty_text || "", flex: true, align: "center" })] });
      y += ROW + GAP;
    } else {
      // first bus fixed
      lines.push({ y, cells: row(shown[0], 0) });
      y += ROW + GAP;
      // the other rows page through the rest, in step (same timing for every row)
      const rest = shown.slice(1);
      const per = rows - 1;
      const pages = Math.max(1, Math.ceil(rest.length / Math.max(1, per)));
      for (let r = 0; r < per; r++) {
        const items = [];
        for (let p = 0; p < pages; p++) {
          const k = p * per + r;
          items.push(rest[k] ? row(rest[k], k + 1) : []);
        }
        lines.push({ y, items, showMs: 5000, transMs: 500 });
        y += ROW + GAP;
      }
    }
    const message = c.show_status ? statusText(attrs, [...new Set(deps.map((d) => d.line))]) : "";
    if (message) {
      lines.push({ y, cells: [cell({ text: message, flex: true })] });
      y += ROW + GAP;
    }
    const title = attrs.letter ? `${attrs.stop_name} (Stop ${attrs.letter})` : attrs.stop_name || "";
    return {
      title: attrs.towards ? `${title} → ${attrs.towards}` : title,
      panels: [{ key: "bus", rows: y - GAP + PAD, lines }],
    };
  }
}
