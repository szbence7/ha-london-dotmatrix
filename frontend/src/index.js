/*!
 * Glowboard London: dot-matrix TfL departure boards for Home Assistant
 * https://github.com/szbence7/ha-glowboard-london
 * MIT License (c) Szorgalmatos Bence
 * Glyphs: "London Underground" dot-matrix typeface by petykowski, SIL Open Font License 1.1.
 * Unofficial; not affiliated with or endorsed by Transport for London.
 */
import { GlowboardTubeCard } from "./tube-card.js";
import { GlowboardBusCard } from "./bus-card.js";
import { GlowboardRailCard } from "./rail-card.js";
import { GlowboardCardEditor } from "./editor.js";

const VERSION = "0.1.0";

const CARDS = [
  ["glowboard-tube-card", GlowboardTubeCard, "Glowboard · Tube platform board",
    "Amber dot-matrix Underground platform indicator: next trains, STAND BACK, service messages and the clock."],
  ["glowboard-bus-card", GlowboardBusCard, "Glowboard · Bus stop Countdown",
    "London bus stop Countdown sign: route, destination and minutes, with the stop letter and clock."],
  ["glowboard-rail-card", GlowboardRailCard, "Glowboard · Rail departure board",
    "Departure board for the DLR, Overground, Elizabeth line, trams, river buses and the cable car."],
];

for (const [tag, cls] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
}
if (!customElements.get("glowboard-card-editor")) customElements.define("glowboard-card-editor", GlowboardCardEditor);

window.customCards = window.customCards || [];
for (const [type, , name, description] of CARDS) {
  if (!window.customCards.some((c) => c.type === type)) {
    window.customCards.push({ type, name, description, preview: true, documentationURL: "https://github.com/szbence7/ha-glowboard-london" });
  }
}

console.info(`%c GLOWBOARD LONDON %c v${VERSION} `, "color:#ffb000;background:#000;font-weight:700", "color:#000;background:#ffb000");
