"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { LEAF_PATH } from "@/components/ui/journey/canopy";

// THE NAME, as big as the page allows, standing on the ground line. The footer is the ground, so the letters are shoots: when
// it arrives they come up out of the soil (the bottom edge of the mask), one after another in no particular order, each a
// little off upright, and the leaf on the h unfurls last, as it does in the logo. After that the letters are alive to the
// pointer the way a plant is alive to light: the ones near the cursor lift a little, lean toward it and warm to the page's
// lantern colour, and they settle back when it goes. On a touch screen there is no cursor, so a tap makes a letter hop.
// Reduced motion: it is simply there, still.
//
// It is set in the same Fraunces as the logo, with the leaf of Wordmark.jsx (placed from the baseline in em: see there), and sized
// to the width of its container (container query units), so the one word fills the page edge to edge at any width. Screen
// readers get the plain name.
const WORD = "Treehouse";

function Letter({ char }) {
  return (
    <span data-letter className="relative inline-block origin-bottom will-change-transform" style={{ "--k": 0, color: "color-mix(in srgb, var(--color-brand-warm) calc(var(--k, 0) * 85%), var(--color-brand-cream))" }}>
      <span data-hop className="relative inline-block">
        {char === "h" && (
          // a zero-size anchor on the baseline; the leaf is placed from it, and grown inside (so the scale never fights the lean)
          <span aria-hidden="true" className="relative inline-block h-0 w-0 align-baseline">
            <span className="absolute bottom-[0.66em] left-[0.22em] h-[0.17em] w-[0.36em] origin-left -rotate-[52deg]">
              <svg data-leaf viewBox="0 0 26 12" className="block h-full w-full origin-left fill-brand-green-light">
                <path d={LEAF_PATH} />
              </svg>
            </span>
          </span>
        )}
        {char}
      </span>
    </span>
  );
}

export default function FooterWordmark() {
  const root = useRef(null);

  useEffect(() => {
    const el = root.current;
    const letters = gsap.utils.toArray(el.querySelectorAll("[data-letter]"));
    const mm = gsap.matchMedia();

    // Arrival, once: up out of the ground, then the leaf
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap
        .timeline({ scrollTrigger: { trigger: el, start: "top 94%", once: true } })
        .from(letters, {
          yPercent: 112,
          rotation: (i) => (i % 2 ? 1 : -1) * (3 + ((i * 7) % 5)),
          transformOrigin: "50% 100%",
          duration: 1.5,
          ease: "expoOut",
          stagger: { each: 0.055, from: "random" },
        })
        .from(el.querySelector("[data-leaf]"), { scale: 0, duration: 1.1, ease: "back.out(2.2)" }, 0.95);

      // A tap or a click makes a letter hop (on its own inner element, so it never fights the pointer's lift)
      const onDown = (event) => {
        const letter = event.target.closest("[data-letter]");
        if (!letter) return;
        const hop = letter.querySelector("[data-hop]");
        gsap.killTweensOf(hop);
        gsap
          .timeline()
          .to(hop, { y: -letter.offsetHeight * 0.14, duration: 0.16, ease: "power2.out" })
          .to(hop, { y: 0, duration: 1.2, ease: "elastic.out(1, 0.32)" });
      };
      el.addEventListener("pointerdown", onDown);
      return () => el.removeEventListener("pointerdown", onDown);
    });

    // The light: only where there is a cursor
    mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
      let centers = [];
      let height = 0;
      const measure = () => {
        centers = letters.map((letter) => {
          const box = letter.getBoundingClientRect();
          return { x: box.left + box.width / 2, w: box.width };
        });
        height = el.getBoundingClientRect().height;
      };
      const to = letters.map((letter) => ({
        y: gsap.quickTo(letter, "y", { duration: 0.6, ease: "power3.out" }),
        r: gsap.quickTo(letter, "rotation", { duration: 0.7, ease: "power3.out" }),
        k: gsap.quickTo(letter, "--k", { duration: 0.6, ease: "power3.out" }),
      }));

      const onMove = (event) => {
        if (!centers.length) measure();
        letters.forEach((_, i) => {
          const { x, w } = centers[i];
          const off = (event.clientX - x) / w; // in letter widths, negative to the left of the letter
          const near = Math.max(0, 1 - Math.abs(off) / 1.7);
          const k = near * near * (3 - 2 * near); // smoothstep: a soft pool of light
          to[i].y(-k * height * 0.06);
          to[i].r(Math.max(-1, Math.min(1, off)) * k * 5);
          to[i].k(k);
        });
      };
      const onLeave = () => {
        to.forEach((setter) => {
          setter.y(0);
          setter.r(0);
          setter.k(0);
        });
      };

      el.addEventListener("pointerenter", measure);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
      window.addEventListener("resize", measure);
      return () => {
        el.removeEventListener("pointerenter", measure);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("resize", measure);
      };
    });

    return () => mm.revert();
  }, []);

  return (
    // The container is the footer's width; the type is sized from it, so it always fills the line. The word is 4.417em wide in this
    // font (measured), so 4.43 fills about 99.7 percent of it. The headroom above (0.45em) is for the leaf, which stands 0.32em above
    // the h, and for the letters lifting toward the cursor, so neither is clipped by the mask.
    <div ref={root} className="[container-type:inline-size]" style={{ "--size": "calc(100cqw / 4.43)" }}>
      <p
        className="font-display overflow-hidden pt-[0.45em] pb-[0.04em] text-[length:var(--size)] leading-[0.8] tracking-[-0.015em] whitespace-nowrap text-brand-cream select-none"
        style={{ fontKerning: "normal" }}
      >
        <span className="sr-only">Treehouse</span>
        <span aria-hidden="true" className="block">
          {[...WORD].map((char, i) => (
            <Letter key={i} char={char} />
          ))}
        </span>
      </p>
    </div>
  );
}
