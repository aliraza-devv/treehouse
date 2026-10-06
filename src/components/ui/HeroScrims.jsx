"use client";

import { useEffect, useRef } from "react";
import { LAYERS } from "@/lib/layers";
import { scrollState } from "@/lib/scroll/scrollStore";

const FADE_END = 0.14; // global progress at which the hero's scrims are gone (the climb brings its own)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The two soft deep-forest gradients that keep the hero copy legible over bright mist. They exist for the hero, so
// they leave with it: left on, they sat over the whole climb and dimmed the scene (and, because they paint above any
// copy without its own stacking order, the climb words too). At progress 0 nothing is written, so the hero is
// identical to before.
export default function HeroScrims() {
  const root = useRef(null);

  useEffect(() => {
    let raf = 0;
    let last = 1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clamp01(scrollState.progress / FADE_END);
      const opacity = 1 - t * t * (3 - 2 * t);
      if (Math.abs(opacity - last) < 0.002 && !(opacity === 1 && last !== 1)) return;
      last = opacity;
      if (root.current) root.current.style.opacity = opacity >= 0.999 ? "" : opacity.toFixed(3);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ zIndex: LAYERS.scrim }}>
      <div className="bg-scrim-hero absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-brand-forest/30 to-transparent" />
    </div>
  );
}
