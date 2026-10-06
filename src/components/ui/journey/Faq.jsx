"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap";
import { FAQ } from "@/lib/site";
import { TreeSlice } from "./backdrops";
import { TIMBER_GRAIN } from "./timber";

// THE QUESTIONS, as a signpost at the edge of the wood. One timber post stands at the left; each question is a plank
// bolted to it, pointing the way, and no two hang quite level. A plank opens like a sign being read: it nods, and the
// answer is a paper note pinned under it (one note at a time). The post and the planks are drawn in the same timber
// as the trail signs on the walkway, on the page's own green, in front of a tree cut across (the slice), so the section
// belongs to the page instead of being a list on a background.
//
// Accessibility: each plank is a real button (aria-expanded, aria-controls) inside a heading, the answer is a region
// that is `inert` while it is closed, so a closed answer is never read or tabbed into. Without JavaScript the first
// answer is open and the rest are readable only after the page loads: the content is in the markup either way.
//
// Motion, and why: the post and planks swing into place once as the section arrives (the page's timber things all
// arrive hung or lowered); a plank nods when it opens (feedback that it took); the answer opens with a row-height
// transition, never a layout jump. Reduced motion: no swing, no nod, answers simply open.
const TILTS = [-0.7, 0.5, -0.35, 0.8, -0.55]; // degrees: the planks are hand-hung

export default function Faq() {
  const root = useRef(null);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;

      // the heading lines rise out of masks, as everywhere on the page
      gsap.from(el.querySelectorAll("[data-rise]"), {
        yPercent: 110,
        duration: 1.2,
        ease: "expoOut",
        stagger: 0.1,
        scrollTrigger: { trigger: el, start: "top 62%", once: true },
      });

      // the post is raised, then the planks swing onto it one after another
      gsap.from(el.querySelector("[data-post]"), {
        scaleY: 0,
        transformOrigin: "50% 100%",
        duration: 1.1,
        ease: "expoOut",
        scrollTrigger: { trigger: el.querySelector("[data-planks]"), start: "top 80%", once: true },
      });
      gsap.from(el.querySelectorAll("[data-plank]"), {
        rotation: -10,
        x: -30,
        autoAlpha: 0,
        duration: 1.5,
        ease: "elastic.out(1, 0.55)",
        stagger: 0.12,
        delay: 0.25,
        scrollTrigger: { trigger: el.querySelector("[data-planks]"), start: "top 75%", once: true },
      });

      // the woodland drifts a little against the page
      gsap.fromTo(
        el.querySelector("[data-slice]"),
        { yPercent: -5 },
        { yPercent: 5, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } },
      );
    });
    return () => mm.revert();
  }, []);

  // A plank nods when it is opened (a few degrees, then back to hanging): feedback that the click took.
  const toggle = (index, button) => {
    const opening = open !== index;
    setOpen(opening ? index : -1);
    if (opening && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(button.closest("[data-plank]"), { rotation: 0 }, { rotation: 1.6, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1, overwrite: "auto" });
    }
  };

  return (
    <section ref={root} id="faq" aria-labelledby="faq-title" className="relative overflow-hidden bg-brand-forest px-6 py-[16vh] md:px-8 lg:px-16">
      {/* Behind the sign: a tree cut across, very faint, the thing every project starts from */}
      <TreeSlice />

      <div className="relative mx-auto grid max-w-[1400px] gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <h2 id="faq-title" className="text-shadow-big font-display text-[clamp(2.3rem,4.2vw,4.6rem)] leading-[1.04] text-brand-cream">
            {["What people ask", "before they start."].map((line) => (
              <span key={line} className="block overflow-hidden px-[0.25em] pb-[0.14em] -mx-[0.25em] -mb-[0.14em] md:whitespace-nowrap">
                <span data-rise className="block">
                  {line}
                </span>
              </span>
            ))}
          </h2>
          <p className="text-shadow-logo mt-7 max-w-[26rem] text-[clamp(1.05rem,1.4vw,1.25rem)] leading-snug font-medium text-pretty text-brand-cream">
            The short answers. For the long ones, we would rather walk your garden with you.
          </p>
        </div>

        {/* The signpost */}
        <div className="relative">
          <span
            data-post
            aria-hidden="true"
            className={`absolute -top-8 -bottom-6 left-0 w-5 [clip-path:polygon(50%_0,100%_12px,100%_100%,0_100%,0_12px)] bg-brand-timber-dark sm:w-7 ${TIMBER_GRAIN} shadow-[inset_-3px_0_0_color-mix(in_srgb,var(--color-brand-forest)_45%,transparent)] [mask-image:linear-gradient(to_bottom,black_88%,transparent)]`}
          />

          <ul data-planks role="list" className="flex flex-col gap-4 pb-4">
            {FAQ.map((item, i) => {
              const isOpen = open === i;
              return (
                <li
                  key={item.id}
                  data-plank
                  style={{ rotate: `${TILTS[i % TILTS.length]}deg` }}
                  className="relative ml-2.5 origin-left sm:ml-3.5"
                >
                  <h3 className="[filter:drop-shadow(0_22px_16px_color-mix(in_srgb,var(--color-brand-forest)_55%,black))]">
                    <button
                      type="button"
                      id={`faq-q-${item.id}`}
                      aria-expanded={isOpen}
                      aria-controls={`faq-a-${item.id}`}
                      onClick={(event) => toggle(i, event.currentTarget)}
                      className="group focus-ring relative isolate flex w-full items-center justify-between gap-6 py-5 pr-16 pl-10 text-left sm:py-6 sm:pl-12"
                    >
                      {/* the board: an arrow-ended plank, lighter once it has been opened */}
                      <span
                        aria-hidden="true"
                        className={`absolute inset-0 -z-10 bg-brand-timber-dark transition-colors duration-500 ease-expo-out [clip-path:polygon(0_0,calc(100%-26px)_0,100%_50%,calc(100%-26px)_100%,0_100%)] group-aria-expanded:bg-brand-timber group-hover:bg-brand-timber/80 ${TIMBER_GRAIN}`}
                      />
                      {/* two bolts into the post */}
                      <span aria-hidden="true" className="absolute top-[26%] left-2 size-2 rounded-full bg-brand-stone/60 shadow-[inset_0_1px_1px_rgba(0,0,0,0.5)] sm:left-3" />
                      <span aria-hidden="true" className="absolute bottom-[26%] left-2 size-2 rounded-full bg-brand-stone/60 shadow-[inset_0_1px_1px_rgba(0,0,0,0.5)] sm:left-3" />

                      <span className="text-shadow-logo font-display text-[clamp(1.3rem,2.1vw,1.9rem)] leading-[1.1] text-brand-cream">{item.q}</span>
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 right-10 -translate-y-1/2 font-display text-[2rem] leading-none text-brand-warm transition-transform duration-500 ease-expo-out group-aria-expanded:rotate-45"
                      >
                        +
                      </span>
                    </button>
                  </h3>

                  <div
                    id={`faq-a-${item.id}`}
                    role="region"
                    aria-labelledby={`faq-q-${item.id}`}
                    inert={!isOpen}
                    className={`grid transition-[grid-template-rows] duration-700 ease-expo-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    <div className="overflow-hidden">
                      {/* a paper note, pinned under the plank */}
                      <div className="px-3 pt-5 pb-6 sm:pl-8">
                        <div className="relative max-w-[34rem] -rotate-[0.6deg] rounded-[4px] bg-brand-cream px-7 pt-8 pb-6 shadow-[0_24px_30px_-22px_color-mix(in_srgb,var(--color-brand-forest)_70%,black)]">
                          <span aria-hidden="true" className="absolute -top-2 left-8 size-4 rounded-full bg-brand-warm shadow-[inset_-1px_-2px_2px_rgba(0,0,0,0.3),0_3px_5px_rgba(0,0,0,0.35)]" />
                          <p className="text-[17px] leading-relaxed text-pretty text-brand-forest">{item.a}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
