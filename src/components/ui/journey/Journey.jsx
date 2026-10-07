"use client";

import { useEffect } from "react";
import { ScrollTrigger, afterFontsReady } from "@/lib/gsap";
import { LAYERS } from "@/lib/layers";
import Audience from "./Audience";
import CanopyCurtain from "./CanopyCurtain";
import Faq from "./Faq";
import FinalCta from "./FinalCta";
import ProcessTrail from "./ProcessTrail";
import ProofBand from "./ProofBand";
import SiteFooter from "./SiteFooter";
import Statement from "./Statement";
import Testimonials from "./Testimonials";

// SECTION 3: everything after the climb. Unlike the camera sections it is ordinary page content that
// scrolls OVER the fixed 3D stage (see src/lib/sections/README.md, "Section 3"), so its text, links and
// anchors are real document content. The camera journey ends where the runway ends (readMaxScroll in
// src/lib/scroll/driver.js measures the runway only), holds its last frame for a short beat (the top
// margin), and then the canopy curtain rises over the stage.
//
//   canopy curtain   the parallax transition (CanopyCurtain.jsx)
//   [data-journey-body] solid forest from here down; Scene.jsx stops rendering the canvas once this is
//                       at the top of the viewport (it is fully covered, so the GPU is free for the page)
//   statement, process, audience, proof, what clients say, questions, the final invitation, footer
//
// Anchors for the navbar: #about (process), #products (audiences), #projects (proof), #reviews (what clients say), plus #faq and #contact. The navbar's Start Project
// button goes to ENQUIRY_HREF (src/lib/site.js).
export default function Journey() {
  // The runway (and so the page height) arrives after hydration, in its own lazy chunk, so every
  // ScrollTrigger below measured a shorter page. Re-measure once it exists, and again after fonts load.
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const poll = () => {
      if (cancelled) return;
      if (document.querySelector("[data-runway]")) ScrollTrigger.refresh();
      else timer = window.setTimeout(poll, 150);
    };
    poll();
    const cancelFonts = afterFontsReady(() => ScrollTrigger.refresh());
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelFonts();
    };
  }, []);

  return (
    <div data-journey className="relative mt-[30dvh]" style={{ zIndex: LAYERS.journey }}>
      <CanopyCurtain />
      <div data-journey-body className="relative bg-brand-forest">
        <Statement />
        <ProcessTrail />
        <Audience />
        <ProofBand />
        <Testimonials />
        <Faq />
        <FinalCta />
        <SiteFooter />
      </div>
    </div>
  );
}
