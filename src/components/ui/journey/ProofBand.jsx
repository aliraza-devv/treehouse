"use client";

import { useEffect, useRef } from "react";
import { ScrollTrigger, gsap } from "@/lib/gsap";
import { PLACES, STATS } from "@/lib/site";
import Awards from "./Awards";
import Photo from "./Photo";

// PROOF, as one finished object: a single framed card with the photograph on top and the evidence attached
// underneath it (the three numbers beside one plain sentence), then the awards, then the places. The headline
// makes the claim, and the claim is drawn: a route line travels over the photograph from Surrey, through Lake Como
// and Quebec, to the Seychelles, the four real project places from the brief. The numbers count up once when they
// arrive (state: they are earned, not pasted). The place names are the page's ONE marquee; its speed follows the
// scroll velocity. Reduced motion: final numbers, the route simply drawn, and the places in a static wrapped row.

// The route: one cubic curve in a 360 x 150 box, with a pin at each place, evenly spaced along it (t = 0, 1/3,
// 2/3, 1). Plain arithmetic only, rounded to 0.1, so the server render and the browser agree.
const ROUTE = [
  [24, 112],
  [110, 6],
  [236, 4],
  [336, 98],
];
const ROUTE_D = `M${ROUTE[0][0]} ${ROUTE[0][1]} C${ROUTE[1][0]} ${ROUTE[1][1]} ${ROUTE[2][0]} ${ROUTE[2][1]} ${ROUTE[3][0]} ${ROUTE[3][1]}`;
const bezier = (t, axis) => {
  const u = 1 - t;
  const [p0, p1, p2, p3] = ROUTE.map((point) => point[axis]);
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};
const PINS = PLACES.map((name, i) => {
  const t = i / (PLACES.length - 1);
  return { name, x: Math.round(bezier(t, 0) * 10) / 10, y: Math.round(bezier(t, 1) * 10) / 10 };
});

export default function ProofBand() {
  const root = useRef(null);
  const track = useRef(null);

  useEffect(() => {
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;
      const band = el.querySelector("[data-band]");

      // The photograph is taller than its frame and slides slower than the page, with a slow push in.
      gsap.fromTo(
        el.querySelector("[data-band-photo]"),
        { yPercent: -9, scale: 1.12 },
        { yPercent: 9, scale: 1.02, ease: "none", scrollTrigger: { trigger: band, start: "top bottom", end: "bottom top", scrub: true } },
      );

      // The headline comes up line by line out of a mask, then the route draws itself and the pins land in order.
      gsap
        .timeline({ scrollTrigger: { trigger: band, start: "top 60%", once: true } })
        .from(el.querySelectorAll("[data-line]"), { yPercent: 110, duration: 1.3, ease: "expoOut", stagger: 0.12 }, 0)
        .fromTo(el.querySelector("[data-route]"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 2.2, ease: "power2.inOut" }, 0.4)
        .from(el.querySelectorAll("[data-pin]"), { scale: 0, transformOrigin: "50% 50%", duration: 0.6, ease: "back.out(3)", stagger: 0.7 }, 0.5)
        .from(el.querySelectorAll("[data-place]"), { autoAlpha: 0, y: 8, duration: 0.7, ease: "expoOut", stagger: 0.7 }, 0.7);

      // Each laurel grows leaf by leaf from the bottom as its award arrives: earned, not pasted.
      el.querySelectorAll("[data-award]").forEach((award) => {
        gsap.from(award.querySelectorAll("[data-leaf]"), {
          scale: 0,
          duration: 0.5,
          ease: "back.out(2)",
          stagger: 0.045,
          scrollTrigger: { trigger: award, start: "top 88%", once: true },
        });
      });

      el.querySelectorAll("[data-count]").forEach((node) => {
        const target = parseFloat(node.dataset.count);
        const suffix = node.dataset.suffix ?? "";
        const state = { value: 0 };
        node.textContent = `0${suffix}`;
        gsap.to(state, {
          value: target,
          duration: 1.8,
          ease: "power2.out",
          scrollTrigger: { trigger: node, start: "top 88%", once: true },
          onUpdate: () => {
            node.textContent = `${Math.round(state.value)}${suffix}`;
          },
        });
      });

      // One list width is half the track (two identical lists), so xPercent -50 loops seamlessly.
      const loop = gsap.to(track.current, { xPercent: -50, duration: 40, ease: "none", repeat: -1 });
      ScrollTrigger.create({
        trigger: el,
        start: "top bottom",
        end: "bottom top",
        onUpdate: (self) => {
          const boost = 1 + Math.min(5, Math.abs(self.getVelocity()) / 500);
          gsap.to(loop, { timeScale: boost, duration: 0.25, overwrite: true });
          gsap.to(loop, { timeScale: 1, duration: 1.1, delay: 0.3 });
        },
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="projects" aria-labelledby="proof-title" className="overflow-x-clip py-[16vh]">
      <div className="px-6 md:px-8 lg:px-16">
        {/* One card: the photograph, with the evidence attached under it */}
        <div className="overflow-hidden rounded-[28px] ring-1 ring-brand-cream/15">
          <div data-band className="relative h-[min(72vh,660px)] min-h-[26rem] overflow-hidden bg-brand-forest">
            <div data-band-photo className="absolute inset-x-0 -top-[10%] h-[120%]">
              <Photo name="proof-dusk" sizes="100vw" className="h-full w-full object-cover" />
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand-forest/85 via-brand-forest/25 via-55% to-transparent" />

            {/* The route: Surrey to the Seychelles by way of Lake Como and Quebec */}
            <div aria-hidden="true" className="pointer-events-none absolute top-8 right-8 hidden aspect-[360/150] w-[min(42%,28rem)] md:block">
              <svg viewBox="0 0 360 150" className="absolute inset-0 h-full w-full overflow-visible" fill="none">
                <path d={ROUTE_D} className="stroke-brand-cream/35" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="1 7" />
                <path
                  data-route
                  d={ROUTE_D}
                  pathLength="1"
                  className="stroke-brand-warm"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  style={{ strokeDasharray: 1 }}
                />
                {PINS.map((pin) => (
                  <circle key={pin.name} data-pin cx={pin.x} cy={pin.y} r="5.5" className="fill-brand-warm stroke-brand-forest" strokeWidth="2" />
                ))}
              </svg>
              {PINS.map((pin, i) => (
                <span
                  key={pin.name}
                  data-place
                  className="absolute font-hand text-[1.45rem] leading-none whitespace-nowrap text-brand-cream"
                  style={{
                    left: `${((pin.x / 360) * 100).toFixed(1)}%`,
                    top: `${((pin.y / 150) * 100).toFixed(1)}%`,
                    translate: i === 0 ? "-6% 0.9rem" : i === PINS.length - 1 ? "-82% 0.9rem" : "-50% -2.2rem", // the individual property, so GSAP can move the label with transform
                  }}
                >
                  {pin.name}
                </span>
              ))}
            </div>

            <h2
              id="proof-title"
              className="absolute right-6 bottom-8 left-6 max-w-4xl font-display text-[clamp(2.6rem,6.2vw,6rem)] leading-[1.02] tracking-normal text-brand-cream md:right-10 md:bottom-10 md:left-10"
            >
              <span className="block overflow-hidden pb-[0.1em]">
                <span data-line className="block">
                  Built from Surrey
                </span>
              </span>
              <span className="block overflow-hidden pb-[0.1em]">
                <span data-line className="block">
                  to the <span className="text-brand-warm">Seychelles.</span>
                </span>
              </span>
            </h2>
          </div>

          <div className="grid items-center gap-8 border-t border-brand-cream/10 bg-brand-cream/[0.05] px-6 py-9 md:px-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
            <ul role="list" className="grid grid-cols-3 divide-x divide-brand-cream/15">
              {STATS.map((stat) => (
                <li key={stat.label} className="flex flex-col gap-1 px-4 first:pl-0 md:px-9 md:first:pl-0">
                  <span
                    data-count={stat.value}
                    data-suffix={stat.suffix}
                    className="font-display text-[clamp(2.4rem,5vw,5rem)] leading-none text-brand-cream lining-nums tabular-nums"
                  >
                    {stat.value}
                    {stat.suffix}
                  </span>
                  <span className="text-[14px] text-brand-cream/60">{stat.label}</span>
                </li>
              ))}
            </ul>
            <p className="max-w-[30rem] text-[16px] leading-relaxed text-pretty text-brand-cream/75">
              Award-winning treehouse, rope bridge and treetop walkway builders, working with families, estates, resorts and schools.
            </p>
          </div>
        </div>

        <Awards className="mt-20 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4" />
      </div>

      <div className="mt-[12vh] overflow-hidden">
        <div ref={track} className="flex w-max motion-reduce:w-full motion-reduce:flex-wrap">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              role="list"
              aria-hidden={copy === 1 ? "true" : undefined}
              className={`flex shrink-0 items-center gap-16 pr-16 motion-reduce:flex-wrap motion-reduce:gap-x-10 ${copy === 1 ? "motion-reduce:hidden" : ""}`}
            >
              {PLACES.map((place, i) => (
                <li
                  key={place}
                  className={`font-display text-[clamp(4.5rem,13vw,12rem)] leading-[1.05] whitespace-nowrap ${
                    i % 2 === 0 ? "text-outline" : "text-brand-cream"
                  }`}
                >
                  {place}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
