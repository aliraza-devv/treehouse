"use client";

import { useEffect } from "react";
import { afterFontsReady, gsap } from "@/lib/gsap";
import { LAYERS } from "@/lib/layers";
import MobileMenu from "./MobileMenu";

const LINKS = [
  { label: "About", href: "#about" },
  { label: "Products", href: "#products" },
  { label: "Projects", href: "#projects" },
  { label: "Commercial", href: "#commercial" },
  { label: "Reviews", href: "#reviews" },
];

const CTA = { label: "Start Project", href: "#contact" };

// Fixed, fully transparent bar. Logo left, links centre, one CTA right (below 768px the links
// and the CTA live in the menu instead). A 120px forest gradient behind it keeps text legible.
export default function Navbar() {
  useEffect(() => {
    // Reduced motion: CSS already shows the final state.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx;
    const cancel = afterFontsReady(() => {
      ctx = gsap.context(() => {
        // A gentle fade, no movement: the bar is chrome, the heading is the story.
        gsap.fromTo('[data-intro="nav"]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, delay: 0.4, ease: "power2.out" });
      });
    });

    return () => {
      cancel();
      ctx?.revert();
    };
  }, []);

  return (
    <>
      <header
        data-intro="nav"
        className="fixed inset-x-0 top-0 flex h-20 items-center justify-between px-6 md:grid md:grid-cols-[1fr_auto_1fr] md:px-8 lg:px-16"
        style={{ zIndex: LAYERS.nav }}
      >
        {/* Legibility gradient, behind the bar's content, never intercepts the pointer */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120px] bg-gradient-to-b from-brand-forest/40 to-transparent"
        />

        <a
          href="#top"
          className="text-shadow-logo focus-ring justify-self-start whitespace-nowrap rounded-sm font-display text-[1.6rem] leading-none font-medium md:text-[1.4rem] lg:text-[1.6rem] text-brand-cream"
        >
          Treehouse Life
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-4 md:flex lg:gap-10">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-ring rounded-sm py-2 text-[14px] font-normal tracking-[0.5px] text-brand-cream/80 transition-colors duration-500 ease-expo-out hover:text-brand-cream"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a
          href={CTA.href}
          className="focus-ring hidden justify-self-end rounded-full border border-brand-cream/40 px-5 py-2 text-[13px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,border-color,transform] duration-500 ease-expo-out hover:border-brand-cream/80 hover:bg-brand-green/20 active:scale-[0.98] md:inline-block"
        >
          {CTA.label}
        </a>
      </header>

      <MobileMenu links={LINKS} cta={CTA} />
    </>
  );
}
