// Unit tests for the card logic (no browser needed): node --test tests/cards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
const { textMatrix, ROW } = await import("../frontend/src/engine.js");
const { filterDepartures, statusText, londonClock } = await import("../frontend/src/base-card.js");
const { tubeTime } = await import("../frontend/src/tube-card.js");
const { busTime } = await import("../frontend/src/bus-card.js");
const { attrs } = await import("./fixtures.mjs");
const { cardEntities } = await import("../frontend/src/editor.js");

test("glyph matrix is 10 dots high and proportional", () => {
  const m = textMatrix("Hi");
  assert.equal(m.rows.length, ROW);
  assert.equal(m.width, 7 + 2 - 1);
  assert.equal(textMatrix("é").width, textMatrix("e").width); // accents fall back to the base letter
  assert.ok(textMatrix("King’s Cross St. Pancras").width > 0);
});

test("tube and bus time formats", () => {
  assert.equal(tubeTime(25), "Due");
  assert.equal(tubeTime(70), "1 min");
  assert.equal(tubeTime(160), "3 mins");
  assert.equal(busTime(40), "due");
  assert.equal(busTime(190), "3 min");
});

test("filters by platform direction and line", () => {
  const now = Date.now();
  const a = attrs("tube", now / 1000);
  assert.equal(filterDepartures(a, {}, now).length, 7);
  assert.deepEqual([...new Set(filterDepartures(a, { platform: "Northbound" }, now).map((d) => d.line))], ["victoria"]);
  assert.equal(filterDepartures(a, { lines: ["central"] }, now).length, 4);
  assert.equal(filterDepartures(a, {}, now + 15 * 60 * 1000).length, 0);
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
