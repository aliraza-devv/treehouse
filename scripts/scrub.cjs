// Usage: node scrub.cjs <outPrefix> --p 0,0.25,0.5,0.75,1 [--w 1440] [--h 810] [--wait 60000] [--url http://localhost:3000]
//        [--section approach] [--eval "<js>"] [--ui]  (--ui keeps the HTML overlay, default hides nothing)
// Needs the DEV server (npm run dev): it uses window.__scrub(p) (global progress 0..1, no damping) that the
// scroll driver only exposes in development. With --section X, p values are SECTION-LOCAL (0..1 inside section X)
// and converted through window.__sectionToGlobal(id, local) if present.
// Software WebGL is slow: first frame can take 40-90 s, each screenshot 20-150 s. Be patient.
const { chromium } = require("playwright");
const a = process.argv.slice(2);
const prefix = a[0];
const opt = (k, d) => { const i = a.indexOf("--" + k); return i > -1 ? a[i + 1] : d; };
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: +opt("w", 1440), height: +opt("h", 810) } });
  p.setDefaultTimeout(300000);
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`[console.${m.type()}]`, m.text().slice(0, 240)); });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.goto(opt("url", "http://localhost:3000"), { timeout: 300000 });
  await p.waitForFunction(() => typeof window.__scrub === "function", null, { timeout: 300000 });
  await p.waitForTimeout(+opt("wait", 60000));
  const section = opt("section", null);
  for (const v of opt("p", "0,0.25,0.5,0.75,1").split(",").map(Number)) {
    const g = await p.evaluate(([v, section]) => {
      const gp = section && window.__sectionToGlobal ? window.__sectionToGlobal(section, v) : v;
      window.__scrub(gp);
      return gp;
    }, [v, section]);
    await p.waitForTimeout(+opt("settle", 8000));
    const out = `${prefix}-p${String(Math.round(v * 100)).padStart(3, "0")}.png`;
    await p.screenshot({ path: out, timeout: 300000 });
    const pose = await p.evaluate(() => (window.__cam ? window.__cam() : null));
    const stats = await p.evaluate(() => window.__heroStats ?? null);
    console.log("[shot]", out, "global", g, "pose", JSON.stringify(pose), "tris", stats && (stats.visibleTriangles ?? stats.triangles));
  }
  const ev = opt("eval", null);
  if (ev) console.log("[eval]", JSON.stringify(await p.evaluate(ev)));
  await b.close();
})();
