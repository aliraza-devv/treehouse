import Lenis from "lenis";
import { gsap, ScrollTrigger } from "@/lib/gsap";

// Creates the one Lenis instance, driven by the GSAP ticker so ScrollTrigger and the scroll driver (src/lib/scroll)
// stay in step with it. Returns a destroy function.
let instance = null;

// Pause and resume smooth scrolling (the mobile menu uses this: Lenis drives window.scrollTo,
// which an overflow:hidden body alone does not stop).
export function stopScroll() {
  instance?.stop();
}

export function startScroll() {
  instance?.start();
}

export function initLenis() {
  const lenis = new Lenis({
    // lerp mode: every frame the page moves a fixed share (9 percent) of the remaining distance to where the wheel
    // pointed. Unlike a fixed duration it is frame rate independent, never restarts an animation on each wheel tick
    // and feels continuous however fast the wheel is spun, which is what reads as "buttery".
    lerp: 0.09,
    wheelMultiplier: 0.95,
    smoothWheel: true,
    // Touch screens keep their own native momentum scrolling (it is already smooth and tracks the finger).
    syncTouch: false,
    // Navbar links (#about, #products ...) glide to their section instead of jumping.
    anchors: true,
    // Driven by the GSAP ticker below, not by its own requestAnimationFrame loop.
    autoRaf: false,
  });
  instance = lenis;
  lenis.on("scroll", ScrollTrigger.update);

  // GSAP ticker time is in seconds, Lenis expects milliseconds.
  const tick = (time) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  // A long frame must not be "caught up" by GSAP: it would hand Lenis one huge time step and the page would lurch.
  gsap.ticker.lagSmoothing(0);

  return () => {
    gsap.ticker.remove(tick);
    lenis.destroy();
    if (instance === lenis) instance = null;
  };
}
