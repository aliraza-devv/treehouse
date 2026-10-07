"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { CTA_LABEL, ENQUIRY_HREF } from "@/lib/site";
import { Grain } from "./backdrops";

// THE INVITATION. The loader ended on "Come on up." with a window lighting, and so does the page. There is no photograph: the
// section is the page's green, and the only picture is the thing the whole page is about, a ladder going up to a lit window, now
// drawn at the scale of a ladder (it was a tower the full height of the section). It stands at the right with its foot on the ground
// line of the footer below. A string of lights hangs from the top left of the section, sags across what used to be empty, and ends at
// the window's eave, so the eye is led from the corner to the window to the words. As you arrive the rungs warm one after another
// from the bottom to the top, then the window lights, and then the bulbs come on from the window back along the string: the
// invitation is drawn as the climb, and the light it ends in is what the string carries out into the page. The heading rises out of
// its mask, the underline draws, and the button leans toward the pointer (hierarchy: it is the one thing to do here). Reduced
// motion: everything is simply lit, and nothing moves.
//
// The scene is one drawing in a 600 x 1000 box that is scaled evenly (nothing is stretched) to the height of the section and held
// to its bottom right corner. The string's far end is a long way to the left of the box and the drawing is allowed to overflow, so
// the string comes in from the top edge or the top left corner at any width of screen.
const RUNG_COUNT = 11;
const RAIL_L = { from: [440, 1000], control: [452, 680], to: [486, 400] };
const RAIL_R = { from: [590, 1000], control: [578, 680], to: [544, 400] };

// Where a rail is at a given height: solve the quadratic for y, then read x. For these rails y(t) = 1000 - 640 t + 40 t^2.
const railX = (rail, y) => {
  const t = (640 - Math.sqrt(640 * 640 - 160 * (1000 - y))) / 80;
  const u = 1 - t;
  return u * u * rail.from[0] + 2 * u * t * rail.control[0] + t * t * rail.to[0];
};
const f1 = (v) => Math.round(v * 10) / 10;
const RUNGS = Array.from({ length: RUNG_COUNT }, (_, i) => {
  const y = 952 - (i / (RUNG_COUNT - 1)) * 520 + (i % 3 === 1 ? 2.5 : i % 3 === 2 ? -2 : 0); // not quite level, not quite even
  return `M${f1(railX(RAIL_L, y))} ${f1(y)} L${f1(railX(RAIL_R, y))} ${f1(y + (i % 2 ? 1.6 : -1.2))}`;
});
const RAILS = [
  `M${RAIL_L.from[0]} ${RAIL_L.from[1]} Q${RAIL_L.control[0]} ${RAIL_L.control[1]} ${RAIL_L.to[0]} ${RAIL_L.to[1]}`,
  `M${RAIL_R.from[0]} ${RAIL_R.from[1]} Q${RAIL_R.control[0]} ${RAIL_R.control[1]} ${RAIL_R.to[0]} ${RAIL_R.to[1]}`,
];

// The window, at the top of the ladder: centre (512, 342)
const WINDOW = { x: 462, y: 300, w: 100, h: 84 };

// The string of lights: one curve from far up and to the left (outside the box) down to the window's eave. It sags a little below
// the straight line between its ends, as a hung string does. Nine bulbs sit on its last stretch (the part that is on screen).
const WIRE = { from: [-1800, -300], control: [-500, 200], to: [462, 300] };
const WIRE_D = `M${WIRE.from[0]} ${WIRE.from[1]} Q${WIRE.control[0]} ${WIRE.control[1]} ${WIRE.to[0]} ${WIRE.to[1]}`;
const BULBS = Array.from({ length: 9 }, (_, i) => {
  const t = 0.42 + (i / 8) * 0.55;
  const u = 1 - t;
  return {
    x: f1(u * u * WIRE.from[0] + 2 * u * t * WIRE.control[0] + t * t * WIRE.to[0]),
    y: f1(u * u * WIRE.from[1] + 2 * u * t * WIRE.control[1] + t * t * WIRE.to[1]),
  };
});

export default function FinalCta() {
  const root = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;

      // the climb, scrubbed by the scroll: each rung warms in turn, bottom to top; then the window lights (and the glow it throws);
      // then the bulbs come on from the window back along the string
      gsap
        .timeline({ scrollTrigger: { trigger: el, start: "top 78%", end: "top 8%", scrub: true } })
        .fromTo(el.querySelectorAll("[data-rung]"), { opacity: 0 }, { opacity: 1, ease: "none", stagger: { each: 0.06 } })
        .fromTo(el.querySelectorAll("[data-window]"), { opacity: 0 }, { opacity: 1, ease: "none", duration: 0.2 })
        .fromTo(el.querySelectorAll("[data-glow]"), { opacity: 0 }, { opacity: 1, ease: "none", duration: 0.4 }, "<")
        .fromTo(el.querySelectorAll("[data-bulb]"), { opacity: 0 }, { opacity: 1, ease: "none", stagger: { each: 0.07, from: "end" } }, "-=0.1");

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
    <section ref={root} id="contact" aria-labelledby="cta-title" className="relative isolate flex min-h-[88dvh] items-end overflow-hidden bg-brand-forest">
      <Grain />

      {/* The scene: the string of lights, the window and the ladder. The cream lines are always there; a warm copy over each rung, the
          window and each bulb is what lights as you arrive. One drawing, scaled evenly to the height of the section, held to the bottom
          right, and allowed to overflow so the string comes in from the top or the corner at any screen width. On a phone it is smaller and
          lifted to the top right, clear of the large heading, and its foot fades out. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 mx-auto max-w-[1400px] max-md:[mask-image:linear-gradient(to_bottom,black_36%,transparent_58%)]">
        <svg
          viewBox="0 0 600 1000"
          fill="none"
          strokeLinecap="round"
          className="absolute right-3 bottom-0 h-full w-auto aspect-[3/5] overflow-visible max-md:top-[4%] max-md:bottom-auto max-md:h-[52%] md:right-8 lg:right-16"
        >
          <defs>
            <radialGradient id="cta-glow">
              <stop offset="0" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0.3 }} />
              <stop offset="1" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id="cta-bulb">
              <stop offset="0" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0.5 }} />
              <stop offset="1" style={{ stopColor: "var(--color-brand-warm)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>

          {/* the light the window throws into the section */}
          <circle data-glow cx="512" cy="342" r="260" fill="url(#cta-glow)" style={{ opacity: 1 }} />

          {/* the string of lights: the wire, a small cream bulb that is always there, and the warm one over it that lights */}
          <path d={WIRE_D} className="stroke-brand-cream/[0.2]" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {BULBS.map((bulb) => (
            <circle key={`dim-${bulb.x}`} cx={bulb.x} cy={bulb.y + 7} r="4.2" className="fill-brand-cream/[0.22]" stroke="none" />
          ))}
          {BULBS.map((bulb) => (
            <g key={`lit-${bulb.x}`} data-bulb style={{ opacity: 1 }}>
              <circle cx={bulb.x} cy={bulb.y + 7} r="20" fill="url(#cta-bulb)" />
              <circle cx={bulb.x} cy={bulb.y + 7} r="4.2" className="fill-brand-warm" stroke="none" />
            </g>
          ))}

          {/* the ladder */}
          {RAILS.map((d) => (
            <path key={d} d={d} className="stroke-brand-cream/[0.16]" strokeWidth="3.4" vectorEffect="non-scaling-stroke" />
          ))}
          {RUNGS.map((d) => (
            <path key={d} d={d} className="stroke-brand-cream/[0.16]" strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
          ))}
          {RUNGS.map((d) => (
            <path key={`warm-${d}`} data-rung d={d} className="stroke-brand-warm" strokeWidth="2.8" vectorEffect="non-scaling-stroke" style={{ opacity: 1 }} />
          ))}

          {/* the window at the top: a frame in cream, and the pane that lights */}
          <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} className="stroke-brand-cream/[0.16]" strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
          <path d={`M${WINDOW.x + WINDOW.w / 2} ${WINDOW.y} V${WINDOW.y + WINDOW.h} M${WINDOW.x} ${WINDOW.y + WINDOW.h / 2} H${WINDOW.x + WINDOW.w}`} className="stroke-brand-cream/[0.16]" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <rect data-window x={WINDOW.x + 1} y={WINDOW.y + 1} width={WINDOW.w - 2} height={WINDOW.h - 2} className="fill-brand-warm/80" stroke="none" style={{ opacity: 1 }} />
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-[1400px] px-6 pt-[20dvh] pb-[9dvh] md:px-8 lg:px-16">
        <h2 id="cta-title" className="text-shadow-big font-display text-[clamp(3.6rem,9.2vw,10rem)] leading-[0.94] text-brand-cream">
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
