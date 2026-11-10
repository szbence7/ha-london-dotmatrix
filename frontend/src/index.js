/*!
 * London Dotmatrix: dot-matrix TfL departure boards for Home Assistant
 * https://github.com/szbence7/ha-london-dotmatrix
 * MIT License (c) Szorgalmatos Bence
 * Glyphs: "London Underground" dot-matrix typeface by petykowski, SIL Open Font License 1.1.
 * Unofficial; not affiliated with or endorsed by Transport for London.
 */
import { DotmatrixTubeCard } from "./tube-card.js";
import { DotmatrixBusCard } from "./bus-card.js";
import { DotmatrixRailCard } from "./rail-card.js";
import { DotmatrixCardEditor } from "./editor.js";

const VERSION = "0.1.0";

const CARDS = [
  ["dotmatrix-tube-card", DotmatrixTubeCard, "London Dotmatrix · Tube platform board",
    "Amber dot-matrix Underground platform indicator: next trains, STAND BACK, service messages and the clock."],
  ["dotmatrix-bus-card", DotmatrixBusCard, "London Dotmatrix · Bus stop Countdown",
    "London bus stop Countdown sign: route, destination and minutes, with the stop letter and clock."],
  ["dotmatrix-rail-card", DotmatrixRailCard, "London Dotmatrix · Rail departure board",
    "Departure board for the DLR, Overground, Elizabeth line, trams, river buses and the cable car."],
];

for (const [tag, cls] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
}
if (!customElements.get("dotmatrix-card-editor")) customElements.define("dotmatrix-card-editor", DotmatrixCardEditor);

window.customCards = window.customCards || [];
for (const [type, , name, description] of CARDS) {
  if (!window.customCards.some((c) => c.type === type)) {
    window.customCards.push({ type, name, description, preview: true, documentationURL: "https://github.com/szbence7/ha-london-dotmatrix" });
  }
}

console.info(`%c LONDON DOTMATRIX %c v${VERSION} `, "color:#ffb000;background:#000;font-weight:700", "color:#000;background:#ffb000");
