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
