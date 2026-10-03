// Usage: node snap.cjs <out.png> [--w 1440] [--h 810] [--wait 8000] [--url http://localhost:3000]
//        [--hide-ui] [--crop x,y,w,h] [--eval "<js expression returning JSON>"]
// Prints console errors/warnings and window.__heroStats (dev builds) if present.
const { chromium } = require("playwright");
const a = process.argv.slice(2);
const out = a[0];
const opt = (k, d) => { const i = a.indexOf("--" + k); return i > -1 ? a[i + 1] : d; };
const flag = (k) => a.includes("--" + k);
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: +opt("w", 1440), height: +opt("h", 810) } });
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`[console.${m.type()}]`, m.text().slice(0, 240)); });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.goto(opt("url", "http://localhost:3000"));
  await p.waitForTimeout(+opt("wait", 8000));
  if (flag("hide-ui")) await p.addStyleTag({ content: "header,[data-ui],h1,main > div:not(:first-child){visibility:hidden !important}" });
  const clip = opt("crop", null);
  const shot = { path: out };
  if (clip) { const [x, y, w, h] = clip.split(",").map(Number); shot.clip = { x, y, width: w, height: h }; }
  await p.screenshot(shot);
  const ev = opt("eval", null);
  if (ev) console.log("[eval]", JSON.stringify(await p.evaluate(ev)));
  console.log("[stats]", JSON.stringify(await p.evaluate(() => window.__heroStats ?? null)));
  await b.close();
})();
