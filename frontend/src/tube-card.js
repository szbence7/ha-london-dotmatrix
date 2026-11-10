/* London Underground platform indicator: 2 fixed rows, a third row for STAND BACK, service
 * messages or a swipe-up carousel of later trains, and the clock - one board per platform. */
import { ROW, textWidth } from "./engine.js";
import { DotmatrixCard, filterDepartures, londonClock, secondsTo, statusText } from "./base-card.js";

const STAND_BACK = ["*** STAND BACK - TRAIN APPROACHING ***", "STAND BACK - TRAIN APPROACHING", "STAND BACK"];
const GAP = 3; // dot rows between text rows
const PAD = 1;

export function tubeTime(seconds) {
  if (seconds <= 30) return "Due";
  const m = Math.round(seconds / 60);
  return m <= 1 ? "1 min" : `${m} mins`;
}

/** Real boards: 'Eastbound - Platform 2' -> group key + caption. */
function platformKey(dep) {
  return dep.platform || dep.line_name || "Departures";
}

export class DotmatrixTubeCard extends DotmatrixCard {
  static modes = ["tube"];
  static idealColumns = 200;
  static emptyText = "Select a station";
  static defaults = {
    color: "#ffb000",
    show_title: true,
    show_platform: true,
    show_clock: true,
    stand_back: true,
    show_status: true,
    max_boards: 4,
    scroll_speed: 22,
    background: true,
    show_attribution: false,
    empty_text: "",
  };

  _rowLine(dep, n, now, timeW) {
    return [
      { text: String(n), w: textWidth("8"), gap: 4 },
      { text: dep.destination, flex: true, gap: 4 },
      { text: tubeTime(secondsTo(dep, now)), w: timeW, align: "right" },
    ];
  }

  _board(deps, attrs, now, cols) {
    const c = this._config;
    const timeW = Math.max(textWidth("Due"), ...deps.slice(0, 5).map((d) => textWidth(tubeTime(secondsTo(d, now)))));
    const lines = [];
    let y = PAD;
    const row = (spec) => {
      lines.push({ y, ...spec });
      y += ROW + GAP;
    };
    if (!deps.length) {
      row({ cells: [{ text: c.empty_text || "", flex: true, align: "center" }] });
      row({ cells: [] });
    } else {
      row({ cells: this._rowLine(deps[0], 1, now, timeW) });
      row({ cells: deps[1] ? this._rowLine(deps[1], 2, now, timeW) : [] });
    }
    // row 3: STAND BACK > service message > carousel of further trains
    const message = c.show_status ? statusText(attrs, [...new Set(deps.map((d) => d.line))]) : "";
    if (c.stand_back && deps[0] && secondsTo(deps[0], now) <= 30) {
      row({ cells: [{ text: STAND_BACK.find((m) => textWidth(m) <= cols) || STAND_BACK[2], flex: true, align: "center" }] });
    } else if (message) {
      row({ cells: [{ text: message, flex: true }] });
    } else {
      const rest = deps.slice(2, 5);
      row({ items: rest.map((d, i) => this._rowLine(d, i + 3, now, timeW)) });
    }
    if (c.show_clock) row({ cells: [{ text: londonClock(now, true), flex: true, align: "center" }] });
    return { lines, rows: y - GAP + PAD };
  }

  _buildModel(attrs, now, cols) {
    const c = this._config;
    const deps = filterDepartures(attrs, c, now);
    const title = attrs.stop_name || "";
    const groups = new Map();
    for (const d of deps) {
      const key = platformKey(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    let keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (!keys.length) keys = [c.platform || ""];
    keys = keys.slice(0, Math.max(1, Number(c.max_boards) || 1));
    const panels = keys.map((key) => {
      const list = groups.get(key) || [];
      const board = this._board(list, attrs, now, cols);
      return {
        key,
        caption: c.show_platform && key ? key : "",
        swatch: list[0]?.color,
        rows: board.rows,
        lines: board.lines,
      };
    });
    return { title, panels };
  }
}
