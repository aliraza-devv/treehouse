"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { AUDIENCES, CTA_LABEL, ENQUIRY_HREF } from "@/lib/site";
import { BoardsWall } from "./backdrops";
import Photo from "./Photo";
import { TIMBER_GRAIN } from "./timber";

// WHO IT IS FOR, told as a walk along a treetop walkway (the company builds them, and rope bridges, so the
// metaphor is its own). One timber beam runs the length of the page's horizontal track; each kind of project hangs
// from it on ropes: a photograph (all the same 4:5 shape, at different heights), and beside it a timber trail sign
// carrying the name and one sentence, with the three things built there hanging under the sign as paper tags on
// threads. The page pins while the track pans; everything hung SWINGS with the scroll speed (a pendulum from its
// hook on the beam, lagging the pan and settling when you stop), which is the one motion the metaphor asks for.
// Behind it all is the wall the walkway runs along: the page's green as painted boards, sliding slowly against the pan, so the walk has depth.
// The walkway ends with a blank cream sign that asks the question and carries the one button.
//
// Pinned (desktop, motion allowed): the wrapper pins at the top and the track translates by its overflow; each
// photo also slides inside its frame against the pan (containerAnimation), and each stop is lowered into place
// when it arrives. Otherwise (phones, reduced motion): the stops stack, still hung from short beams, and all
// of it is readable; phones fade each one in. The mode is a data attribute (data-pinned) on the wrapper, so the
// layout classes follow it (the `pinned:` variant, defined in globals.css, is "inside a pinned wrapper").

// How each stop hangs (all in dvh, so it fits any screen): drop is how far below the beam the photograph hangs,
// sdrop how far the sign hangs (the opposite way round, so they never line up), amp and samp how far each swings
// relative to the others (so nothing swings in step). Every photograph is the same shape and height.
const LAYOUT = {
  family: { drop: "6dvh", sdrop: "15dvh", amp: 1.1, samp: 0.8 },
  estate: { drop: "15dvh", sdrop: "5dvh", amp: 0.8, samp: 1.2 },
  resort: { drop: "4dvh", sdrop: "12dvh", amp: 1, samp: 0.9 },
  school: { drop: "11dvh", sdrop: "4dvh", amp: 1.25, samp: 1.05 },
};

// How long each tag's thread is (px): uneven, so the tags hang at three heights
const THREADS = [14, 34, 22];

// Tag labels that are shorter than the offer they come from, so the three tags always fit on one line
const TAG_LABEL = { "Treetop walkways": "Walkways" };

// A stretch of the timber beam across the top of a stop. Neighbouring stops touch, so the stretches join up.
function Beam() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-0 h-2.5 bg-gradient-to-b from-brand-timber to-brand-timber-dark shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-brand-warm)_50%,transparent),0_16px_26px_-12px_color-mix(in_srgb,var(--color-brand-forest)_70%,black)]"
    />
  );
}

// Two ropes from a hook on the beam to the top corners of what hangs (a V), with a bolt at each corner. The SVG is as
// tall as the drop (the class says which); all the coordinates are percentages, so it stretches with the width.
function Ropes({ className }) {
  return (
    <svg aria-hidden="true" className={`pointer-events-none absolute top-0 left-0 w-full overflow-visible stroke-brand-stone/70 ${className}`}>
      <line x1="50%" y1="0" x2="14%" y2="100%" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="50%" y1="0" x2="86%" y2="100%" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14%" cy="100%" r="3.5" className="fill-brand-timber stroke-none" />
      <circle cx="86%" cy="100%" r="3.5" className="fill-brand-timber stroke-none" />
      <circle cx="50%" cy="0" r="5" strokeWidth="2" className="fill-brand-warm stroke-brand-timber-dark" />
    </svg>
  );
}

export default function Audience() {
  const wrap = useRef(null);
  const track = useRef(null);
  const fill = useRef(null);
  const count = useRef(null);

  useEffect(() => {
    const w = wrap.current;
    const t = track.current;
    const stops = gsap.utils.toArray("[data-stop]", t);
    const hangs = gsap.utils.toArray("[data-hang]", t);
    const layers = gsap.utils.toArray("[data-layer]", w).map((el) => ({ el, factor: parseFloat(el.dataset.layer) }));
    const mm = gsap.matchMedia();

    // The stops and the sign come down the same way: lowered on their ropes, the picture wiping in from the top.
    const arrive = (stop, scrollTrigger) => {
      const frame = stop.querySelector("[data-frame][data-wipe]");
      const photo = stop.querySelector("[data-shift] img");
      const tl = gsap.timeline({ scrollTrigger });
      tl.from(stop.querySelectorAll("[data-hang]"), { y: -70, autoAlpha: 0, duration: 1, ease: "expoOut", stagger: 0.12 }, 0);
      if (frame) {
        tl.fromTo(frame, { clipPath: "inset(0% 0% 100% 0% round 28px)" }, { clipPath: "inset(0% 0% 0% 0% round 28px)", duration: 1.3, ease: "expoOut" }, 0.1);
      }
      if (photo) tl.from(photo, { scale: 1.3, duration: 1.8, ease: "expoOut" }, 0.1);
      const rise = stop.querySelectorAll("[data-rise]");
      if (rise.length) tl.from(rise, { yPercent: 110, duration: 1.1, ease: "expoOut", stagger: 0.08 }, 0.4);
      const fade = stop.querySelectorAll("[data-fade]");
      if (fade.length) tl.from(fade, { autoAlpha: 0, y: 18, duration: 0.9, ease: "expoOut", stagger: 0.1 }, 0.6);
      return tl;
    };

    mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      w.dataset.pinned = "true"; // the layout switches to a single row BEFORE the trigger measures it
      const travel = () => Math.max(0, t.offsetWidth - w.clientWidth);
      let shown = -1;

      // Swing: scrolling forward drags the hung things' bottoms backwards (they lag the pan), so each leans against the
      // direction of travel by up to about 3.5 degrees, then rings down to rest with an elastic ease once the scroll
      // slows. Each has its own amplitude. "auto" overwrite so it only replaces the rotation, not the arrival.
      const settle = gsap.delayedCall(0.12, () => {
        gsap.to(hangs, { rotation: 0, duration: 2.8, ease: "elastic.out(1, 0.26)", stagger: 0.05, overwrite: "auto" });
      });

      const tween = gsap.to(t, {
        x: () => -travel(),
        ease: "none",
        scrollTrigger: {
          trigger: w,
          start: "top top",
          end: () => `+=${travel()}`,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (fill.current) fill.current.style.transform = `scaleX(${self.progress.toFixed(3)})`;

            // The wall drifts by a fraction of the pan
            const shift = self.progress * travel();
            layers.forEach(({ el, factor }) => {
              el.style.transform = `translate3d(${(-shift * factor).toFixed(1)}px, 0, 0)`;
            });

            // Which stop is nearest the middle of the screen
            const middle = -gsap.getProperty(t, "x") + w.clientWidth / 2;
            let nearest = 0;
            let best = Infinity;
            stops.slice(0, AUDIENCES.length).forEach((stop, i) => {
              const gap = Math.abs(stop.offsetLeft + stop.offsetWidth / 2 - middle);
              if (gap < best) {
                best = gap;
                nearest = i;
              }
            });
            if (nearest !== shown && count.current) {
              shown = nearest;
              count.current.textContent = String(nearest + 1).padStart(2, "0");
            }

            const lean = gsap.utils.clamp(-1, 1, self.getVelocity() / 2400);
            gsap.to(hangs, { rotation: (i) => -lean * 3.5 * (hangs[i].dataset.amp ?? 1), duration: 0.5, ease: "power3.out", overwrite: "auto" });
            settle.restart(true);
          },
        },
      });

      // Depth: while a stop crosses the screen its photograph slides against the pan, inside the frame.
      stops.forEach((stop) => {
        const shift = stop.querySelector("[data-shift]");
        if (!shift) return;
        gsap.fromTo(
          shift,
          { xPercent: 7 },
          { xPercent: -7, ease: "none", scrollTrigger: { trigger: stop, containerAnimation: tween, start: "left right", end: "right left", scrub: true } },
        );
      });

      // Arrival. A stop already on screen when the walkway pins arrives as the section scrolls in; the rest arrive
      // as the pan brings them to 82 percent of the screen width.
      stops.forEach((stop) => {
        const onScreen = stop.getBoundingClientRect().left < window.innerWidth * 0.8;
        arrive(
          stop,
          onScreen
            ? { trigger: w, start: "top 68%", toggleActions: "play none none reverse" }
            : { trigger: stop, containerAnimation: tween, start: "left 82%", toggleActions: "play none none reverse" },
        );
      });

      // The intro: the heading rises line by line, then the arrow draws itself
      const intro = w.querySelector("[data-intro]");
      gsap
        .timeline({ scrollTrigger: { trigger: w, start: "top 68%", toggleActions: "play none none reverse" } })
        .from(intro.querySelectorAll("[data-rise]"), { yPercent: 110, duration: 1.3, ease: "expoOut", stagger: 0.12 }, 0)
        .fromTo(intro.querySelectorAll("[data-draw]"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut", stagger: 0.25 }, 0.7)
        .from(intro.querySelectorAll("[data-fade]"), { autoAlpha: 0, x: -10, duration: 0.8, ease: "expoOut" }, 1.2);

      return () => {
        delete w.dataset.pinned;
        layers.forEach(({ el }) => {
          el.style.transform = "";
        });
      };
    });

    mm.add("(max-width: 767px) and (prefers-reduced-motion: no-preference)", () => {
      stops.forEach((stop) => {
        gsap.from(stop, {
          autoAlpha: 0,
          y: 56,
          duration: 1,
          ease: "expoOut",
          scrollTrigger: { trigger: stop, start: "top 86%", toggleActions: "play none none reverse" },
        });
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={wrap}
      id="products"
      aria-labelledby="audience-title"
      className="group/aud relative overflow-x-clip py-[12vh] data-[pinned=true]:flex data-[pinned=true]:h-[100dvh] data-[pinned=true]:items-start data-[pinned=true]:py-0"
    >
      <BoardsWall />

      <div
        ref={track}
        className="relative z-10 flex flex-col gap-24 group-data-[pinned=true]/aud:h-full group-data-[pinned=true]/aud:w-max group-data-[pinned=true]/aud:flex-row group-data-[pinned=true]/aud:items-start group-data-[pinned=true]/aud:gap-0 group-data-[pinned=true]/aud:pt-[14dvh]"
      >
        {/* The way in: the question, and a hand-drawn arrow pointing down the walkway */}
        <div data-intro className="relative shrink-0 px-6 pt-20 pinned:w-[min(70vw,72rem)] pinned:pt-[11dvh] pinned:pr-[4vw] pinned:pl-16">
          <Beam />
          <h2 id="audience-title" className="text-shadow-big font-display text-[clamp(2.8rem,6.4vw,7rem)] leading-[1] text-brand-cream">
            {["Made for the way", "you will use it."].map((line) => (
              <span key={line} className="block overflow-hidden pb-[0.1em]">
                <span data-rise className="block">
                  {line}
                </span>
              </span>
            ))}
          </h2>
          <div aria-hidden="true" className="mt-8 hidden items-center gap-4 group-data-[pinned=true]/aud:flex">
            <svg viewBox="0 0 140 44" className="h-11 w-36 fill-none stroke-brand-warm" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path data-draw d="M4 30 C36 6 86 2 128 22" pathLength="1" style={{ strokeDasharray: 1 }} />
              <path data-draw d="M110 8 L130 23 L108 36" pathLength="1" style={{ strokeDasharray: 1 }} />
            </svg>
            <span data-fade className="font-hand text-[1.7rem] leading-none text-brand-cream/75">
              four kinds of place
            </span>
          </div>
        </div>

        {AUDIENCES.map((audience) => {
          const look = LAYOUT[audience.id];
          const offers = audience.offers
            .split(", ")
            .map((offer) => offer.charAt(0).toUpperCase() + offer.slice(1))
            .map((offer) => TAG_LABEL[offer] ?? offer);
          return (
            <article
              key={audience.id}
              data-stop
              style={{ "--drop": look.drop, "--sdrop": look.sdrop }}
              className="relative flex shrink-0 flex-col gap-10 px-6 pt-16 pinned:flex-row pinned:items-start pinned:gap-[2.5vw] pinned:px-[2.5vw] pinned:pt-0"
            >
              <Beam />

              {/* The photograph: ropes and picture swing together from the hook on the beam */}
              <div
                data-hang
                data-amp={look.amp}
                className="relative z-10 mt-[5px] w-full max-w-[32rem] origin-top pt-10 pinned:w-auto pinned:max-w-none pinned:pt-(--drop)"
              >
                <Ropes className="h-10 pinned:h-(--drop)" />
                <div
                  data-frame
                  data-wipe="true"
                  className="relative aspect-[4/5] w-full overflow-hidden rounded-[28px] bg-brand-forest ring-1 ring-brand-cream/10 shadow-[0_44px_60px_-34px_color-mix(in_srgb,var(--color-brand-forest)_30%,black)] pinned:h-[50dvh] pinned:w-auto"
                >
                  {/* The photograph is wider than the frame so it can slide inside it */}
                  <div data-shift className="absolute inset-y-0 -left-[9%] w-[118%]">
                    <Photo
                      name={audience.photo}
                      eager
                      fetchPriority="low"
                      sizes="(min-width: 768px) 30vw, 100vw"
                      className={`h-full w-full object-cover ${audience.mono ? "photo-grade-mono" : ""}`}
                    />
                  </div>
                </div>
              </div>

              {/* The trail sign: a timber board with the name and one sentence, and the three things built here hanging
                  under it as paper tags on threads. (Ropes only show while the page is pinned; stacked, it is a plain block.) */}
              <div
                data-hang
                data-amp={look.samp}
                className="relative z-10 mt-[5px] w-full max-w-[26rem] origin-top pinned:w-[min(26vw,24rem)] pinned:min-w-[15rem] pinned:pt-(--sdrop)"
              >
                <Ropes className="hidden pinned:block pinned:h-(--sdrop)" />
                <div
                  className={`relative rounded-[4px] bg-brand-timber-dark px-6 pt-6 pb-7 ring-1 ring-brand-timber/40 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-brand-warm)_32%,transparent),0_34px_46px_-30px_color-mix(in_srgb,var(--color-brand-forest)_30%,black)] ${TIMBER_GRAIN}`}
                >
                  <h3 className="overflow-hidden pb-[0.1em]">
                    <span data-rise className="text-shadow-logo block font-display text-[clamp(2rem,2.7vw,3rem)] leading-[1.02] text-brand-cream">
                      {audience.name}
                    </span>
                  </h3>
                  <p data-fade className="mt-4 text-[15px] leading-relaxed text-pretty text-brand-cream/85">
                    {audience.body}
                  </p>
                </div>
                <ul data-fade role="list" className="flex flex-wrap items-start gap-2 px-3 pt-4 pinned:flex-nowrap pinned:justify-between pinned:gap-x-2 pinned:pt-0">
                  {offers.map((offer, i) => (
                    <li key={offer} className="flex flex-col items-center">
                      <span aria-hidden="true" className="hidden w-px bg-brand-stone/60 pinned:block" style={{ height: THREADS[i % THREADS.length] }} />
                      <span className="relative rounded-[4px] bg-brand-cream px-2.5 pt-4 pb-1.5 text-[12.5px] leading-none font-medium whitespace-nowrap text-brand-forest shadow-[0_14px_20px_-14px_color-mix(in_srgb,var(--color-brand-forest)_60%,black)]">
                        <span aria-hidden="true" className="absolute top-1.5 left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-brand-forest/30" />
                        {offer}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}

        {/* The end of the walkway: a blank sign, the question, and the one button */}
        <div
          data-stop
          style={{ "--drop": "9dvh" }}
          className="relative shrink-0 px-6 pt-16 pinned:w-[min(46vw,40rem)] pinned:pt-0 pinned:pr-[10vw] pinned:pl-[3vw]"
        >
          <Beam />
          <div data-hang data-amp="0.9" className="relative z-10 mt-[5px] w-full max-w-[26rem] origin-top pt-10 pinned:pt-(--drop)">
            <Ropes className="h-10 pinned:h-(--drop)" />
            <div
              data-frame
              className="relative rounded-[28px] bg-brand-cream p-8 text-brand-forest shadow-[0_44px_60px_-34px_color-mix(in_srgb,var(--color-brand-forest)_30%,black)] md:p-10"
            >
              <p className="overflow-hidden pb-[0.1em]">
                <span data-rise className="block font-display text-[clamp(2.2rem,3.2vw,3.4rem)] leading-[1.02]">
                  Where will yours go?
                </span>
              </p>
              <p data-fade className="mt-4 text-[16px] leading-relaxed text-pretty text-brand-forest/75">
                Tell us about your garden and the tree you have in mind.
              </p>
              <a
                data-fade
                href={ENQUIRY_HREF}
                className="group focus-ring mt-8 inline-flex h-14 items-center gap-3 rounded-full bg-brand-forest px-9 text-[15px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,scale] duration-500 ease-expo-out hover:bg-brand-moss active:scale-[0.98]"
              >
                {CTA_LABEL}
                <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:translate-x-1">
                  →
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Where you are on the walkway */}
      <div aria-hidden="true" className="pointer-events-none absolute right-8 bottom-8 z-10 hidden items-center gap-4 text-[13px] text-brand-cream/60 tabular-nums group-data-[pinned=true]/aud:flex">
        <span>
          <span ref={count}>01</span> / {String(AUDIENCES.length).padStart(2, "0")}
        </span>
        <div className="relative h-px w-24 bg-brand-cream/20">
          <div ref={fill} className="absolute -top-px left-0 h-[3px] w-full origin-left bg-brand-warm" style={{ transform: "scaleX(0)" }} />
        </div>
      </div>
    </section>
  );
}
