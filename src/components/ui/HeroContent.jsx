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

// One mask per line: the line rises out of it (overflow hidden), so the heading is revealed like type being
// set, one line at a time. The padding keeps descenders and the underline inside the mask; the negative margin
// gives that padding back, so the lines sit at the line height.
const MASK = "block overflow-hidden pb-[0.12em] -mb-[0.12em]";

// Lower-left editorial block: the heading, big enough to be the first thing seen, then the subline and the numbers.
// Type: Fraunces (font-display, heavy) for the heading and the numbers, Figtree for the rest.
// "built," is the one warm word, and "not bought." gets a hand-drawn underline that draws itself (the same
// language as the margin marks in Section 3). Nothing else lives here.
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
            { autoAlpha: 0, y: name === "heading" ? 0 : 20 },
            { autoAlpha: 1, y: 0, duration: 1, ease: "expoOut", delay: delayFromLoad(target, DELAYS.heading) },
          );
        }
        // The heading lines rise out of their masks, then the underline is drawn.
        const start = delayFromLoad(DELAYS.heading, DELAYS.heading);
        gsap.from("[data-hero-line]", { yPercent: 112, duration: 1.4, ease: "expoOut", stagger: 0.13, delay: start });
        gsap.fromTo("[data-hero-draw]", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut", delay: start + 1.1 });
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
      className="pointer-events-none relative px-6 pt-24 pb-14 md:px-8 lg:px-16 [@media(max-height:480px)]:pb-8"
      style={{ zIndex: LAYERS.content }}
    >
      <h1
        data-intro="heading"
        className="text-shadow-big pointer-events-auto font-display text-[clamp(3.3rem,7.4vw,9rem)] leading-[0.94] tracking-normal text-brand-cream"
      >
        <span className={MASK}>
          <span data-hero-line className="block">
            Some memories
          </span>
        </span>
        <span className={MASK}>
          <span data-hero-line className="block">
            are <span className="text-brand-warm">built,</span>
          </span>
        </span>
        <span className="block overflow-hidden pb-[0.3em] -mb-[0.2em]">
          <span data-hero-line className="relative inline-block">
            not bought.
            <svg
              aria-hidden="true"
              viewBox="0 0 100 14"
              preserveAspectRatio="none"
              className="pointer-events-none absolute -bottom-[0.04em] left-0 h-[0.16em] w-full overflow-visible text-brand-warm"
            >
              <path
                data-hero-draw
                pathLength="1"
                strokeDasharray="1"
                d="M2 9 C 18 3, 34 13, 52 7 S 84 4, 98 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </span>
      </h1>

      <p
        data-intro="sub"
        className="text-shadow-logo pointer-events-auto mt-8 max-w-[31rem] text-[clamp(1.1rem,1.55vw,1.4rem)] font-medium leading-snug text-pretty text-brand-cream/90"
      >
        Award-winning treehouse, rope bridge &amp; treetop walkway builders.
      </p>

      <ul
        role="list"
        data-intro="stats"
        className="text-shadow-logo pointer-events-auto mt-9 flex w-fit divide-x divide-brand-cream/25"
      >
        {STATS.map((stat) => (
          <li key={stat.label} className="flex flex-col gap-1.5 px-6 first:pl-0 last:pr-0 max-[359px]:px-3.5">
            <span className="font-display text-[clamp(1.9rem,2.8vw,2.8rem)] leading-none text-brand-cream lining-nums">{stat.value}</span>
            <span className="text-[13px] tracking-wide text-brand-cream/75">{stat.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
