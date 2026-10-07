"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { LEAF_PATH } from "@/components/ui/journey/canopy";

// THE NAME, as big as the page allows, standing on the ground line. The footer is the ground, so the letters are shoots: when
// it arrives they come up out of the soil (the bottom edge of the mask), one after another in no particular order, each a
// little off upright, and the leaf on the i unfurls last, as it does in the logo. After that the letters are alive to the
// pointer the way a plant is alive to light: the ones near the cursor lift a little, lean toward it and warm to the page's
// lantern colour, and they settle back when it goes. On a touch screen there is no cursor, so a tap makes a letter hop.
// Reduced motion: it is simply there, still.
//
// It is set in the same Fraunces as the logo, with the dotless i and the leaf of Wordmark.jsx, and sized to the width of its
// container (container query units), so it fills the page edge to edge at any width: two lines on a phone, one from the
// tablet size up. Screen readers get the plain name.
const WORDS = ["Treehouse", "Lıfe"]; // the second has the dotless i (U+0131): the leaf is its dot

function Letter({ char, index }) {
  return (
    <span data-letter data-i={index} className="relative inline-block origin-bottom will-change-transform" style={{ "--k": 0, color: "color-mix(in srgb, var(--color-brand-warm) calc(var(--k, 0) * 85%), var(--color-brand-cream))" }}>
      <span data-hop className="relative inline-block">
        {char}
        {char === "ı" && (
          // positioned here, grown inside (so the scale never fights the lean)
          <span aria-hidden="true" className="absolute top-[0.2em] left-1/2 h-[0.17em] w-[0.36em] -rotate-[52deg]">
            <svg data-leaf viewBox="0 0 26 12" className="block h-full w-full origin-left fill-brand-green-light">
              <path d={LEAF_PATH} />
            </svg>
          </span>
        )}
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

  let count = 0;
  return (
    // The container is the footer's width; the type is sized from it, so it always fills the line
    <div ref={root} className="[container-type:inline-size]" style={{ "--one": "calc(100cqw / 6.2)", "--two": "calc(100cqw / 4.6)" }}>
      <p
        className="font-display flex flex-col overflow-hidden pt-[0.16em] pb-[0.04em] leading-[0.8] tracking-[-0.015em] text-brand-cream select-none max-md:text-[length:var(--two)] md:flex-row md:justify-between md:text-[length:var(--one)]"
        style={{ fontKerning: "normal" }}
      >
        <span className="sr-only">Treehouse Life</span>
        {WORDS.map((word) => (
          <span key={word} aria-hidden="true" className="block whitespace-nowrap">
            {[...word].map((char, i) => (
              <Letter key={i} char={char} index={count++} />
            ))}
          </span>
        ))}
      </p>
    </div>
  );
}
