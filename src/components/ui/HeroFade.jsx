"use client";

import { useEffect, useRef } from "react";
import useReducedMotion from "@/hooks/useReducedMotion";
import { LAYERS } from "@/lib/layers";
import { scrollState } from "@/lib/scroll/scrollStore";

// ---- Tuning ----------------------------------------------------------------------------------
const FADE_END = 0.1; // global progress at which the hero copy is fully gone
const CUE_FADE_END = 0.04; // the "Scroll to explore" cue goes sooner: it has done its job once scrolling starts
const DRIFT_PX = 48; // upward drift of the hero copy across the fade

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);

// Wraps the hero copy block and the scroll cue and fades them out as the page scrolls.
//
// Identity at progress 0: every style written here is cleared (opacity, transform, filter,
// visibility all back to the stylesheet defaults), so the hero is pixel identical until the first scroll.
//
// Layout: the wrapper is a plain relative block that sits where HeroContent already sat (the last
// in-flow child of the justify-end <main>), so its bottom edge is the main's bottom edge and the
// cue's `bottom-6` lands exactly where it did before. It carries the content z-index so the
// stacking order against the scrims is unchanged when opacity or transform create a stacking context.
//
// It animates ONLY this wrapper (opacity and transform), never the children, so it cannot fight the
// GSAP intro in HeroContent, which animates the [data-intro] descendants.
//
// The cue has its own CSS keyframe that fills opacity forwards (an animation always beats inline
// style), so its extra early fade is done with `filter: opacity()`, which multiplies with it.
export default function HeroFade({ children }) {
  const root = useRef(null);
  const reduced = useReducedMotion();
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cue = el.querySelector(".scroll-cue");
    let raf = 0;
    let lastP = -1;
    let lastReduced = false;
    let hidden = false;

    const setHidden = (h) => {
      if (h === hidden) return;
      hidden = h;
      if (h) {
        el.style.visibility = "hidden";
        el.setAttribute("aria-hidden", "true");
        el.inert = true; // not focusable and not clickable even if a child overrides visibility
      } else {
        el.style.visibility = "";
        el.removeAttribute("aria-hidden");
        el.inert = false;
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const p = scrollState.progress;
      const noMotion = reducedRef.current;
      if (p === lastP && noMotion === lastReduced) return;
      lastP = p;
      lastReduced = noMotion;

      if (p <= 0) {
        // Identity: clear everything so the hero is exactly the un-wrapped hero
        el.style.opacity = "";
        el.style.transform = "";
        if (cue) cue.style.filter = "";
        setHidden(false);
        return;
      }

      const t = clamp01(p / FADE_END);
      const e = easeOutCubic(t); // fast at first, settling: the copy leaves promptly, then eases away
      el.style.opacity = (1 - (noMotion ? t : e)).toFixed(3);
      el.style.transform = noMotion ? "" : `translate3d(0, ${(-DRIFT_PX * e).toFixed(2)}px, 0)`;
      if (cue) {
        const c = clamp01(p / CUE_FADE_END);
        cue.style.filter = `opacity(${(1 - (noMotion ? c : easeOutCubic(c))).toFixed(3)})`;
      }
      setHidden(t >= 1);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      el.style.opacity = "";
      el.style.transform = "";
      if (cue) cue.style.filter = "";
      setHidden(false);
    };
  }, []);

  return (
    <div ref={root} className="relative" style={{ zIndex: LAYERS.content }}>
      {children}
    </div>
  );
}
