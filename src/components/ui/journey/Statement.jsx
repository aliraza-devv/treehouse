"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { STATEMENT, STATEMENT_ACCENT } from "@/lib/site";
import Photo from "./Photo";

// THE IDEA, with the people in it. The sentence lights up word by word as you read down it (the motion sets
// the reading pace), while three photographs of the thing the sentence is about (children at a treehouse
// window, a cabin glowing at night, a lit treehouse in the woods) drift past it at different speeds, each
// slowly settling as it crosses the screen. A soft misty forest sits behind the lot so the section is never
// just words on a flat colour. Shapes: one corner radius for every frame (28px), tilts are small and fixed.
// Reduced motion: the sentence and the photos are simply there.
const FRAME =
  "absolute overflow-hidden rounded-[28px] ring-1 ring-brand-cream/10 shadow-[0_30px_60px_-26px_color-mix(in_srgb,var(--color-brand-forest)_55%,black)]";

export default function Statement() {
  const root = useRef(null);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;

      gsap.fromTo(
        el.querySelectorAll("[data-word]"),
        { opacity: 0.14 },
        {
          opacity: 1,
          ease: "none",
          stagger: 0.15,
          scrollTrigger: { trigger: el.querySelector("h2"), start: "top 82%", end: "bottom 52%", scrub: true },
        },
      );

      // Each photo drifts at its own speed (data-drift is a percentage of its own height) and the picture
      // inside it settles from a slight zoom: two layers of depth per frame.
      el.querySelectorAll("[data-drift]").forEach((frame) => {
        const drift = parseFloat(frame.dataset.drift);
        gsap.fromTo(
          frame,
          { yPercent: drift },
          { yPercent: -drift, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } },
        );
        gsap.fromTo(
          frame.querySelector("img"),
          { scale: 1.22 },
          { scale: 1.04, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom top", scrub: true } },
        );
        gsap.from(frame, { autoAlpha: 0, duration: 1.1, ease: "expoOut", scrollTrigger: { trigger: frame, start: "top 88%" } });
      });

      gsap.fromTo(
        el.querySelector("[data-mist]"),
        { yPercent: -7 },
        { yPercent: 7, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } },
      );
    });
    return () => mm.revert();
  }, []);

  const words = STATEMENT.split(" ");

  return (
    <section ref={root} aria-label="Our idea" className="relative overflow-x-clip px-6 pt-[10vh] pb-[22vh] md:px-8 lg:px-16">
      {/* The mist: decorative, faded out top and bottom so it never shows an edge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-8%] h-[116%] opacity-40 [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)]"
      >
        <div data-mist className="h-full w-full">
          <Photo name="statement-mist" sizes="100vw" className="h-full w-full object-cover" />
        </div>
      </div>

      <div className="relative mx-auto grid max-w-[1400px] items-center gap-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <h2 className="font-display text-[clamp(2.1rem,4.3vw,4.3rem)] leading-[1.08] tracking-normal text-balance text-brand-cream">
          {words.map((word, i) => (
            <span key={i} data-word className={word.replace(/[^a-z]/gi, "") === STATEMENT_ACCENT ? "text-brand-warm" : undefined}>
              {word}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </h2>

        <div className="relative h-[min(125vw,560px)] md:h-[640px] lg:h-[700px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-10 bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-brand-warm)_20%,transparent),transparent)]"
          />
          <div data-drift="5" className={`${FRAME} top-0 right-[3%] aspect-[4/5] w-[62%]`}>
            <Photo name="statement-kids" sizes="(min-width: 1024px) 28vw, 62vw" className="h-full w-full object-cover" />
          </div>
          <div data-drift="-11" className={`${FRAME} bottom-[5%] left-0 aspect-square w-[43%] -rotate-[4deg]`}>
            <Photo name="statement-cabin" sizes="(min-width: 1024px) 20vw, 43vw" className="h-full w-full object-cover" />
          </div>
          <div data-drift="14" className={`${FRAME} -bottom-[3%] right-0 aspect-[3/4] w-[32%] rotate-[5deg]`}>
            <Photo name="statement-lit" sizes="(min-width: 1024px) 15vw, 32vw" className="h-full w-full object-cover" />
          </div>
        </div>
      </div>
    </section>
  );
}
