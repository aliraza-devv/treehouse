"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LAYERS } from "@/lib/layers";

const FOCUSABLE = "a[href], button:not([disabled])";

// Below 768px the nav links and the CTA live here. The toggle and the overlay share the menu
// layer, so the toggle always stays above the overlay and can close it.
export default function MobileMenu({ links, cta }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Body scroll lock, Escape to close, focus trap, auto-close if the viewport grows past 768px.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("a")?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the toggle plus the overlay's links.
      const items = [toggleRef.current, ...panelRef.current.querySelectorAll(FOCUSABLE)];
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onMedia);
    };
  }, [open, close]);

  // Each line reveals a beat after the last (reading order); reduced motion removes the transitions.
  const reveal = (index) => ({
    transitionDelay: open ? `${180 + index * 70}ms` : "0ms",
  });
  const revealClass = `transition-[opacity,transform] duration-700 ease-expo-out motion-reduce:transition-none ${
    open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
  }`;

  return (
    <div className="pointer-events-none fixed inset-0 md:hidden" style={{ zIndex: LAYERS.menu }}>
      <div
        id="mobile-menu"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        inert={!open}
        className={`absolute inset-0 flex flex-col justify-center bg-brand-forest px-6 transition-[opacity,visibility] duration-500 ease-expo-out motion-reduce:transition-none ${
          open ? "pointer-events-auto visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <nav aria-label="Mobile">
          <ul className="flex flex-col gap-2">
            {links.map((link, index) => (
              <li key={link.href} className={revealClass} style={reveal(index)}>
                <a
                  href={link.href}
                  onClick={close}
                  className="focus-ring block rounded-sm py-2 font-display text-[2.5rem] leading-tight font-medium text-brand-cream transition-colors duration-500 ease-expo-out hover:text-brand-green-light"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={`mt-10 ${revealClass}`} style={reveal(links.length)}>
          <a
            href={cta.href}
            onClick={close}
            className="focus-ring inline-block rounded-full border border-brand-cream/40 px-6 py-3 text-[14px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,border-color,transform] duration-500 ease-expo-out hover:border-brand-cream/80 hover:bg-brand-green/20 active:scale-[0.98]"
          >
            {cta.label}
          </a>
        </div>
      </div>

      {/* Toggle, right-aligned on the same 80px row as the logo. Two CSS lines morph into an X. */}
      <div data-intro="nav" className="absolute top-0 right-6 flex h-20 items-center">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => (open ? close() : setOpen(true))}
          className="focus-ring pointer-events-auto relative size-11 rounded-full border border-brand-cream/40 transition-[background-color,border-color,transform] duration-500 ease-expo-out hover:border-brand-cream/80 hover:bg-brand-green/20 active:scale-[0.98] motion-reduce:transition-none"
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
