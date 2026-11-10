/* Rail-style indicator for the DLR, Overground, Elizabeth line, trams, river buses and the
 * cable car: header (platform or line + clock), '1st / 2nd / 3rd' rows, optional status line. */
import { ROW, textWidth } from "./engine.js";
import { GlowboardCard, filterDepartures, londonClock, secondsTo, statusText } from "./base-card.js";
import { tubeTime } from "./tube-card.js";

const GAP = 3;
const PAD = 1;
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

export class GlowboardRailCard extends GlowboardCard {
  static modes = ["dlr", "overground", "elizabeth-line", "tram", "river-bus", "cable-car", "tube"];
  static idealColumns = 170;
  static emptyText = "Select a station";
  static defaults = {
    color: "#ffb000",
    rows: 3,
    show_title: true,
    show_header: true,
    show_clock: true,
    show_status: true,
    group_by_platform: false,
    show_line: false,
    max_boards: 4,
    scroll_speed: 22,
    background: true,
    empty_text: "No departures",
  };

  _board(deps, attrs, now, header) {
    const c = this._config;
    const count = Math.max(1, Math.min(10, Number(c.rows) || 3));
    const shown = deps.slice(0, count);
    const ordW = Math.max(...ORDINALS.slice(0, Math.max(1, shown.length)).map(textWidth));
    const timeW = Math.max(textWidth("10 mins"), ...shown.map((d) => textWidth(tubeTime(secondsTo(d, now)))));
    const lines = [];
    let y = PAD;
    if (c.show_header) {
      const cells = [{ text: header, flex: true, gap: 4 }];
      if (c.show_clock) cells.push({ text: londonClock(now, false), align: "right" });
      lines.push({ y, cells });
      y += ROW + GAP + 2;
    }
    if (!shown.length) {
      lines.push({ y, cells: [{ text: c.empty_text || "", flex: true, align: "center" }] });
      y += ROW + GAP;
    }
    shown.forEach((d, i) => {
      const cells = [{ text: ORDINALS[i], w: ordW, gap: 5 }];
      if (c.show_line) cells.push({ text: d.line_name, w: textWidth(d.line_name), gap: 5 });
      cells.push({ text: d.destination, flex: true, gap: 4 });
      cells.push({ text: tubeTime(secondsTo(d, now)), w: timeW, align: "right" });
      lines.push({ y, cells });
      y += ROW + GAP;
    });
    const message = c.show_status ? statusText(attrs, [...new Set(deps.map((d) => d.line))]) : "";
    if (message) {
      y += 2;
      lines.push({ y, cells: [{ text: message, flex: true }] });
      y += ROW + GAP;
    }
    return { lines, rows: y - GAP + PAD };
  }

  _buildModel(attrs, now) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    const title = attrs.stop_name || "";
    const lineNames = [...new Set(deps.map((d) => d.line_name))].join(" / ");
    let groups;
    if (c.group_by_platform) {
      const map = new Map();
      for (const d of deps) {
        const key = d.platform || d.line_name || "";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(d);
      }
      groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }));
      groups = groups.slice(0, Math.max(1, Number(c.max_boards) || 1));
    }
    if (!groups?.length) groups = [[c.platform || "", deps]];
    const panels = groups.map(([key, list]) => {
      const header = c.header || key || [...new Set(list.map((d) => d.line_name))].join(" / ") || lineNames || title;
      const board = this._board(list, attrs, now, header);
      return { key: key || "all", caption: "", rows: board.rows, lines: board.lines };
    });
    return { title, panels };
  }
}
