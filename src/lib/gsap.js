import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Register plugins once, client side only. Import gsap from here, not from "gsap".
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, CustomEase);
  // Same curve as the --ease-expo-out CSS token: fast start, long soft landing.
  CustomEase.create("expoOut", "0.16, 1, 0.3, 1");
}

// Runs `start` once web fonts are ready and the browser has painted twice, so a font
// swap cannot cause layout jank mid-animation. Returns a cancel function.
export function afterFontsReady(start) {
  let cancelled = false;
  let raf1 = 0;
  let raf2 = 0;
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  fonts.then(() => {
    if (cancelled) return;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) start();
      });
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
  };
}

// Delay in seconds so an element lands `target` seconds after navigation start
// (performance.now() counts from navigation start). If the page is already later than
// `firstTarget`, the element keeps its offset from the first one so the reading
// sequence stays staggered instead of everything appearing at once.
export function delayFromLoad(target, firstTarget) {
  const elapsed = performance.now() / 1000;
  return Math.max(target - elapsed, target - firstTarget);
}

export { gsap, ScrollTrigger };
