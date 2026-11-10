/* Rail-style indicator for the DLR, Overground, Elizabeth line, trams, river buses, the cable car
 * and National Rail stations.
 * TfL stops: header (platform or line + clock), '1st / 2nd / 3rd' rows, optional status line.
 * National Rail: the classic station board: '1st 10:32 Brighton  Plat 4  On time', the calling
 * points scrolling under the first train, station messages and the clock. */
import { ROW, textWidth } from "./engine.js";
import { DotmatrixCard, filterDepartures, londonClock, secondsTo, statusText } from "./base-card.js";
import { tubeTime } from "./tube-card.js";

const GAP = 3;
const PAD = 1;
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

export class DotmatrixRailCard extends DotmatrixCard {
  static modes = ["dlr", "overground", "elizabeth-line", "tram", "river-bus", "cable-car", "national-rail"];
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
    show_calling_at: true,
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

  _idealColumns() {
    // a National Rail row carries more (time, platform, status): use smaller LEDs
    return (this._state?.attributes?.modes || []).includes("national-rail") ? 240 : this.constructor.idealColumns;
  }

  /** National Rail station board. */
  _nrBoard(deps, attrs, now) {
    const c = this._config;
    const count = Math.max(1, Math.min(10, Number(c.rows) || 3));
    const shown = deps.slice(0, count);
    const ordW = Math.max(...ORDINALS.slice(0, Math.max(1, shown.length)).map(textWidth));
    const timeW = textWidth("88:88");
    const plat = (d) => (d.platform === "BUS" ? "Bus" : d.platform || "");
    const platW = Math.max(0, ...shown.map((d) => textWidth(plat(d))));
    const statusW = Math.max(textWidth("On time"), ...shown.map((d) => textWidth(d.status || "")));
    const lines = [];
    let y = PAD;
    if (!shown.length) {
      lines.push({ y, cells: [{ text: c.empty_text || "", flex: true, align: "center" }] });
      y += ROW + GAP;
    }
    shown.forEach((d, i) => {
      const cells = [{ text: ORDINALS[i], w: ordW, gap: 4 }, { text: d.scheduled || "", w: timeW, gap: 5 }];
      if (c.show_line) cells.push({ text: d.line_name, w: textWidth(d.line_name), gap: 5 });
      cells.push({ text: d.destination, flex: true, gap: 4 });
      if (platW) cells.push({ text: plat(d), w: platW, gap: 5 });
      cells.push({ text: d.status || "", w: statusW, align: "right" });
      lines.push({ y, cells });
      y += ROW + GAP;
      if (i === 0 && c.show_calling_at) {
        const stops = d.calling_at || [];
        let text = "";
        if (d.cancelled) text = d.reason || "This train has been cancelled.";
        else if (stops.length) {
          const list = stops.length > 1 ? `${stops.slice(0, -1).join(", ")} and ${stops[stops.length - 1]}` : stops[0];
          text = `Calling at: ${list}.${d.line_name ? `  A ${d.line_name} service.` : ""}${d.reason ? `  ${d.reason}.` : ""}`;
        }
        if (text) {
          lines.push({ y, cells: [{ text, flex: true }] });
          y += ROW + GAP;
        }
      }
    });
    const message = c.show_status ? (Array.isArray(attrs.messages) ? attrs.messages.join("   ***   ") : "") : "";
    if (message) {
      lines.push({ y, cells: [{ text: message, flex: true }] });
      y += ROW + GAP;
    }
    if (c.show_clock) {
      lines.push({ y, cells: [{ text: londonClock(now, true), flex: true, align: "center" }] });
      y += ROW + GAP;
    }
    return { lines, rows: y - GAP + PAD };
  }

  _buildModel(attrs, now) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    if ((attrs.modes || []).includes("national-rail")) {
      const board = this._nrBoard(deps, attrs, now);
      return { title: attrs.stop_name || "", panels: [{ key: "nr", rows: board.rows, lines: board.lines }] };
    }
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
