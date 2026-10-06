"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { CTA_LABEL, ENQUIRY_HREF } from "@/lib/site";
import { Grain } from "./backdrops";

// THE INVITATION. The loader ended on "Come on up." with a window lighting, and so does the page. There is no photograph:
// the section is the page's green, and the only picture is the thing the whole page is about, a ladder, going up to a lit
// window. It stands at the right, its foot on the ground line of the footer below, and as you arrive the rungs warm one
// after another from the bottom to the top, ending in the window: the invitation is drawn as the climb. The heading
// rises out of its mask, the underline draws, and the button leans toward the pointer (hierarchy: it is the one thing to
// do here). Reduced motion: the ladder is simply lit, and nothing moves.
//
// The ladder is a drawing in a 300 x 1000 box that is stretched to the section's height (non-scaling strokes keep the
// lines thin), its rails bowing a little and narrowing toward the top, so it reads as a long way up.
const RUNG_COUNT = 15;
const RAIL_L = { from: [40, 1000], control: [64, 520], to: [108, 80] };
const RAIL_R = { from: [260, 1000], control: [234, 520], to: [192, 80] };

// Where a rail is at a given height: solve the quadratic for y, then read x (y(t) = 1000 - 960 t + 40 t^2 for these rails)
const railX = (rail, y) => {
  const t = (960 - Math.sqrt(960 * 960 - 160 * (1000 - y))) / 80;
  const u = 1 - t;
  return u * u * rail.from[0] + 2 * u * t * rail.control[0] + t * t * rail.to[0];
};
const f = (v) => Math.round(v * 10) / 10;
const RUNGS = Array.from({ length: RUNG_COUNT }, (_, i) => {
  const y = 950 - (i / (RUNG_COUNT - 1)) * 800 + (i % 3 === 1 ? 2.5 : i % 3 === 2 ? -2 : 0); // not quite level, not quite even
  return `M${f(railX(RAIL_L, y))} ${f(y)} L${f(railX(RAIL_R, y))} ${f(y + (i % 2 ? 1.6 : -1.2))}`;
});
const RAILS = [
  `M${RAIL_L.from[0]} ${RAIL_L.from[1]} Q${RAIL_L.control[0]} ${RAIL_L.control[1]} ${RAIL_L.to[0]} ${RAIL_L.to[1]}`,
  `M${RAIL_R.from[0]} ${RAIL_R.from[1]} Q${RAIL_R.control[0]} ${RAIL_R.control[1]} ${RAIL_R.to[0]} ${RAIL_R.to[1]}`,
];

export default function FinalCta() {
  const root = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;

      // the climb: each rung warms in turn, bottom to top, and the window is last
      gsap.fromTo(
        el.querySelectorAll("[data-warm]"),
        { opacity: 0 },
        {
          opacity: 1,
          ease: "none",
          stagger: { each: 0.06 },
          scrollTrigger: { trigger: el, start: "top 78%", end: "top 8%", scrub: true },
        },
      );

      const arrive = { trigger: el, start: "top 45%", toggleActions: "play none none reverse" };
      gsap
        .timeline({ scrollTrigger: arrive })
        .from(el.querySelectorAll("[data-line]"), { yPercent: 110, duration: 1.3, ease: "expoOut" }, 0)
        .fromTo(el.querySelector("[data-draw]"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" }, 0.8)
        .from(el.querySelectorAll("[data-fade]"), { autoAlpha: 0, y: 24, duration: 1, ease: "expoOut", stagger: 0.12 }, 0.5);
    });

    // The magnet needs a real pointer: skip it on touch screens.
    mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
      const el = button.current;
      const moveX = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
      const moveY = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
      const onMove = (event) => {
        const rect = el.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        if (Math.hypot(dx, dy) < 140) {
          moveX(dx * 0.3);
          moveY(dy * 0.3);
        } else {
          moveX(0);
          moveY(0);
        }
      };
      const onLeave = () => {
        moveX(0);
        moveY(0);
      };
      const zone = root.current;
      zone.addEventListener("pointermove", onMove);
      zone.addEventListener("pointerleave", onLeave);
      return () => {
        zone.removeEventListener("pointermove", onMove);
        zone.removeEventListener("pointerleave", onLeave);
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="contact" aria-labelledby="cta-title" className="relative isolate flex min-h-[94dvh] items-end overflow-hidden bg-brand-forest">
      <Grain />

      {/* The ladder: the cream lines are always there, and a warm line over each rung (and the window) is what lights as you arrive */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 mx-auto max-w-[1400px] max-md:[mask-image:linear-gradient(to_bottom,black_50%,transparent_66%)]">
        <svg
          viewBox="0 0 300 1000"
          preserveAspectRatio="none"
          fill="none"
          strokeLinecap="round"
          className="absolute inset-y-0 right-3 h-full w-[min(34vw,14rem)] overflow-visible md:right-8 lg:right-16"
        >
          {RAILS.map((d) => (
            <path key={d} d={d} className="stroke-brand-cream/[0.16]" strokeWidth="3.4" vectorEffect="non-scaling-stroke" />
          ))}
          {RUNGS.map((d) => (
            <path key={d} d={d} className="stroke-brand-cream/[0.16]" strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
          ))}
          {RUNGS.map((d) => (
            <path key={`warm-${d}`} data-warm d={d} className="stroke-brand-warm" strokeWidth="2.8" vectorEffect="non-scaling-stroke" style={{ opacity: 1 }} />
          ))}
          {/* the window at the top: a frame in cream, and the pane that lights */}
          <rect x="112" y="10" width="76" height="62" className="stroke-brand-cream/[0.16]" strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
          <path d="M150 10 V72 M112 41 H188" className="stroke-brand-cream/[0.16]" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <rect data-warm x="113" y="11" width="74" height="60" className="fill-brand-warm/80" stroke="none" style={{ opacity: 1 }} />
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-[1400px] px-6 pt-[34dvh] pb-[9dvh] md:px-8 lg:px-16">
        <h2 id="cta-title" className="text-shadow-big font-display text-[clamp(3.8rem,10.5vw,11rem)] leading-[0.94] text-brand-cream">
          <span className="block overflow-hidden px-[0.25em] pb-[0.3em] -mx-[0.25em] -mb-[0.2em]">
            <span data-line className="relative inline-block">
              Come on <span className="relative inline-block text-brand-warm">up.</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 100 14"
                preserveAspectRatio="none"
                className="pointer-events-none absolute -bottom-[0.02em] left-0 h-[0.14em] w-full overflow-visible text-brand-warm"
              >
                <path
                  data-draw
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
        </h2>

        <p data-fade className="text-shadow-logo mt-9 max-w-[29rem] text-[clamp(1.1rem,1.5vw,1.35rem)] leading-snug font-medium text-pretty text-brand-cream">
          Tell us about your garden and the tree you have in mind. We will walk it with you first.
        </p>

        {/* The fade is on this wrapper: the button itself is moved by the magnet (x, y) */}
        <div data-fade className="mt-9">
          <a
            ref={button}
            href={ENQUIRY_HREF}
            className="group focus-ring inline-flex h-14 items-center gap-3 rounded-full bg-brand-warm px-9 text-[15px] font-medium whitespace-nowrap text-brand-forest transition-[background-color,scale] duration-500 ease-expo-out hover:bg-brand-cream active:scale-[0.98]"
          >
            {CTA_LABEL}
            <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:translate-x-1">
              →
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
