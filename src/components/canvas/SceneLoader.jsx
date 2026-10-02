"use client";

import dynamic from "next/dynamic";

// WebGL needs the browser, so the canvas is never server rendered.
const Scene = dynamic(() => import("./Scene"), { ssr: false });

export default function SceneLoader({ onReady }) {
  return <Scene onReady={onReady} />;
}
