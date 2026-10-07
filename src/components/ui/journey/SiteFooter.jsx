"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { CONTACT, CTA_LABEL, ENQUIRY_HREF } from "@/lib/site";
import { Grain } from "./backdrops";
import FooterWordmark from "./FooterWordmark";

// THE FOOTER is the ground. The page climbs from the ground to the canopy, and it ends where the ladder above it stands: the
// page's green with a hand-drawn ground line along its top (a few blades of grass and two stones; the ladder in the invitation
// has its foot on it), and everything else is under it, below the surface. There is no picture.
//
// Two things, and nothing between them: the ways round the page, set as large as the headings (they roll to the warm colour on
// hover, and the others stand back), with how to reach us beside them; and under them the name, as big as the page allows, up out
// of the ground like shoots (FooterWordmark.jsx). The credits the licences ask for are the last line: the Pexels photographs, and
// the CC BY 4.0 child model.
//
// Motion: the links rise out of their masks as the footer arrives, the way every heading on the page does, and the rest follows.
// Reduced motion: it is simply there.
const LINKS = [
  { label: "About", href: "#about" },
  { label: "Products", href: "#products" },
  { label: "Projects", href: "#projects" },
  { label: "Reviews", href: "#reviews" },
  { label: "Questions", href: "#faq" },
];

// A word that rolls up and out as the warm copy of it rolls in from below (hover and keyboard focus). The motion on arrival is on
// the middle wrapper, so it never fights the roll.
function Roll({ children }) {
  return (
    <span className="relative block overflow-hidden">
      <span data-roll className="block">
        <span className="block transition-transform duration-500 ease-expo-out group-hover:-translate-y-full group-focus-visible:-translate-y-full">{children}</span>
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 block translate-y-full text-brand-warm transition-transform duration-500 ease-expo-out group-hover:translate-y-0 group-focus-visible:translate-y-0"
      >
        {children}
      </span>
    </span>
  );
}

export default function SiteFooter() {
  const root = useRef(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current;
      gsap
        .timeline({ scrollTrigger: { trigger: el.querySelector("nav"), start: "top 88%", once: true } })
        .from(el.querySelectorAll("[data-roll]"), { yPercent: 110, duration: 1.2, ease: "expoOut", stagger: 0.08 })
        .from(el.querySelectorAll("[data-fade]"), { autoAlpha: 0, y: 14, duration: 0.9, ease: "expoOut", stagger: 0.1 }, 0.3);
    });
    return () => mm.revert();
  }, []);

  return (
    <footer ref={root} className="relative overflow-hidden bg-brand-forest">
      <Grain />

      {/* The ground line, with a few blades and two stones */}
      <svg aria-hidden="true" viewBox="0 0 1440 28" preserveAspectRatio="none" fill="none" strokeLinecap="round" className="pointer-events-none absolute inset-x-0 top-0 h-7 w-full overflow-visible">
        <path
          d="M0 6 C90 2 170 11 280 6 S470 1 590 7 S790 12 930 6 S1180 2 1300 7 S1400 9 1440 6"
          className="stroke-brand-cream/30"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M118 7 L114 -3 M126 7 L129 -5 M134 7 L139 -2 M402 5 L399 -4 M410 6 L413 -5 M646 8 L643 -1 M654 8 L657 -4 M1018 6 L1015 -3 M1027 6 L1030 -4 M1236 6 L1233 -3 M1244 6 L1248 -4 M1330 7 L1328 -2 M1338 7 L1341 -4"
          className="stroke-brand-cream/[0.22]"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M214 13 C216 9 224 9 226 13 C224 16 216 16 214 13 M760 14 C762 11 768 11 770 14 C768 17 762 17 760 14"
          className="stroke-brand-cream/[0.18]"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="relative mx-auto grid max-w-[1400px] gap-14 px-6 pt-[14vh] pb-[9vh] md:px-8 lg:grid-cols-12 lg:gap-x-10 lg:px-16">
        {/* The ways round the page, large. Hover one and the rest stand back. */}
        <nav aria-label="Footer" className="lg:col-span-7">
          <ul role="list" className="flex flex-col [&:hover>li:not(:hover)]:opacity-40 [&:focus-within>li:not(:focus-within)]:opacity-40">
            {LINKS.map((link) => (
              <li key={link.href} className="transition-opacity duration-500 ease-expo-out">
                <a
                  href={link.href}
                  className="group focus-ring block w-fit font-display text-[clamp(2.4rem,4.6vw,4.3rem)] leading-[1.2] text-brand-cream"
                >
                  <Roll>{link.label}</Roll>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* How to reach us, and the one button */}
        <div className="flex flex-col gap-9 lg:col-span-4 lg:col-start-9 lg:self-end">
          <p data-fade className="max-w-[24rem] text-[17px] leading-relaxed text-pretty text-brand-cream/80">
            Treehouses, rope bridges, treetop walkways and nest swings, designed and built in the UK.
          </p>

          <div data-fade className="flex flex-col gap-2 text-[19px] font-medium text-brand-cream">
            <a
              href={`mailto:${CONTACT.email}`}
              className="focus-ring w-fit underline decoration-brand-cream/35 underline-offset-[7px] transition-[text-decoration-color] duration-300 hover:decoration-brand-warm"
            >
              {CONTACT.email}
            </a>
            <a
              href={CONTACT.phoneHref}
              className="focus-ring w-fit underline decoration-brand-cream/35 underline-offset-[7px] transition-[text-decoration-color] duration-300 hover:decoration-brand-warm"
            >
              {CONTACT.phone}
            </a>
          </div>

          <div data-fade className="flex items-center justify-between gap-6">
            <a
              href={ENQUIRY_HREF}
              className="group focus-ring inline-flex h-12 items-center gap-3 rounded-full border border-brand-cream/45 px-7 text-[15px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,border-color,scale] duration-500 ease-expo-out hover:border-brand-cream hover:bg-brand-cream/10 active:scale-[0.98]"
            >
              {CTA_LABEL}
              <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:translate-x-1">
                →
              </span>
            </a>

            <a href="#top" aria-label="Back to the top" className="group focus-ring grid size-12 shrink-0 place-items-center rounded-full border border-brand-cream/45 text-lg text-brand-cream transition-[background-color] duration-500 ease-expo-out hover:bg-brand-cream/10">
              <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:-translate-y-1">
                ↑
              </span>
            </a>
          </div>
        </div>
      </div>

      {/* The name, up out of the ground */}
      <div className="relative px-3 md:px-5">
        <FooterWordmark />
      </div>

      <div className="relative mt-3 border-t border-brand-cream/10">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-6 py-6 text-xs leading-relaxed text-brand-cream/70 md:flex-row md:justify-between md:px-8 lg:px-16">
          <p>© {year} Treehouse Life</p>
          <p>
            Photography from{" "}
            <a href="https://www.pexels.com" className="focus-ring underline" target="_blank" rel="noopener noreferrer">
              Pexels
            </a>
            . Child model based on{" "}
            <a
              href="https://sketchfab.com/3d-models/fhc-crying-child-b60b17251195459e95c60d8992139a0c"
              className="focus-ring underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              FHC: Crying Child
            </a>{" "}
            by Speed F1, licensed under{" "}
            <a href="http://creativecommons.org/licenses/by/4.0/" className="focus-ring underline" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
