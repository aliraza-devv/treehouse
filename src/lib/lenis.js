import Lenis from "lenis";
import { gsap, ScrollTrigger } from "@/lib/gsap";

// Creates a Lenis instance driven by the GSAP ticker so ScrollTrigger stays in sync.
// Returns a destroy function. The hero is viewport-locked, so nothing scrolls yet;
// this is wired now so the scroll-driven camera journey can plug in later.
export function initLenis() {
  const lenis = new Lenis({ duration: 1.25, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);

  // GSAP ticker time is in seconds, Lenis expects milliseconds.
  const tick = (time) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  return () => {
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}
