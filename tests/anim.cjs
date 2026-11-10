const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2];
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": p.endsWith("html") ? "text/html" : "text/javascript" });
  fs.createReadStream(p).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 560, height: 900 } });
  await p.addInitScript(() => {
    window.__draws = 0; const o = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { window.__draws++; return o.apply(this, a); };
    window.__timers = 0; const st = window.setTimeout; window.setTimeout = function (...a) { window.__timers++; return st.apply(this, a); };
  });
  await p.goto(`http://localhost:${server.address().port}/tests/harness.html?w=520`);
  await p.waitForFunction("window.ready");
  // tube card only, no status message -> carousel row
  await p.evaluate(() => { const c = window.cards[0]; c.setConfig({ type: "custom:dotmatrix-tube-card", entity: "sensor.oxford_circus", show_status: false, stand_back: false, platform: "Eastbound" }); c.hass = c._hass; window.cards.slice(1).forEach(x => x.remove()); });
  await p.waitForTimeout(1500);
  const d0 = await p.evaluate("[window.__draws, window.__timers]");
  await p.waitForTimeout(5000);
  const d1 = await p.evaluate("[window.__draws, window.__timers]");
  console.log("drawImage/s", ((d1[0] - d0[0]) / 5).toFixed(1), "timers/s", ((d1[1] - d0[1]) / 5).toFixed(1));
  // capture the swipe
  const el = await p.$("dotmatrix-tube-card");
  for (let i = 0; i < 6; i++) { await el.screenshot({ path: `${OUT}-anim${i}.png` }); await p.waitForTimeout(150); }
  // hidden: no work
  await p.evaluate(() => window.cards[0].style.display = "none");
  await p.waitForTimeout(500);
  const h0 = await p.evaluate("window.__timers"); await p.waitForTimeout(3000);
  console.log("timers while hidden", (await p.evaluate("window.__timers")) - h0);
  await b.close(); server.close();
});
