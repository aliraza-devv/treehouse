"use client";

import dynamic from "next/dynamic";
import { hasWebGL } from "@/lib/hasWebGL";

const loadScene = () => import("./Scene");

// Start the download of the 3D scene the moment this file is evaluated (the start of hydration), not after the whole page has
// hydrated and the canvas boundary has mounted: the scene code (three, the post stack, the hero) is the biggest thing the
// loader waits for, so every millisecond it starts earlier is a millisecond off the loader. A device without WebGL never asks.
if (typeof window !== "undefined" && hasWebGL()) loadScene();

// WebGL needs the browser, so the canvas is never server rendered.
const Scene = dynamic(loadScene, { ssr: false });

// Thin wrapper. It accepts and ignores any props (the old HeroShell still passes onReady),
// so callers can be migrated at their own pace.
export default function SceneLoader() {
  return <Scene />;
}
