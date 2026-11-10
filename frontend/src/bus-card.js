/* London bus stop Countdown sign: stop name and clock on top, then route / destination / minutes. */
import { ROW, textWidth } from "./engine.js";
import { DotmatrixCard, filterDepartures, londonClock, secondsTo, statusText } from "./base-card.js";

const GAP = 3;
const PAD = 1;

export function busTime(seconds) {
  if (seconds < 60) return "due";
  return `${Math.floor(seconds / 60)} min`;
}

export class DotmatrixBusCard extends DotmatrixCard {
  static modes = ["bus"];
  static idealColumns = 190;
  static emptyText = "Select a bus stop";
  static defaults = {
    color: "#ff8a00",
    rows: 4,
    show_title: false,
    show_header: true,
    show_clock: true,
    show_status: false,
    scroll_speed: 22,
    background: true,
    show_attribution: false,
    dot_shape: "square",
    empty_text: "No buses due",
  };

  _buildModel(attrs, now) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    const count = Math.max(1, Math.min(12, Number(c.rows) || 4));
    const shown = deps.slice(0, count);
    const routeW = Math.max(textWidth("888"), ...shown.map((d) => textWidth(d.line_name)));
    const timeW = Math.max(textWidth("88 min"), ...shown.map((d) => textWidth(busTime(secondsTo(d, now)))));
    const lines = [];
    let y = PAD;
    if (c.show_header) {
      const name = attrs.letter ? `${attrs.stop_name}  ${attrs.letter}` : attrs.stop_name || "";
      const cells = [{ text: name, flex: true, gap: 4 }];
      if (c.show_clock) cells.push({ text: londonClock(now, false), align: "right" });
      lines.push({ y, cells });
      y += ROW + GAP + 2;
    }
    if (!shown.length) {
      lines.push({ y, cells: [{ text: c.empty_text || "", flex: true, align: "center" }] });
      y += ROW + GAP;
    }
    for (const d of shown) {
      lines.push({
        y,
        cells: [
          { text: d.line_name, w: routeW, gap: 6 },
          { text: d.destination, flex: true, gap: 4 },
          { text: busTime(secondsTo(d, now)), w: timeW, align: "right" },
        ],
      });
      y += ROW + GAP;
    }
    const message = c.show_status ? statusText(attrs, [...new Set(shown.map((d) => d.line))]) : "";
    if (message) {
      y += 2;
      lines.push({ y, cells: [{ text: message, flex: true }] });
      y += ROW + GAP;
    }
    const title = attrs.letter ? `${attrs.stop_name} (Stop ${attrs.letter})` : attrs.stop_name || "";
    return {
      title: attrs.towards ? `${title} → ${attrs.towards}` : title,
      panels: [{ key: "bus", rows: y - GAP + PAD, lines }],
    };
  }
}
