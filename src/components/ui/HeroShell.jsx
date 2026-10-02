"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import SceneLoader from "@/components/canvas/SceneLoader";
import Navbar from "./Navbar";
import HeroText from "./HeroText";
import ScrollIndicator from "./ScrollIndicator";

// Owns the hero: the 3D scene, the HTML overlay and the load-in choreography.
export default function HeroShell() {
  const root = useRef(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  // If WebGL is slow or unavailable, still reveal the copy after a few seconds.
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 4500);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const q = (name) => root.current.querySelectorAll(`[data-intro="${name}"]`);

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set("[data-curtain]", { autoAlpha: 0 });
        gsap.set(root.current.querySelectorAll("[data-intro]"), { autoAlpha: 1, y: 0, yPercent: 0 });
        return;
      }

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      // Curtain lifts to reveal the forest, with a slow settle on the camera feel.
      tl.to("[data-curtain]", { autoAlpha: 0, duration: 1.8, ease: "power2.inOut" })
        .fromTo(q("nav"), { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 1 }, 0.6)
        .fromTo(q("eyebrow"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.9)
        .to(q("line"), { yPercent: -110, duration: 1.3, stagger: 0.14, ease: "power4.out" }, 1.0)
        .fromTo(q("sub"), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 1 }, 1.7)
        .fromTo(q("cta"), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 1 }, 1.9)
        .fromTo(q("scroll"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2 }, 2.4);

      // As the visitor starts scrolling, the copy drifts up and fades so the camera takes over.
      gsap.to("[data-hero-text]", {
        autoAlpha: 0,
        y: -60,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: "+=45%", scrub: true },
      });
      gsap.to(q("scroll"), {
        autoAlpha: 0,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: "+=15%", scrub: true },
      });
    }, root);

    return () => ctx.revert();
  }, [ready]);

  // Keep ScrollTrigger measurements right after fonts and layout settle.
  useEffect(() => {
    const id = setTimeout(() => ScrollTrigger.refresh(), 500);
    return () => clearTimeout(id);
  }, []);

  return (
    <div ref={root} id="top" className="relative">
      <SceneLoader onReady={onReady} />

      {/* Left-side scrim keeps the headline readable over the bright mist */}
      <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-t from-[#0d1708]/75 via-[#0d1708]/10 to-transparent md:bg-gradient-to-r md:from-[#0d1708]/70 md:via-[#0d1708]/20 md:to-transparent" />

      <Navbar />
      <HeroText />
      <ScrollIndicator />

      {/* Opening curtain, lifted by the load-in timeline */}
      <div data-curtain className="pointer-events-none fixed inset-0 z-40 bg-[#0d1708]" />
    </div>
  );
}
