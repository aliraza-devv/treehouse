"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollTrigger } from "@/lib/gsap";
import { LAYERS } from "@/lib/layers";
import { startScroll, stopScroll } from "@/lib/lenis";
import { loadParts, markPart, markSiteReady, onPart } from "@/lib/loadState";
import { LEAF_PATH, canopyPath } from "@/components/ui/journey/canopy";
import { BULBS, DRAW_SECONDS, GLOW, HOUSE_COVER, LANTERN, LEAVES, LINES, SPEED, WINDOW } from "@/components/ui/loaderArt";
import Wordmark from "@/components/ui/Wordmark";

// THE LOADER. It covers the page from the very first paint (it is in the server HTML), so nothing of the page can flash
// before the stage and the scroll runway are ready. It draws the hero's own treehouse by hand (loaderArt.js), the ladder
// first, then the house, then the string of lights; when the page is really ready (fonts, the scroll runway and the 3D
// scene) the window, the lantern and the lights come on, "Come on up." appears, and the canopy lifts away upward, the way
// it rises over the scene later in the page. The hero's intro starts while the canopy is still clearing.
//
// Why it is built the way it is (it used to feel slow and to stutter):
// * The drawing is plain CSS animation on a fixed clock (see .loader-draw in globals.css), not a script easing toward a
//   target. A clock keeps real time when the page is busy booting (hydration, the 3D scene), so it never crawls; at worst it
//   skips frames. Nothing runs per frame in JavaScript while it plays.
// * The exit is the Web Animations API on transform and opacity, which the browser runs off the main thread, so the lift stays
//   smooth even while the hero and the scene are starting up underneath it.
// * It waits for the drawing (under a second) and for the page, whichever is later, and not a second longer. Hard stop at 6s.
// Reduced motion: the drawing is simply there, the lights come on, and the loader fades.
const HARD_STOP_MS = 6000;
// The loader waits for the 3D scene only until this many ms after the page started loading. The scene (its shaders, its textures) can
// take much longer than that on an ordinary laptop GPU, and the page must not sit behind a loader for it: past this, the loader
// goes once the fonts and the scroll runway are in, the hero's words arrive over the forest colour, and the scene fades in the
// moment it is ready (Scene.jsx). On a quick machine the scene is ready first and nothing is cut.
const SCENE_CAP_MS = 2200;
const REDUCED_DRAW_MS = 500;
const LIGHT_MS = 240; // the window lights, then the canopy goes
const LIFT_MS = 780;
const HERO_AT_MS = 170; // the hero's intro starts this long after the lift begins

// A time on the drawing's clock, as the CSS wants it: scaled by SPEED (see loaderArt.js)
const sec = (value) => `${Math.round(value * SPEED * 1000) / 1000}s`;

const TONES = { main: "stroke-brand-cream/85", soft: "stroke-brand-cream/50", leaf: "stroke-brand-green-light/85" };

// The sheet's lower edge: a row of leaf domes, drawn rising and turned upside down so they hang
const EDGE = canopyPath(31, { width: 1440, height: 150, top: 0.42, bump: 0.5, wave: 0.04, min: 80, max: 190 });

// One drawn line (see loaderArt.js and .loader-draw in globals.css). The strong lines are gone over twice, the second pass
// fainter and a touch off, like a pencil.
function Line({ d, tone, w, at, dur, double = tone === "main" }) {
  return (
    <>
      {double && (
        <path
          d={d}
          pathLength="1"
          transform="translate(1.1 -0.8)"
          className="loader-draw stroke-brand-cream/25"
          strokeWidth={w * 0.6}
          style={{ "--d": sec(at + 0.04), "--t": sec(dur) }}
        />
      )}
      <path d={d} pathLength="1" className={`loader-draw ${TONES[tone]}`} strokeWidth={w} style={{ "--d": sec(at), "--t": sec(dur) }} />
    </>
  );
}

export default function Preloader() {
  const root = useRef(null);
  const sheet = useRef(null);
  const content = useRef(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let leaving = false;
    let finished = false;
    let checkTimer = 0;
    const timers = [];

    // Always start at the top, and hold the page still while the loader is up
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    document.documentElement.dataset.loading = "true";
    stopScroll();

    // ---- the three real parts (the scene reports for itself, from Scene.jsx and CanvasBoundary.jsx)
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => markPart("fonts"));
    timers.push(window.setTimeout(() => markPart("fonts"), 2500));
    const runwayTimer = window.setInterval(() => {
      if (document.querySelector("[data-runway]")) {
        markPart("runway");
        window.clearInterval(runwayTimer);
      }
    }, 60);
    timers.push(window.setTimeout(() => ["fonts", "runway", "scene"].forEach(markPart), HARD_STOP_MS));

    // How long the drawing has been going: the wall clock from when the page first painted (the drawing starts then, so the time
    // the script took to start does not count against it). It used to be read off the CSS animation's own clock, but that clock
    // only advances when the browser produces a frame, and while the 3D scene boots frames are slow, so the reading went stale and
    // held the loader up for seconds after everything was ready.
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const drawStart = paint ? paint.startTime : started;
    const elapsed = () => performance.now() - drawStart;
    const drawMs = reduced ? REDUCED_DRAW_MS : DRAW_SECONDS * 1000;

    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(window.clearTimeout);
      window.clearTimeout(checkTimer);
      window.clearInterval(runwayTimer);
      delete document.documentElement.dataset.loading;
      startScroll();
      setDone(true);
      ScrollTrigger.refresh();
    };

    const leave = () => {
      if (leaving) return;
      leaving = true;
      el.dataset.lit = "true"; // the window, the lantern, the lights and the line of welcome come on (CSS)
      if (reduced) {
        const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 350, easing: "ease-out", fill: "forwards" });
        fade.onfinish = finish;
        timers.push(window.setTimeout(finish, 900));
        markSiteReady();
        return;
      }
      // The whole exit is started now, with its delays inside the animations (not in timers): these run on the compositor, so a busy
      // page (the 3D scene starting up) cannot hold them back the way it holds back a timer. The window lights first, then the content
      // lifts away and the canopy rises, and the hero is told how long to wait so its words arrive as the canopy clears.
      const distance = window.innerHeight + 170;
      content.current?.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-36px)" },
        ],
        { duration: 380, delay: LIGHT_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
      );
      const lift = sheet.current?.animate(
        [{ transform: "translateY(0)" }, { transform: `translateY(${-distance}px)` }],
        { duration: LIFT_MS, delay: LIGHT_MS, easing: "cubic-bezier(0.7, 0, 0.15, 1)", fill: "forwards" },
      );
      if (lift) lift.onfinish = finish;
      markSiteReady(LIGHT_MS + HERO_AT_MS);
      timers.push(window.setTimeout(finish, LIGHT_MS + LIFT_MS + 500)); // a hidden tab never finishes an animation: do not stay up
    };

    // Leave when the drawing is done and the page is ready, whichever is later. Nothing polls: this runs when a part reports
    // and once more when the drawing ends.
    const check = () => {
      window.clearTimeout(checkTimer);
      if (leaving) return;
      const parts = loadParts();
      const wait = drawMs - elapsed();
      // A hidden tab pauses the CSS clock, so the drawing would never finish: at the hard stop, go anyway
      const late = performance.now() - started >= HARD_STOP_MS - 50;
      const sceneOk = parts.scene || performance.now() >= SCENE_CAP_MS;
      if (parts.fonts && parts.runway && sceneOk && (wait <= 0 || late)) leave();
      else if (wait > 0 && !late) checkTimer = window.setTimeout(check, Math.min(wait + 8, 500));
    };
    const unsubscribe = onPart(check);
    timers.push(window.setTimeout(check, Math.max(0, SCENE_CAP_MS - performance.now())));
    check();

    // Leaving the page (or React re-running the effect in development) only stops the clocks and lets go of the page; it does not
    // mark the loader done.
    return () => {
      unsubscribe();
      timers.forEach(window.clearTimeout);
      window.clearTimeout(checkTimer);
      window.clearInterval(runwayTimer);
      delete document.documentElement.dataset.loading;
      startScroll();
    };
  }, []);

  if (done) return null;

  return (
    <div ref={root} data-loader role="status" aria-live="polite" className="fixed inset-0 overflow-hidden" style={{ zIndex: LAYERS.loader }}>
      <span className="sr-only">Loading Treehouse Life</span>

      {/* The sheet: the forest colour, with a canopy of leaf domes hanging from its lower edge. It is the part that lifts. */}
      <div ref={sheet} aria-hidden="true" className="absolute inset-0 bg-brand-forest will-change-transform">
        <svg viewBox="0 0 1440 150" preserveAspectRatio="none" className="absolute top-full left-0 -mt-px h-[150px] w-full -scale-y-100 fill-brand-forest">
          <path d={EDGE} />
        </svg>
      </div>

      <div ref={content} aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-7 px-6">
        <svg viewBox="0 0 360 420" fill="none" strokeLinecap="round" strokeLinejoin="round" className="h-auto w-[min(72vw,19rem)] overflow-visible">
          <defs>
            <radialGradient id="loader-glow">
              <stop offset="0" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0.3 }} />
              <stop offset="1" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>

          {/* the light behind the window: it comes on with the rest, when the page is ready */}
          <circle className="loader-lit" cx={GLOW.cx} cy={GLOW.cy} r={GLOW.r} fill="url(#loader-glow)" />

          {LINES.map((line, i) => {
            if (line.cover === "house") return <path key={i} d={HOUSE_COVER} className="loader-pop fill-brand-forest stroke-none" style={{ "--d": sec(0.62), "--t": sec(0.14) }} />;
            if (line.cover === "window") return <circle key={i} cx={WINDOW.cx} cy={WINDOW.cy} r={WINDOW.r + 1} className="loader-pop fill-brand-forest stroke-none" style={{ "--d": sec(0.82), "--t": sec(0.1) }} />;
            return <Line key={i} {...line} />;
          })}

          {/* the panes that light: the porthole and the lantern */}
          <circle className="loader-lit fill-brand-warm stroke-none" cx={WINDOW.cx} cy={WINDOW.cy} r={WINDOW.r} />
          <rect className="loader-lit fill-brand-warm stroke-none" x={LANTERN.x} y={LANTERN.y} width={LANTERN.w} height={LANTERN.h} />

          {/* the string of lights: they appear last, and while the page is still loading they breathe; when it is ready they come on */}
          {BULBS.map((bulb, i) => (
            <circle key={i} className="loader-bulb stroke-none" cx={bulb.x} cy={bulb.y} r="3" style={{ "--d": sec(bulb.at), "--i": i }} />
          ))}

          {/* the crown */}
          {LEAVES.map((leaf, i) => (
            <g key={i} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotation}) scale(${leaf.scale})`}>
              <path d={LEAF_PATH} pathLength="1" className="loader-draw stroke-brand-green-light/85" strokeWidth="1.4" style={{ "--d": sec(leaf.at), "--t": sec(leaf.dur) }} />
            </g>
          ))}
        </svg>

        <div className="flex flex-col items-center gap-3 text-center">
          <p className="loader-pop font-display text-[1.7rem] leading-none text-brand-cream" style={{ "--d": sec(0.15), "--t": sec(0.4) }}>
            <Wordmark />
          </p>
          <p className="loader-lit h-6 font-hand text-[1.5rem] leading-none text-brand-cream/75">Come on up.</p>
        </div>
      </div>
    </div>
  );
}
