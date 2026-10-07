"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap";
import { TESTIMONIALS } from "@/lib/site";
import { DeckBackdrop } from "./backdrops";

// WHAT CLIENTS SAY. A big round timber window on the left, like the porthole of the treehouse, with a portrait in it, and the
// words of one client at a time beside it. You move along them the way everyone already knows how: a previous and a next
// button (the same circled arrows as the footer's), a counter, and a row of rungs, one for each client, that you can jump
// along (the active rung stands tall and warm, like the rung that lights on the ladder at the end of the page). Arrow keys
// and a swipe on touch work too. Nothing limits how many there are: add an object to TESTIMONIALS in site.js and a rung
// appears.
//
// The portraits are stock stand-ins, not the clients, so each one carries a quiet "Illustrative photo" caption right under the
// window, next to the face it describes (see `illustrative` in site.js). A client's own photograph replaces the file and the
// caption goes.
//
// What moves, and why:
// * arrival, once: the heading rises, the window opens like an iris, the first words come up, and the rungs are put up one
//   after another;
// * moving on: the old words rise out of their masks and the new ones rise in, word by word, the way every heading on the
//   page arrives (the type is always full colour, never a fade). Going forward they travel up, going back they travel down,
//   so the direction you are moving is the direction the words move. The window opens like an iris onto the next portrait.
//   The rungs ripple to their new heights from the one you chose (CSS, with a short delay by distance).
// Reduced motion: no rising and no iris; the words and the portrait simply cross-fade.
//
// Accessibility: a carousel region with slides, real buttons with names, a live region that says which one is showing, the
// rungs are buttons with aria-current. All the quotes stay in the markup, stacked in one grid cell so the section never
// changes height; the ones not showing are inert and aria-hidden. Without JavaScript the first quote is shown. The portraits
// are decoration (the name and the tag carry the meaning).

const COUNT = TESTIMONIALS.length;
const two = (n) => String(n).padStart(2, "0");

// The words of a quote, each flagged if it falls inside the accent phrase. The opening and closing marks ride on the first
// and last word.
function tokens(item) {
  const start = item.quote.indexOf(item.accent);
  const end = start + item.accent.length;
  let at = 0;
  const list = item.quote.split(" ").map((word) => {
    const from = at;
    at += word.length + 1;
    return { word, hot: start >= 0 && from >= start && from < end };
  });
  list[0].word = `“${list[0].word}`;
  list[list.length - 1].word = `${list[list.length - 1].word}”`;
  return list;
}
const QUOTES = TESTIMONIALS.map(tokens);

const ARROW =
  "group focus-ring grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border text-lg transition-[background-color,color] duration-300 active:scale-95";

export default function Testimonials() {
  const root = useRef(null);
  const ctx = useRef(null);
  const topLayer = useRef(1);
  const swipe = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = root.current;
    ctx.current = gsap.context(() => {}, el);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const q = (selector) => el.querySelectorAll(selector);
      const firstPanel = q("[data-panel]")[0];

      gsap
        .timeline({ scrollTrigger: { trigger: el, start: "top 62%", once: true } })
        .from(q("[data-rise]"), { yPercent: 110, duration: 1.2, ease: "expoOut", stagger: 0.1 }, 0)
        .from(q("[data-disc]"), { clipPath: "circle(0% at 50% 50%)", duration: 1.4, ease: "expoOut" }, 0.3)
        .from(firstPanel.querySelectorAll("[data-word]"), { yPercent: 110, duration: 1.1, ease: "expoOut", stagger: 0.02 }, 0.7)
        .from(firstPanel.querySelectorAll("[data-meta]"), { autoAlpha: 0, y: 10, duration: 0.8, ease: "expoOut" }, 1.3)
        .from(q("[data-tag]"), { autoAlpha: 0, y: 6, duration: 0.8, ease: "expoOut" }, 1.4)
        .from(q("[data-controls]"), { autoAlpha: 0, y: 10, duration: 0.8, ease: "expoOut" }, 1.4)
        .from(q("[data-rung]"), { scaleY: 0, transformOrigin: "50% 100%", duration: 0.6, ease: "expoOut", stagger: 0.05 }, 1.5);
    });

    return () => {
      mm.revert();
      ctx.current?.revert();
    };
  }, []);

  // Move to a quote. `dir` is which way we are going (1 forward, -1 back), so the words travel the same way.
  const go = (next, dir = next > active ? 1 : -1) => {
    if (next === active) return;
    const prev = active;
    setActive(next);

    const el = root.current;
    const panels = el.querySelectorAll("[data-panel]");
    const layers = el.querySelectorAll("[data-photo]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    ctx.current.add(() => {
      topLayer.current += 1;
      const layer = layers[next];

      if (reduced) {
        panels.forEach((panel, i) => {
          gsap.set(panel.querySelectorAll("[data-word], [data-meta]"), { clearProps: "all" });
          if (i === next) gsap.fromTo(panel, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, delay: 0.2, overwrite: true });
          else gsap.to(panel, { autoAlpha: 0, duration: 0.2, overwrite: true });
        });
        layers.forEach((other, i) => {
          if (i === next) gsap.fromTo(other, { autoAlpha: 0 }, { autoAlpha: 1, zIndex: topLayer.current, duration: 0.35, overwrite: true });
          else gsap.to(other, { autoAlpha: 0, duration: 0.35, overwrite: true });
        });
        return;
      }

      // The words: the old ones leave the way we are going, the new ones arrive from that side
      panels.forEach((panel, i) => {
        if (i !== prev && i !== next) gsap.set(panel, { autoAlpha: 0 });
      });
      const words = (i) => panels[i].querySelectorAll("[data-word]");
      gsap.to(words(prev), { yPercent: -110 * dir, duration: 0.5, ease: "power3.in", stagger: 0.012, overwrite: true, onComplete: () => gsap.set(panels[prev], { autoAlpha: 0 }) });
      gsap.to(panels[prev].querySelectorAll("[data-meta]"), { autoAlpha: 0, duration: 0.25, overwrite: true });
      gsap.set(panels[next], { autoAlpha: 1 });
      gsap.fromTo(words(next), { yPercent: 110 * dir }, { yPercent: 0, duration: 1.05, ease: "expoOut", stagger: 0.018, delay: 0.32, overwrite: true });
      gsap.fromTo(panels[next].querySelectorAll("[data-meta]"), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "expoOut", delay: 0.7, overwrite: true });

      // The window: the next portrait opens like an iris over the last
      gsap.set(layer, { zIndex: topLayer.current, autoAlpha: 1 });
      gsap.fromTo(
        layer,
        { clipPath: "circle(0% at 50% 50%)" },
        {
          clipPath: "circle(72% at 50% 50%)",
          duration: 1.25,
          ease: "expoOut",
          overwrite: true,
          onComplete: () => {
            gsap.set(layer, { clearProps: "clipPath" });
            // Put away the portraits underneath this one (never a newer one, if the next move came before this finished)
            layers.forEach((other) => {
              if (other !== layer && Number(gsap.getProperty(other, "zIndex")) < Number(gsap.getProperty(layer, "zIndex"))) gsap.set(other, { autoAlpha: 0 });
            });
          },
        },
      );
      gsap.fromTo(layer.querySelector("[data-zoom]"), { scale: 1.15 }, { scale: 1, duration: 1.8, ease: "expoOut", overwrite: true });
    });
  };

  const step = (dir) => go((active + dir + COUNT) % COUNT, dir);

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(COUNT - 1);
    else return;
    event.preventDefault();
  };

  // A swipe across the words on a touch screen moves on or back
  const onPointerDown = (event) => {
    swipe.current = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
  };
  const onPointerUp = (event) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dy) > 40) return;
    step(dx < 0 ? 1 : -1);
  };

  return (
    <section ref={root} id="reviews" aria-labelledby="reviews-title" className="relative overflow-hidden bg-brand-forest px-6 py-[16vh] md:px-8 lg:px-16">
      <DeckBackdrop />

      <div className="relative mx-auto max-w-[1400px]">
        <h2 id="reviews-title" className="font-display text-[clamp(2.3rem,4.2vw,4.6rem)] leading-[1.04] text-brand-cream">
          <span className="-mx-[0.25em] -mb-[0.14em] block overflow-hidden px-[0.25em] pb-[0.14em] md:whitespace-nowrap">
            <span data-rise className="block">
              Heard from
            </span>
          </span>
          <span className="-mx-[0.25em] -mb-[0.14em] block overflow-hidden px-[0.25em] pb-[0.14em] md:whitespace-nowrap">
            <span data-rise className="block">
              the <span className="text-brand-warm">deck.</span>
            </span>
          </span>
        </h2>

        <div
          role="region"
          aria-roledescription="carousel"
          aria-label="What clients say"
          onKeyDown={onKeyDown}
          className="mt-12 grid items-center gap-14 lg:mt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20"
        >
          {/* the window: a timber ring round the glass, the portraits one on top of another */}
          <div className="relative mx-auto aspect-square w-[min(82vw,22rem)] rounded-full bg-brand-timber-dark p-[0.7rem] shadow-[0_34px_56px_-34px_color-mix(in_srgb,var(--color-brand-forest)_30%,black)] sm:w-[min(64vw,28rem)] lg:mx-0 lg:w-full lg:max-w-[34rem]">
            <div data-disc aria-hidden="true" className="relative h-full w-full overflow-hidden rounded-full bg-brand-forest">
              {TESTIMONIALS.map((item, i) => (
                <div key={item.id} data-photo className={`absolute inset-0 ${i === 0 ? "" : "invisible"}`} style={{ zIndex: i === 0 ? 1 : 0 }}>
                  <div data-zoom className="absolute inset-0">
                    <img
                      src={item.portrait}
                      alt=""
                      width={960}
                      height={960}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="photo-grade h-full w-full object-cover"
                    />
                  </div>
                </div>
              ))}
              <span className="pointer-events-none absolute inset-0 z-50 rounded-full shadow-[inset_0_0_44px_rgba(0,0,0,0.3)]" />
            </div>

            {/* the note: these portraits are stand-ins, not the clients, and it says so, quietly, right under the window */}
            {TESTIMONIALS[active].illustrative && (
              <p data-tag className="absolute inset-x-0 top-full mt-4 text-center text-[12px] leading-none text-brand-cream/65">
                Illustrative photo
              </p>
            )}
          </div>

          <div className="flex max-w-[44rem] flex-col gap-10">
            {/* the words: every quote stacked in one cell, so the section is as tall as the tallest and never jumps */}
            <div className="grid touch-pan-y" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
              {TESTIMONIALS.map((item, i) => (
                <figure
                  key={item.id}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${COUNT}`}
                  aria-hidden={i !== active}
                  inert={i !== active}
                  data-panel
                  className={`self-center [grid-area:1/1] ${i === 0 ? "" : "invisible"}`}
                >
                  <blockquote>
                    <p className="font-display text-[clamp(1.5rem,2.5vw,2.4rem)] leading-[1.18] text-pretty text-brand-cream">
                      {QUOTES[i].map((token, w) => (
                        <span key={w}>
                          <span className="-mx-[0.06em] -mb-[0.16em] inline-block overflow-hidden px-[0.06em] pb-[0.16em] align-top">
                            <span data-word className={`inline-block ${token.hot ? "text-brand-warm" : ""}`}>
                              {token.word}
                            </span>
                          </span>{" "}
                        </span>
                      ))}
                    </p>
                  </blockquote>
                  <figcaption data-meta className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                    <span className="font-semibold text-brand-cream">{item.who}</span>
                    {item.what && (
                      <>
                        <span aria-hidden="true" className="h-3.5 w-px bg-brand-cream/30" />
                        <span className="text-brand-cream/65">{item.what}</span>
                      </>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>

            {/* moving along them: previous, next, where you are, and a rung for each one */}
            <div data-controls className="flex flex-wrap items-center gap-x-6 gap-y-5">
              <div className="flex gap-3">
                <button
                  type="button"
                  aria-label="Previous testimonial"
                  onClick={() => step(-1)}
                  className={`${ARROW} border-brand-cream/45 text-brand-cream hover:bg-brand-cream/10`}
                >
                  <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:-translate-x-0.5">
                    ←
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Next testimonial"
                  onClick={() => step(1)}
                  className={`${ARROW} border-brand-cream bg-brand-cream text-brand-forest hover:bg-brand-cream/85`}
                >
                  <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
              </div>

              <p aria-hidden="true" className="tabular-nums">
                <span className="font-display text-[1.7rem] leading-none text-brand-cream">{two(active + 1)}</span>
                <span className="ml-1.5 text-[14px] text-brand-cream/50">/ {two(COUNT)}</span>
              </p>
              <p aria-live="polite" className="sr-only">
                Testimonial {active + 1} of {COUNT}
              </p>

              <div role="group" aria-label="Choose a testimonial" className="flex h-10 min-w-0 flex-1 items-end max-sm:order-last max-sm:basis-full">
                {TESTIMONIALS.map((item, i) => {
                  const on = i === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-rung
                      aria-label={`Testimonial ${i + 1} of ${COUNT}`}
                      aria-current={on ? "true" : undefined}
                      onClick={() => go(i)}
                      className="group focus-ring flex h-10 max-w-7 min-w-6 flex-1 cursor-pointer items-end justify-center"
                    >
                      <span
                        aria-hidden="true"
                        className={`block w-0.5 rounded-full transition-[height,background-color] duration-500 ease-expo-out ${
                          on ? "h-9 bg-brand-warm" : "h-4 bg-brand-cream/35 group-hover:h-6 group-hover:bg-brand-cream/70"
                        }`}
                        style={{ transitionDelay: `${Math.abs(i - active) * 12}ms` }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
