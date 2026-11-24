// Unit tests for the card logic (no browser needed): node --test tests/cards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
const { textMatrix, ROW } = await import("../frontend/src/engine.js");
const { filterDepartures, statusText, londonClock } = await import("../frontend/src/base-card.js");
const { tubeTime } = await import("../frontend/src/tube-card.js");
const { DotmatrixRailCard } = await import("../frontend/src/rail-card.js");
const { busTime } = await import("../frontend/src/bus-card.js");
const { attrs } = await import("./fixtures.mjs");
const { cardEntities } = await import("../frontend/src/editor.js");

test("glyph matrix is 10 dots high and proportional", () => {
  const m = textMatrix("Hi");
  assert.equal(m.rows.length, ROW);
  assert.equal(m.height, 11);
  assert.equal(textMatrix("Hi", "dm").height, 9);
  assert.equal(textMatrix("é").width, textMatrix("e").width); // accents fall back to the base letter
  assert.ok(textMatrix("King’s Cross St. Pancras").width > 0);
});

test("tube and bus time formats", () => {
  assert.equal(tubeTime(25), "Due");
  assert.equal(tubeTime(70), "1 min");
  assert.equal(tubeTime(160), "3 min");
  assert.equal(busTime(40), "due");
  assert.equal(busTime(190), "3min");
});

test("filters by platform direction and line", () => {
  const now = Date.now();
  const a = attrs("tube", now / 1000);
  assert.equal(filterDepartures(a, {}, now).length, 7);
  assert.deepEqual([...new Set(filterDepartures(a, { platform: "Northbound" }, now).map((d) => d.line))], ["victoria"]);
  assert.equal(filterDepartures(a, { lines: ["central"] }, now).length, 4);
  assert.equal(filterDepartures(a, {}, now + 15 * 60 * 1000).length, 0);
});

test("filters by several platforms at once (rail)", () => {
  const now = Date.now();
  const a = attrs("nr", now / 1000); // platforms: 4, 6, "" (cancelled), 1
  assert.equal(filterDepartures(a, {}, now).length, 4);
  assert.equal(filterDepartures(a, { platforms: ["4", "6"] }, now).length, 2); // e.g. Putney platforms 1 and 2 together
  assert.equal(filterDepartures(a, { platform: "4" }, now).length, 1); // legacy single string still works
  assert.equal(filterDepartures(a, { platforms: ["4"], platform: "6" }, now).length, 2); // both combine
  assert.equal(filterDepartures(a, { platforms: [] }, now).length, 4); // empty list: every platform
  assert.equal(filterDepartures(a, { platforms: ["4", "6"] }, now).every((d) => ["4", "6"].includes(d.platform)), true);
});

test("numeric platform filters are exact: '1' does not catch '10'", () => {
  const now = Date.now();
  const a = attrs("nr", now / 1000);
  a.departures.push({ ...a.departures[0], platform: "10", destination: "Peterborough", expected: Math.round(now / 1000) + 1500 });
  assert.deepEqual(filterDepartures(a, { platforms: ["1"] }, now).map((d) => d.destination), ["Hayes"]);
  assert.equal(filterDepartures(a, { platforms: ["1", "10"] }, now).length, 2);
});

test("word-like platform filters still match a direction within the platform name", () => {
  const now = Date.now();
  const a = attrs("tube", now / 1000);
  assert.equal(filterDepartures(a, { platforms: ["Eastbound"] }, now).length, 4);
  assert.equal(filterDepartures(a, { platforms: ["Platform 6"] }, now).length, 3);
});

test("National Rail column header lines up with the departure columns", () => {
  const now = Date.now();
  const a = attrs("nr", now / 1000);
  const card = Object.create(DotmatrixRailCard.prototype);
  card._config = { ...DotmatrixRailCard.defaults, rows: 3, show_ordinals: false, spread: true, show_column_header: true, header_color: "#ffffff" };
  const { lines } = card._nrBoard(a.departures, a, now);
  const header = lines[0].cells;
  assert.deepEqual(header.filter((c) => c.text).map((c) => c.text), ["Time", "Destination", "Platform", "ETA"]);
  assert.ok(header.every((c) => c.color === "#ffffff")); // explicit header colour wins
  // same column layout as the first departure row: same fixed widths in the same order
  const row = lines[1].cells;
  const widths = (cells) => cells.map((c) => (c.flex ? "flex" : c.w ?? 0));
  assert.deepEqual(widths(header), widths(row));
  // no header_color: cells fall back to the board colour (no per-cell colour)
  card._config = { ...DotmatrixRailCard.defaults, rows: 3, show_column_header: true };
  const plain = card._nrBoard(a.departures, a, now).lines[0];
  assert.ok(plain.cells.every((c) => c.color === undefined));
  // header off by default
  card._config = { ...DotmatrixRailCard.defaults, rows: 3 };
  assert.notEqual(card._nrBoard(a.departures, a, now).lines[0].cells[0].text, "Time");
});

test("filters by calling point (rail)", () => {
  const now = Date.now();
  const a = attrs("nr", now / 1000); // the Bedford train calls at Blackfriars, Farringdon, …
  assert.deepEqual(filterDepartures(a, { calling_at: "Farringdon" }, now).map((d) => d.destination), ["Bedford"]);
  assert.deepEqual(filterDepartures(a, { calling_at: "farringdon" }, now).length, 1); // case-insensitive
  assert.deepEqual(filterDepartures(a, { calling_at: "Bedford" }, now).map((d) => d.destination), ["Bedford"]); // destination counts as a calling point
  assert.equal(filterDepartures(a, { calling_at: "Putney" }, now).length, 0); // nobody calls there
  assert.equal(filterDepartures(a, {}, now).length, 4); // empty filter: every train
});

test("status text only for disrupted lines", () => {
  const a = attrs("tube");
  assert.match(statusText(a, ["victoria", "central"]), /Minor delays/);
  assert.equal(statusText(a, ["central"]), "");
});

test("clock is London time", () => {
  assert.equal(londonClock(Date.UTC(2026, 6, 1, 12, 0, 5)), "13:00:05"); // BST
  assert.equal(londonClock(Date.UTC(2026, 11, 1, 12, 0, 5), false), "12:00"); // GMT
});

test("each card only offers its own kind of stop", () => {
  const states = {
    "sensor.oxford_circus": { attributes: attrs("tube") },
    "sensor.oxford_circus_rc": { attributes: attrs("bus") },
    "sensor.stratford": { attributes: attrs("rail") },
    "sensor.other": { attributes: {} },
  };
  const hass = { states };
  assert.deepEqual(cardEntities(hass, ["tube"]), ["sensor.oxford_circus"]);
  assert.deepEqual(cardEntities(hass, ["bus"]), ["sensor.oxford_circus_rc"]);
  assert.deepEqual(cardEntities(hass, ["dlr", "overground", "elizabeth-line"]), ["sensor.stratford"]);
});

test("card picker suggestions only for matching stop sensors", async () => {
  globalThis.window = { customCards: [] };
  globalThis.customElements = { get: () => true, define: () => {} };
  globalThis.console.info = () => {};
  await import("../frontend/src/index.js");
  const hass = { states: {
    "sensor.oxford_circus": { attributes: attrs("tube") },
    "sensor.oxford_circus_rc": { attributes: attrs("bus") },
    "sensor.london_bridge": { attributes: attrs("nr") },
    "light.kitchen": { attributes: {} },
  } };
  const pick = (type, id) => window.customCards.find((c) => c.type === type).getEntitySuggestion(hass, id);
  assert.deepEqual(pick("dotmatrix-tube-card", "sensor.oxford_circus"), { config: { type: "custom:dotmatrix-tube-card", entity: "sensor.oxford_circus" } });
  assert.equal(pick("dotmatrix-tube-card", "sensor.oxford_circus_rc"), null);
  assert.ok(pick("dotmatrix-bus-card", "sensor.oxford_circus_rc"));
  assert.ok(pick("dotmatrix-rail-card", "sensor.london_bridge"));
  assert.equal(pick("dotmatrix-rail-card", "light.kitchen"), null);
});