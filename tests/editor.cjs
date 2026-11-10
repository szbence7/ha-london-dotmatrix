const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": p.endsWith("html") ? "text/html" : "text/javascript" });
  fs.createReadStream(p).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 520, height: 700 }, deviceScaleFactor: 2 });
  const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${server.address().port}/tests/harness.html?w=480`);
  await p.waitForFunction("window.ready");
  const out = await p.evaluate(async () => {
    document.getElementById("root").innerHTML = "";
    const calls = [];
    const hass = { states: window.cards[0]._hass.states, callWS: async (msg) => {
      calls.push(msg);
      if (msg.type.endsWith("/search")) return { stops: [
        { id: "940GZZLUOXC", name: "Oxford Circus", letter: "", towards: "", modes: ["tube"], added: true, entity_id: "sensor.oxford_circus",
          lines: [{ id: "bakerloo", name: "Bakerloo", color: "#B36305", text_color: "#fff" }, { id: "central", name: "Central", color: "#E32017", text_color: "#fff" }, { id: "victoria", name: "Victoria", color: "#0098D4", text_color: "#fff" }] },
        { id: "490000173RC", name: "Oxford Circus Station", letter: "RC", towards: "Marble Arch Or Great Portland Street", modes: ["bus"], added: false,
          lines: ["12", "159", "22", "88", "94", "N3"].map((n) => ({ id: n, name: n, color: "#DC241F", text_color: "#fff" })) },
      ] };
      return { entity_id: "sensor.oxford_circus_rc" };
    } };
    const ed = document.createElement("dotmatrix-card-editor");
    ed.setConfig({ type: "custom:dotmatrix-tube-card", entity: "sensor.oxford_circus" });
    ed.hass = hass;
    document.getElementById("root").appendChild(ed);
    let changed = null; ed.addEventListener("config-changed", (e) => changed = e.detail.config);
    await new Promise((r) => setTimeout(r, 300));
    const input = ed.shadowRoot.querySelector("input");
    input.value = "oxford"; input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 600));
    const n = ed.shadowRoot.querySelectorAll(".item").length;
    ed.shadowRoot.querySelectorAll(".item")[1].click();
    await new Promise((r) => setTimeout(r, 200));
    const form = ed.shadowRoot.querySelector("ha-form");
    return { n, changed, calls: calls.map((c) => c.type + (c.modes ? ":" + c.modes : "")), schema: form.schema.map((s) => s.name || s.type) };
  });
  console.log(JSON.stringify(out), errors);
  await p.screenshot({ path: process.argv[2] });
  await b.close(); server.close();
});
