"use client";

import { useEffect, useRef } from "react";
import { afterFontsReady, delayFromLoad, gsap } from "@/lib/gsap";
import { LAYERS } from "@/lib/layers";

const STATS = [
  { value: "250+", label: "Projects" },
  { value: "20+", label: "Years" },
  { value: "5", label: "Continents" },
];

// Seconds after page load at which each element lands, as specified in the brief.
const DELAYS = { heading: 0.8, sub: 1.1, stats: 1.4 };

// Lower-left editorial block: heading, subline, stats. Nothing else lives here.
export default function HeroContent() {
  const root = useRef(null);

  useEffect(() => {
    // Reduced motion: CSS already shows the final state, so there is nothing to animate.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx;
    const cancel = afterFontsReady(() => {
      ctx = gsap.context(() => {
        // Reading order: heading, then subline, then stats. Transform and opacity only.
        for (const [name, target] of Object.entries(DELAYS)) {
          gsap.fromTo(
            `[data-intro="${name}"]`,
            { autoAlpha: 0, y: 20 },
            { autoAlpha: 1, y: 0, duration: 1, ease: "expoOut", delay: delayFromLoad(target, DELAYS.heading) },
          );
        }
      }, root);
    });

    return () => {
      cancel();
      ctx?.revert();
    };
  }, []);

  return (
    <div
      ref={root}
      className="absolute inset-x-0 bottom-0 px-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:px-8 lg:px-16"
      style={{ zIndex: LAYERS.content }}
    >
      <h1
        data-intro="heading"
        className="text-shadow-hero max-w-[550px] font-display text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[1.15] text-balance text-brand-cream"
      >
        Some memories are built, not bought.
      </h1>

      <p
        data-intro="sub"
        className="mt-4 max-w-[34rem] text-[15px] font-normal text-pretty text-brand-cream/70"
      >
        Award-winning treehouse, rope bridge &amp; treetop walkway builders.
      </p>

      <ul
        data-intro="stats"
        className="mt-8 flex w-fit divide-x divide-brand-cream/25 text-[13px] tabular-nums text-brand-cream/50"
      >
        {STATS.map((stat) => (
          <li key={stat.label} className="px-4 first:pl-0 last:pr-0">
            {stat.value} {stat.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
