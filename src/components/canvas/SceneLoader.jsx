"use client";

import dynamic from "next/dynamic";

// WebGL needs the browser, so the canvas is never server rendered.
const Scene = dynamic(() => import("./Scene"), { ssr: false });

// Thin wrapper. It accepts and ignores any props (the old HeroShell still passes onReady),
// so callers can be migrated at their own pace.
export default function SceneLoader() {
  return <Scene />;
}
