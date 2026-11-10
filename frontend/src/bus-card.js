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
    color: "#ff3a1f",
    rows: 4,
    show_title: true,
    show_header: false,
    show_clock: false,
    show_status: false,
    scroll_speed: 22,
    background: true,
    show_attribution: false,
    dot_shape: "round",
    empty_text: "NO BUSES DUE",
  };

  /* Countdown sign (checked against stop photos): red LEDs, 5x7 capitals,
   * "1  31  CAMDEN TOWN   due" / "3 328  GOLDERS GREEN  2min". */
  _buildModel(attrs, now) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    const count = Math.max(1, Math.min(12, Number(c.rows) || 4));
    const shown = deps.slice(0, count);
    const idxW = textWidth(String(Math.max(1, shown.length)));
    const routeW = Math.max(textWidth("888"), ...shown.map((d) => textWidth(String(d.line_name).toUpperCase())));
    const timeW = Math.max(textWidth("88min"), ...shown.map((d) => textWidth(busTime(secondsTo(d, now)))));
    const lines = [];
    const cell = (o) => ({ font: FONT, ...o });
    let y = PAD;
    if (c.show_header) {
      const name = (attrs.letter ? `${attrs.stop_name}  ${attrs.letter}` : attrs.stop_name || "").toUpperCase();
      const cells = [cell({ text: name, flex: true, gap: 4 })];
      if (c.show_clock) cells.push(cell({ text: londonClock(now, false), align: "right" }));
      lines.push({ y, cells });
      y += ROW + GAP + 2;
    }
    if (!shown.length) {
      lines.push({ y, cells: [cell({ text: c.empty_text || "", flex: true, align: "center" })] });
      y += ROW + GAP;
    }
    shown.forEach((d, i) => {
      lines.push({
        y,
        cells: [
          cell({ text: String(i + 1), w: idxW, gap: 4 }),
          cell({ text: String(d.line_name).toUpperCase(), w: routeW, align: "right", gap: 6 }),
          cell({ text: String(d.destination).toUpperCase(), flex: true, gap: 4 }),
          cell({ text: busTime(secondsTo(d, now)), w: timeW, align: "right" }),
        ],
      });
      y += ROW + GAP;
    });
    const message = c.show_status ? statusText(attrs, [...new Set(shown.map((d) => d.line))]) : "";
    if (message) {
      lines.push({ y, cells: [cell({ text: message.toUpperCase(), flex: true })] });
      y += ROW + GAP;
    }
    const title = attrs.letter ? `${attrs.stop_name} (Stop ${attrs.letter})` : attrs.stop_name || "";
    return {
      title: attrs.towards ? `${title} → ${attrs.towards}` : title,
      panels: [{ key: "bus", rows: y - GAP + PAD, lines }],
    };
  }
}
