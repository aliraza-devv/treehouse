"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { LEAF_PATH, canopyPath } from "./canopy";

// THE TRANSITION from the climb to Section 3: the camera does not cut, it goes up into the canopy.
//
// Three layers of rounded leaf-clump domes rise over the fixed 3D stage, far to near. Each layer is ONE path with a
// vertical gradient fill whose OPACITY climbs from nothing at the dome tops to full lower down (FADE below). That
// is what makes it seamless: there is no hard coloured edge anywhere, the tips of the domes dissolve into the mist of
// the scene, while the lower body of the nearest layer is exactly the page's forest colour, so nothing is visible
// where the section begins. The far layers are pale and slightly blurred (atmosphere) and show through the
// dissolving tips of the near one. A soft haze hangs above the canopy.
//
// While the curtain scrolls through, each layer lags the page by a different amount (`lag`, a fraction of the scroll
// distance): the far layer lags most, the near layer not at all, so the far canopy sinks behind the near one as it
// rises (parallax). `lift` is how far a layer's top edge starts above the near layer's, as a fraction of the curtain
// height. The stage behind pushes in (scale 1 to 1.12) and fades to forest (data-stage, data-stage-dim from the page).
// Drifting leaves and a few fireflies sit in front. Reduced motion: no timeline, the section just scrolls over the
// stage.
//
// Gradient stops are [offset in the 420 high box, colour, opacity]. The domes' tips are at about 0.07 to 0.25 of the
// height and the base line at about 0.4, so the fade runs from the tips down to the base line.
const FADE = {
  far: [
    [0.05, "var(--color-brand-green-light)", 0],
    [0.2, "var(--color-brand-green-light)", 0.24],
    [0.42, "var(--color-brand-green)", 0.34],
  ],
  mid: [
    [0.05, "var(--color-brand-green)", 0],
    [0.2, "var(--color-brand-green)", 0.42],
    [0.42, "var(--color-brand-moss)", 0.85],
  ],
  near: [
    [0.05, "var(--color-brand-forest)", 0],
    [0.22, "var(--color-brand-forest)", 0.3],
    [0.34, "var(--color-brand-forest)", 0.78],
    [0.44, "var(--color-brand-forest)", 1],
  ],
};

const CANOPY = [
  { id: "far", lift: 0.3, lag: 0.55, blur: "blur-[3px]", d: canopyPath(21, { top: 0.4, bump: 0.22, wave: 0.05 }) },
  { id: "mid", lift: 0.15, lag: 0.3, blur: "blur-[1px]", d: canopyPath(22, { top: 0.4, bump: 0.24, wave: 0.05 }) },
  { id: "near", lift: 0, lag: 0, blur: "blur-[0.8px]", extend: true, d: canopyPath(23, { top: 0.4, bump: 0.26, wave: 0.04 }) },
];

// Fixed positions (not random at render) so the server and client markup match.
const LEAVES = [
  { x: 6, y: 20, speed: 0.5, scale: 1.1, rot: -20 },
  { x: 17, y: -6, speed: 0.8, scale: 0.8, rot: 35 },
  { x: 29, y: 38, speed: 0.35, scale: 1.3, rot: 10 },
  { x: 41, y: 4, speed: 0.65, scale: 0.9, rot: -50 },
  { x: 53, y: 26, speed: 0.9, scale: 1.2, rot: 25 },
  { x: 64, y: -10, speed: 0.45, scale: 1, rot: -10 },
  { x: 74, y: 34, speed: 0.7, scale: 0.85, rot: 60 },
  { x: 86, y: 8, speed: 0.55, scale: 1.15, rot: -35 },
  { x: 94, y: 30, speed: 0.85, scale: 0.95, rot: 15 },
];

const FIREFLIES = [
  { x: 12, y: 46, delay: 0 },
  { x: 27, y: 18, delay: 1.1 },
  { x: 38, y: 58, delay: 2.2 },
  { x: 55, y: 12, delay: 0.6 },
  { x: 68, y: 52, delay: 1.7 },
  { x: 81, y: 22, delay: 2.8 },
  { x: 91, y: 60, delay: 0.3 },
];

export default function CanopyCurtain() {
  const root = useRef(null);

  useEffect(() => {
    const el = root.current;
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const stage = document.querySelector("[data-stage]");
      const dim = document.querySelector("[data-stage-dim]");
      // Scroll distance of the whole transition: from the curtain's top edge entering at the bottom of the
      // viewport until the near layer's lowest cusp (about 0.45 of the curtain) has left the top.
      const distance = () => window.innerHeight + 0.55 * el.offsetHeight;

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: el,
          start: "top bottom",
          end: () => `+=${distance()}`,
          scrub: true, // Lenis already smooths the scroll; a scrub lag on top of it would only add latency
          invalidateOnRefresh: true,
        },
      });

      el.querySelectorAll("[data-lag]").forEach((layer) => {
        const lag = parseFloat(layer.dataset.lag);
        if (lag > 0) tl.fromTo(layer, { y: 0 }, { y: () => lag * distance() }, 0);
      });
      el.querySelectorAll("[data-leaf]").forEach((leaf) => {
        const speed = parseFloat(leaf.dataset.leaf);
        tl.fromTo(leaf, { y: 0 }, { y: () => -speed * distance() * 0.5 }, 0);
      });
      if (stage) tl.fromTo(stage, { scale: 1, yPercent: 0, transformOrigin: "50% 65%" }, { scale: 1.12, yPercent: -5 }, 0);
      if (dim) tl.fromTo(dim, { opacity: 0 }, { opacity: 0.94, ease: "sine.in" }, 0);
    });

    return () => mm.revert(); // also puts the stage and dim layer back to their inline styles
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="pointer-events-none relative h-[46vh] min-h-[320px]">
      {/* The haze: darker at the bottom, clear at the top, hanging above the canopy */}
      <div
        data-lag="0.45"
        className="absolute inset-x-0 -top-[80%] h-[120%] bg-gradient-to-t from-brand-forest/55 via-brand-forest/16 via-55% to-transparent"
      />

      {CANOPY.map((layer) => (
        <svg
          key={layer.id}
          data-lag={layer.lag}
          viewBox="0 0 1440 420"
          preserveAspectRatio="none"
          // The near layer reaches 2px into the section: the curtain is 46vh (often a fractional pixel height), and
          // without the overlap a hairline of the bright stage shows between the two.
          className={`absolute inset-x-0 w-full ${layer.extend ? "h-[calc(100%+2px)]" : "h-full"} ${layer.blur}`}
          style={{ top: `${-layer.lift * 100}%` }}
        >
          <defs>
            <linearGradient id={`canopy-${layer.id}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="420">
              {FADE[layer.id].map(([offset, color, opacity]) => (
                <stop key={offset} offset={offset} style={{ stopColor: color, stopOpacity: opacity }} />
              ))}
            </linearGradient>
          </defs>
          <path d={layer.d} fill={`url(#canopy-${layer.id})`} />
        </svg>
      ))}

      {LEAVES.map((leaf, i) => (
        <span key={i} data-leaf={leaf.speed} className="absolute" style={{ left: `${leaf.x}%`, top: `${leaf.y}%` }}>
          <svg
            viewBox="0 0 26 12"
            className="h-3 w-6 fill-brand-green-light/80 motion-safe:animate-[sway_7s_ease-in-out_infinite]"
            style={{ scale: leaf.scale, rotate: `${leaf.rot}deg`, animationDelay: `${(i % 4) * -1.3}s` }}
          >
            <path d={LEAF_PATH} />
          </svg>
        </span>
      ))}

      {FIREFLIES.map((fly, i) => (
        <span
          key={i}
          className="absolute size-1.5 rounded-full bg-brand-warm opacity-0 shadow-[0_0_10px_2px_color-mix(in_srgb,var(--color-brand-warm)_55%,transparent)] motion-safe:animate-[twinkle_3.4s_ease-in-out_infinite]"
          style={{ left: `${fly.x}%`, top: `${fly.y}%`, animationDelay: `${fly.delay}s` }}
        />
      ))}
    </div>
  );
}
