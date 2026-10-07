"use client";

import dynamic from "next/dynamic";

// ---------------------------------------------------------------------------
// The page mounts these three; each loads the real implementation (ScrollRuntime.jsx) as a separate chunk
// after hydration, in parallel with the 3D scene chunk. Why: the implementation imports the sections
// config, which pulls in three and the camera maths. Importing it statically would put all of that in the
// first page bundle (and the server render), ahead of the hero text, for no benefit: nothing it does is
// visible before the first scroll. Same pattern as SceneLoader (the canvas is never server rendered).
//
//   <ScrollDriver />      the one writer of scrollState (polls window.scrollY each frame, damps, publishes
//                         section progress). Works with Lenis (smooth wheel) and with native scrolling.
//   <ScrollRunway />      the empty tall block that provides the scroll distance
//   <SectionOverlays />   the HTML copy of every registered section, mounted from the sections config
// ---------------------------------------------------------------------------
// The loader waits for the runway this chunk mounts, so start fetching it as soon as this file is evaluated rather than after the
// page has hydrated.
if (typeof window !== "undefined") import("./ScrollRuntime");

const Runtime = dynamic(() => import("./ScrollRuntime"), { ssr: false });
const Runway = dynamic(() => import("./ScrollRuntime").then((m) => m.ScrollRunway), { ssr: false });
const Overlays = dynamic(() => import("./ScrollRuntime").then((m) => m.SectionOverlays), { ssr: false });

export default function ScrollDriver() {
  return <Runtime />;
}

export function ScrollRunway() {
  return <Runway />;
}

export function SectionOverlays() {
  return <Overlays />;
}
