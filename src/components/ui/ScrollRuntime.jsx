"use client";

import { useEffect } from "react";
import { gsap } from "@/lib/gsap";
import { scrollState } from "@/lib/scroll/scrollStore";
import {
  SMOOTH_TAU,
  SMOOTH_TAU_REDUCED,
  createMotion,
  readMaxScroll,
  readTarget,
  sectionToGlobal,
  stepScroll,
  updateSections,
} from "@/lib/scroll/driver";
import { RUNWAY_VH, SECTIONS, TIMELINE } from "@/lib/sections";

// ---------------------------------------------------------------------------
// ScrollRuntime: the implementation behind <ScrollDriver /> (see ScrollDriver.jsx, which loads this file
// lazily so the sections config, three and the camera maths stay out of the first page bundle).
// It is the ONE writer of scrollState.
//
// Every frame (a gsap ticker callback, added after SmoothScroll's Lenis callback so Lenis has already
// moved the page): read window.scrollY, derive the raw target, step the damped progress, then publish
// the local progress of every section and the active section id. There are NO scroll event listeners:
// polling scrollY works the same with Lenis (smooth wheel) and without it (reduced motion, native
// scroll). Resize is handled by re-measuring the scrollable height (ResizeObserver plus the window
// resize event, which also catches mobile toolbar changes).
//
// Development only: window.__scrub(p | null), window.__sectionToGlobal(id, local); window.__cam() is
// installed by ScrollCameraRig. All of it sits behind process.env.NODE_ENV === "development", which
// the bundler folds to false, so none of it exists in a production bundle.
// ---------------------------------------------------------------------------
export default function ScrollRuntime() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tau = reduced ? SMOOTH_TAU_REDUCED : SMOOTH_TAU;
    const motion = createMotion();
    let maxScroll = readMaxScroll();
    let first = true;

    const measure = () => {
      maxScroll = readMaxScroll();
    };

    const tick = (_time, deltaTimeMs) => {
      const target = readTarget(window.scrollY, maxScroll);
      stepScroll(scrollState, motion, target, deltaTimeMs / 1000, tau, first);
      first = false;
      updateSections(scrollState, TIMELINE, scrollState.progress);
    };

    // Prime once so the very first rendered frame already has valid section progress.
    tick(0, 16.7);
    gsap.ticker.add(tick);

    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(document.documentElement);

    if (process.env.NODE_ENV === "development") {
      window.__scrub = (p) => {
        scrollState.override = p === null || p === undefined ? null : Math.min(1, Math.max(0, Number(p)));
        return scrollState.override;
      };
      window.__sectionToGlobal = (id, local) => sectionToGlobal(TIMELINE, id, local);
    }

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      if (process.env.NODE_ENV === "development") {
        delete window.__scrub;
        delete window.__sectionToGlobal;
        scrollState.override = null;
      }
    };
  }, []);

  return null;
}

// The scroll runway: an empty, tall block that gives the page its scroll distance. Its height is the
// total section length plus one viewport (the fixed stage fills the first viewport; the document can
// only scroll by its height minus the viewport). Lives here, a client component, so the page (a server
// component) never has to import the sections config.
export function ScrollRunway() {
  return <div aria-hidden="true" data-runway className="pointer-events-none w-full" style={{ height: `${RUNWAY_VH * 100}dvh` }} />;
}

// Mounts the HTML overlay of every section that has one, so adding a section never means editing the
// page. Each overlay reads scrollState itself (the same progress that drives the camera).
export function SectionOverlays() {
  return (
    <>
      {SECTIONS.map((section) => {
        const Overlay = section.overlay;
        return Overlay ? <Overlay key={section.id} /> : null;
      })}
    </>
  );
}
