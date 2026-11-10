const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": p.endsWith(".js") || p.endsWith(".mjs") ? "text/javascript" : "text/html" });
  fs.createReadStream(p).pipe(res);
}).listen(0, async () => {
  const port = server.address().port;
  const b = await chromium.launch();
  for (const [w, scale, name] of [[620, 2, "desktop"], [360, 2, "mobile"]]) {
    const p = await b.newPage({ viewport: { width: w + 32, height: 1600 }, deviceScaleFactor: scale });
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await p.goto(`http://localhost:${port}/tests/harness.html?w=${w}`);
    await p.waitForFunction("window.ready");
    await p.waitForTimeout(Number(process.argv[2] || 1200));
    await p.screenshot({ path: process.argv[3] ? `${process.argv[3]}-${name}.png` : `/tmp/glow-${name}.png`, fullPage: true });
    console.log(name, errors.length ? errors : "no errors");
    await p.close();
  }
  await b.close(); server.close();
});
