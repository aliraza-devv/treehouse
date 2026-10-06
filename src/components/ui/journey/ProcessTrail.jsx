"use client";

import { useEffect, useRef } from "react";
import { ScrollTrigger, gsap } from "@/lib/gsap";
import { STEPS } from "@/lib/site";
import { BoardsBackdrop } from "./backdrops";
import { LEAF_PATH } from "./canopy";
import Polaroid from "./Polaroid";

const SVG_NS = "http://www.w3.org/2000/svg";
const LEAF_CLASS =
  "origin-left scale-0 transition-[scale] duration-700 ease-expo-out motion-reduce:transition-none [transform-box:fill-box] data-[on=true]:scale-100";

// The step title with a hand-drawn underline under one word. The underline is a path of pathLength 1, so it
// can be drawn on with a dash offset of 1 to 0 whatever its size.
function Title({ title, mark }) {
  const at = title.indexOf(mark);
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      {/* the full stop stays with the marked words, so it can never wrap onto a line of its own */}
      <span className="whitespace-nowrap">
      <span className="relative inline-block">
        {mark}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 14"
          preserveAspectRatio="none"
          className="pointer-events-none absolute -bottom-2 left-0 h-3 w-full overflow-visible text-brand-warm"
        >
          <path
            data-draw
            pathLength="1"
            strokeDasharray="1"
            d="M2 9 C 18 3, 34 13, 52 7 S 84 4, 98 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {title.slice(at + mark.length)}
      </span>
    </>
  );
}

// HOW IT WORKS, as a build journal. A vine grows down the page at the speed of your scroll (state: where you
// are in the process), sprouts a leaf every so often and opens a bud at each step. Each step is a photo
// pinned up with tape that "develops" (black and white and blurred, then colour) as it arrives, a
// handwritten caption, a hand-drawn underline and an arrow that draw themselves on. The play is the point:
// this is the part of the page that says "we are people who like making things".
//
// The vine is rebuilt in real pixels on every ScrollTrigger refresh (viewBox = the list's size), so nothing is
// stretched; its y only ever increases, so a bud's place on it is found by bisection on y. Reduced motion:
// the vine is fully drawn with every bud and leaf open, and nothing moves.
export default function ProcessTrail() {
  const sec = useRef(null);
  const list = useRef(null);
  const svg = useRef(null);
  const base = useRef(null);
  const draw = useRef(null);
  const leaves = useRef(null);
  const dot = useRef(null);
  const buds = useRef([]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const listEl = list.current;
    const svgEl = svg.current;
    const drawEl = draw.current;
    const leavesEl = leaves.current;
    const items = Array.from(listEl.querySelectorAll("[data-step]"));
    let length = 0;
    let stepAt = [];
    let leafAt = [];
    let leafEls = [];
    let progress = reduced ? 1 : 0;

    const paint = () => {
      drawEl.style.strokeDashoffset = String(length * (1 - progress));
      const tip = drawEl.getPointAtLength(length * progress);
      dot.current.setAttribute("cx", tip.x.toFixed(1));
      dot.current.setAttribute("cy", tip.y.toFixed(1));
      dot.current.style.opacity = reduced || progress <= 0 || progress >= 1 ? "0" : "1";
      const reach = progress * length;
      buds.current.forEach((bud, i) => {
        if (bud) bud.dataset.on = String(reach >= stepAt[i] - 1);
      });
      leafEls.forEach((leaf, i) => {
        leaf.dataset.on = String(reach >= leafAt[i]);
      });
    };

    const build = () => {
      const W = svgEl.clientWidth;
      const H = listEl.offsetHeight;
      if (!W || !H) return;
      svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
      // Sinuous vertical path: one S-curve per ~420 px, swinging to either side of the centre line.
      const cx = W / 2;
      const amp = W * 0.34;
      const segs = Math.max(2, Math.round(H / 420));
      let d = `M${cx},0`;
      for (let i = 0; i < segs; i++) {
        const y0 = (H * i) / segs;
        const y1 = (H * (i + 1)) / segs;
        const s = i % 2 ? -1 : 1;
        d += ` C${(cx + s * amp).toFixed(1)},${(y0 + (y1 - y0) * 0.33).toFixed(1)} ${(cx - s * amp).toFixed(1)},${(y0 + (y1 - y0) * 0.66).toFixed(1)} ${cx},${y1.toFixed(1)}`;
      }
      base.current.setAttribute("d", d);
      drawEl.setAttribute("d", d);
      length = drawEl.getTotalLength();
      drawEl.style.strokeDasharray = String(length);

      // Buds: where the vine passes each step's vertical centre.
      stepAt = items.map((item) => {
        const y = item.offsetTop + item.offsetHeight / 2;
        let lo = 0;
        let hi = length;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (drawEl.getPointAtLength(mid).y < y) lo = mid;
          else hi = mid;
        }
        return hi;
      });
      stepAt.forEach((at, i) => {
        const p = drawEl.getPointAtLength(at);
        buds.current[i]?.setAttribute("cx", p.x.toFixed(1));
        buds.current[i]?.setAttribute("cy", p.y.toFixed(1));
      });

      // Leaves: one every ~130 px along the vine, alternating sides, leaving it at an angle. Deterministic
      // sizes (no Math.random), so a rebuild gives the same vine.
      leavesEl.replaceChildren();
      leafAt = [];
      leafEls = [];
      for (let at = 90, k = 0; at < length - 40; at += 130, k++) {
        const p = drawEl.getPointAtLength(at);
        const q = drawEl.getPointAtLength(Math.min(length, at + 2));
        const tangent = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
        const side = k % 2 ? 1 : -1;
        const size = 1 + ((k * 37) % 10) / 22;
        const group = document.createElementNS(SVG_NS, "g");
        group.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(tangent + side * 64).toFixed(1)}) scale(${size.toFixed(2)})`);
        const leaf = document.createElementNS(SVG_NS, "path");
        leaf.setAttribute("d", LEAF_PATH);
        leaf.setAttribute("class", `${LEAF_CLASS} ${k % 3 === 0 ? "fill-brand-green-light" : "fill-brand-green"}`);
        leaf.dataset.on = "false";
        group.appendChild(leaf);
        leavesEl.appendChild(group);
        leafAt.push(at);
        leafEls.push(leaf);
      }
      paint();
    };

    build();
    ScrollTrigger.addEventListener("refreshInit", build);

    const ctx = gsap.context(() => {
      if (reduced) return;

      // The vine: progress is how far down the list the "reading line" (62 percent of the viewport) has got.
      ScrollTrigger.create({
        trigger: listEl,
        start: "top 62%",
        end: "bottom 62%",
        onUpdate: (self) => {
          progress = self.progress;
          paint();
        },
        onRefresh: (self) => {
          progress = self.progress;
          paint();
        },
      });

      items.forEach((item, i) => {
        const play = { trigger: item, start: "top 66%", toggleActions: "play none none reverse" };
        const polaroid = item.querySelector("[data-polaroid]");

        gsap.from(item.querySelector("[data-step-body]"), { autoAlpha: 0, y: 56, duration: 1.1, ease: "expoOut", scrollTrigger: play });

        // The photo is pinned up: it swings in from a bigger tilt and settles with a small overshoot.
        gsap.from(polaroid, { rotation: STEPS[i].tilt * -2.4, y: 110, autoAlpha: 0, scale: 0.9, duration: 1.3, ease: "back.out(1.5)", scrollTrigger: play });

        // ... and it develops: the paper-coloured layer over it fades away while the picture settles from a slight zoom.
        // Opacity and transform only: animating a blur filter repaints the photo every frame and made the scroll stutter.
        gsap.fromTo(polaroid.querySelector("[data-develop]"), { opacity: 0.92 }, { opacity: 0, duration: 1.8, delay: 0.25, ease: "power2.out", scrollTrigger: play });
        gsap.fromTo(polaroid.querySelector("img"), { scale: 1.08 }, { scale: 1, duration: 2.2, delay: 0.25, ease: "power2.out", scrollTrigger: play });

        // The photo floats slower than the page: a plane of depth.
        gsap.fromTo(
          item.querySelector("[data-float]"),
          { yPercent: -7 },
          { yPercent: 7, ease: "none", scrollTrigger: { trigger: item, start: "top bottom", end: "bottom top", scrub: true } },
        );

        // The underline and the arrow draw themselves on, shortly after the step arrives.
        item.querySelectorAll("[data-draw]").forEach((path) => {
          gsap.fromTo(path, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, delay: 0.6, ease: "power2.inOut", scrollTrigger: play });
        });
      });
    }, listEl);

    return () => {
      ScrollTrigger.removeEventListener("refreshInit", build);
      ctx.revert();
      leavesEl.replaceChildren();
    };
  }, []);

  return (
    <section ref={sec} id="about" aria-labelledby="process-title" className="relative px-6 py-[16vh] md:px-8 lg:px-16">
      <BoardsBackdrop />
      <h2
        id="process-title"
        className="relative max-w-4xl font-display text-[clamp(2.6rem,6vw,5.2rem)] leading-[1.04] tracking-normal text-balance text-brand-cream"
      >
        From first walk to first evening up there.
      </h2>

      <div className="relative mx-auto mt-[6vh] max-w-6xl">
        <svg
          ref={svg}
          aria-hidden="true"
          fill="none"
          className="pointer-events-none absolute inset-y-0 left-0 w-16 overflow-visible md:left-1/2 md:w-36 md:-translate-x-1/2"
        >
          <path ref={base} className="stroke-brand-cream/15" strokeWidth="2" />
          <path ref={draw} className="stroke-brand-green" strokeWidth="3" strokeLinecap="round" />
          <g ref={leaves} />
          {STEPS.map((step, i) => (
            <circle
              key={step.id}
              ref={(node) => {
                buds.current[i] = node;
              }}
              data-on="false"
              r="10"
              strokeWidth="2.5"
              className="origin-center scale-50 fill-brand-forest stroke-brand-green transition-[scale,fill,stroke] duration-700 ease-expo-out motion-reduce:transition-none [transform-box:fill-box] data-[on=true]:scale-100 data-[on=true]:fill-brand-warm data-[on=true]:stroke-brand-warm"
            />
          ))}
          <circle ref={dot} r="5" className="fill-brand-green-light transition-opacity duration-300" style={{ opacity: 0 }} />
        </svg>

        <ol ref={list} className="relative">
          {STEPS.map((step, i) => {
            const textRight = i % 2 === 0; // text on the left of the vine, right aligned, photo on the right
            return (
              <li
                key={step.id}
                data-step
                className="relative flex min-h-[90vh] flex-col justify-center gap-12 py-16 pl-16 md:grid md:grid-cols-2 md:items-center md:gap-0 md:py-0 md:pl-0"
              >
                {/* Text is always left aligned inside a block of one fixed width, so the left edges of all four
                    steps line up (right aligned lines had a ragged left edge). The block sits a fixed distance
                    from the vine on whichever side it is on. */}
                <div
                  data-step-body
                  className={`relative w-full max-w-[28rem] ${
                    textRight ? "md:col-start-1 md:row-start-1 md:mr-16 md:justify-self-end lg:mr-24" : "md:col-start-2 md:row-start-1 md:ml-16 lg:ml-24"
                  }`}
                >
                  <h3 className="font-display text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.06] text-brand-cream">
                    <Title title={step.title} mark={step.mark} />
                  </h3>
                  <p className="mt-5 max-w-[26rem] text-[17px] leading-relaxed text-pretty text-brand-cream/80">{step.body}</p>
                  {/* hand-drawn arrow from the words to the photo (desktop only) */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 130 56"
                    className={`mt-6 hidden h-14 w-32 text-brand-warm md:block ${textRight ? "" : "-scale-x-100"}`}
                  >
                    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path data-draw pathLength="1" strokeDasharray="1" d="M4 8 C 36 54, 92 52, 118 24" />
                      <path data-draw pathLength="1" strokeDasharray="1" d="M102 18 L120 22 L110 38" />
                    </g>
                  </svg>
                </div>

                <div
                  data-float
                  className={`relative ${
                    textRight ? "md:col-start-2 md:row-start-1 md:justify-self-start md:pl-24" : "md:col-start-1 md:row-start-1 md:justify-self-end md:pr-24"
                  }`}
                >
                  <Polaroid photo={step.photo} caption={step.caption} tilt={step.tilt} aspect={step.aspect} flip={!textRight} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
