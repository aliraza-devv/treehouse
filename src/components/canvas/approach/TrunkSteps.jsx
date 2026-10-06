"use client";

// THE FIRST WOODEN STEPS (Section 2, "The Approach"): where the walk ends and the Climb begins.
//
// Eight sturdy hardwood treads climb the camera facing side of the hero trunk, each with its own size, thickness,
// tilt, wear, weathering and moss on its shaded edges, the middle of each dished by years of boots. Every tread
// has a forged steel bracket under it (a flat arm and a plate lying on the bark) and a carriage bolt through it; a
// worn hemp handline is looped through four iron eyes driven into the trunk beside the steps. They climb out of the
// buttress roots: three small extra root swells and a worn pad of soil at the foot.
//
// THEY ARE FITTED TO THE REAL TRUNK. The hero trunk is a lumpy tube with six buttress roots, so propStepsMath.js
// mirrors it (the same formulas as Tree.jsx) and scribes the back edge of every tread to it with a small gap. The
// steps stand in the flute between the buttress roots at 84 and 143 degrees (the crest of the 84 degree root is a
// ridge 1.3 m high, so TRUNK_STEPS.azimuthDeg itself cannot carry the lowest treads), and drift to the right as the
// roots merge into the trunk. Exact tread positions: build.result.report (also on window.__stepsStats in dev).
//
// Mounted by the scene host inside <RevealGroup>; every material goes through makeRevealable. Nothing is mounted
// until the staged build (propStepsBuild.js) is complete. Nothing here moves.
//
// Triangles drawn at once: about 1.2k (build.result.triangleBreakdown tells exactly). No textures are painted: the
// hero's cached beam wood, bark, rope, ground and smudge sets are reused, so the build is about 50 ms of geometry.

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { createStepsBuild } from "./propStepsBuild";

// Milliseconds of build work per frame (each geometry chunk is 5 to 25 ms; at least one runs per frame)
const FRAME_BUDGET_MS = 6;

export default function TrunkSteps() {
  const [objects, setObjects] = useState(null);
  const buildRef = useRef(null);

  // Created in an effect so StrictMode's mount, unmount, mount does not leak the first build.
  useEffect(() => {
    const build = createStepsBuild();
    buildRef.current = build;
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") window.__stepsStats = build; // dev only
    return () => {
      build.dispose();
      buildRef.current = null;
    };
  }, []);

  useFrame(() => {
    const build = buildRef.current;
    if (!build || build.done) return;
    build.step(FRAME_BUDGET_MS);
    if (build.done) setObjects(build.result.objects);
  });

  if (!objects) return null;
  return (
    <group name="approach:trunk-steps">
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
