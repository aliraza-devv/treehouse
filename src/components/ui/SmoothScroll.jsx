"use client";

import { useEffect } from "react";
import { initLenis } from "@/lib/lenis";

// Mounts Lenis once for the whole page (skipped for reduced-motion visitors).
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return initLenis();
  }, []);
  return null;
}
