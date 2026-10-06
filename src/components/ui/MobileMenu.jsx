"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startScroll, stopScroll } from "@/lib/lenis";
import { LAYERS } from "@/lib/layers";
import Wordmark from "./Wordmark";

const FOCUSABLE = "a[href], button:not([disabled])";

// Below 768px the nav links and the CTA live here. The toggle and the overlay share the menu
// layer, so the toggle always stays above the overlay and can close it. It is a disclosure (a
// button with aria-expanded controlling a nav panel). While open, the header and the page behind
// are inert, so focus and assistive tech stay on the menu.
export default function MobileMenu({ links, cta }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Scroll lock (body overflow plus Lenis), page inert, Escape to close, Tab kept inside the menu,
  // auto-close if the viewport grows past 768px.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    stopScroll();
    const behind = document.querySelectorAll("header, main");
    behind.forEach((el) => el.setAttribute("inert", ""));

    // Visibility is already visible in this commit, so focus can move straight into the menu.
    const focusId = requestAnimationFrame(() => panelRef.current?.querySelector("a")?.focus());

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      // DOM order: the panel's links and CTA, then the toggle. Wrap at both ends.
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE), toggleRef.current];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const media = window.matchMedia("(min-width: 768px)");
    const onMedia = () => media.matches && setOpen(false);

    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onMedia);
    return () => {
      cancelAnimationFrame(focusId);
      document.body.style.overflow = previousOverflow;
      startScroll();
      behind.forEach((el) => el.removeAttribute("inert"));
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onMedia);
    };
  }, [open, close]);

  // Each line reveals a beat after the last (reading order); reduced motion removes the transitions.
  const reveal = (index) => ({
    transitionDelay: open ? `${180 + index * 70}ms` : "0ms",
  });
  const revealClass = `transition-[opacity,translate] duration-700 ease-expo-out motion-reduce:transition-none ${
    open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
  }`;

  return (
    <div className="pointer-events-none fixed inset-0 md:hidden" style={{ zIndex: LAYERS.menu }}>
      <div
        id="mobile-menu"
        ref={panelRef}
        inert={!open}
        className={`absolute inset-0 flex flex-col overflow-y-auto overscroll-contain bg-brand-forest px-6 py-24 motion-reduce:transition-none ${
          // Visibility flips at once on open (so focus can move in) and only after the fade on close.
          open
            ? "pointer-events-auto visible opacity-100 transition-[opacity,visibility] [transition-duration:500ms,0s] ease-expo-out"
            : "invisible opacity-0 transition-[opacity,visibility] [transition-duration:500ms,0s] ease-expo-out [transition-delay:0s,0.5s]"
        }`}
      >
        {/* Wordmark stays put under the overlay so the brand mark never disappears */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-6 flex h-20 items-center font-display text-[1.6rem] leading-none text-brand-cream"
        >
          <Wordmark />
        </span>

        {/* my-auto centres the stack when it fits and lets the panel scroll when it does not */}
        <div className="my-auto">
        <nav aria-label="Mobile">
          <ul role="list" className="flex flex-col gap-2">
            {links.map((link, index) => (
              <li key={link.href} className={revealClass} style={reveal(index)}>
                <a
                  href={link.href}
                  onClick={close}
                  className="focus-ring block rounded-full py-2 font-display text-[2.5rem] leading-tight text-brand-cream transition-colors duration-500 ease-expo-out hover:text-brand-green-light [@media(max-height:480px)]:py-1 [@media(max-height:480px)]:text-[2rem]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={`mt-10 [@media(max-height:480px)]:mt-6 ${revealClass}`} style={reveal(links.length)}>
          <a
            href={cta.href}
            onClick={close}
            className="focus-ring inline-block rounded-full border border-brand-cream/40 px-6 py-3 text-[14px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,border-color,scale] duration-500 ease-expo-out hover:border-brand-cream/80 hover:bg-brand-green/20 active:scale-[0.98]"
          >
            {cta.label}
          </a>
        </div>
        </div>
      </div>

      {/* Toggle, right-aligned on the same 80px row as the logo. Two CSS lines morph into an X. */}
      <div data-intro="nav" className="absolute top-0 right-6 flex h-20 items-center">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label="Menu"
          onClick={() => (open ? close() : setOpen(true))}
          className="focus-ring pointer-events-auto relative size-11 rounded-full border border-brand-cream/40 transition-[background-color,border-color,scale] duration-500 ease-expo-out hover:border-brand-cream/80 hover:bg-brand-green/20 active:scale-[0.98] motion-reduce:transition-none"
        >
          <span
            aria-hidden="true"
            className={`absolute top-1/2 left-1/2 block h-px w-[18px] -translate-x-1/2 bg-brand-cream transition-transform duration-500 ease-expo-out motion-reduce:transition-none ${
              open ? "translate-y-0 rotate-45" : "-translate-y-[3px]"
            }`}
          />
          <span
            aria-hidden="true"
            className={`absolute top-1/2 left-1/2 block h-px w-[18px] -translate-x-1/2 bg-brand-cream transition-transform duration-500 ease-expo-out motion-reduce:transition-none ${
              open ? "translate-y-0 -rotate-45" : "translate-y-[3px]"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
