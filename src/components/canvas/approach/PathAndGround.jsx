"use client";

// THE PATH AND THE GROUND AROUND IT (Section 2, "The Approach")
//
// A worn dirt path winding from under the hero camera to the foot of the trunk, painted at runtime
// (compacted damp earth, lighter boot-polished centre, two wear lines, ragged edges that dissolve into
// the forest floor, a puddle or two that mirror the sky), with stepping stones set into it, exposed
// roots crossing it, buttress roots flaring at the foot of every close trunk, and litter (leaves,
// twigs, pebbles, beech mast, acorn cups) laid with real density gradients.
//
// Everything is procedural, seeded (identical on every load) and seated on the RENDERED hero ground
// (see pathMath.groundSurface). Mounted by the scene host inside <RevealGroup>; every material is
// passed through makeRevealable, so the whole thing is invisible at progress 0.
//
// Frame budget: the textures and geometry are built a few milliseconds per frame by pathBuild.js, and
// nothing is mounted until the build is complete (the group stays empty, so no popping). Nothing is
// per frame except a puddle ripple uniform, frozen under prefers-reduced-motion.
//
// Triangles drawn at once: about 3.5k (build.result.triangles / triangleBreakdown tell exactly):
// ribbon 768, stones about 710, roots 1008, litter about 1000.

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import useReducedMotion from "@/hooks/useReducedMotion";
import { createPathBuild, PATH_LOOK } from "./pathBuild";

// Milliseconds of build work per frame (each task is a chunk of 10 to 40 ms; at least one runs per frame)
const FRAME_BUDGET_MS = 8;

export default function PathAndGround() {
  const reduced = useReducedMotion();
  const [objects, setObjects] = useState(null);
  const buildRef = useRef(null);

  // The build is created in an effect so StrictMode's mount, unmount, mount does not leak the first
  // one (cleanup disposes every texture, geometry and material it made).
  useEffect(() => {
    const build = createPathBuild();
    buildRef.current = build;
    return () => {
      build.dispose();
      buildRef.current = null;
    };
  }, []);

  useFrame((state) => {
    const build = buildRef.current;
    if (!build) return;
    if (!build.done) {
      build.step(FRAME_BUDGET_MS);
      if (build.done) setObjects(build.result.objects);
      return;
    }
    // puddle ripples: a slow wobble on the water, frozen for reduced motion
    const u = build.result.uniforms;
    u.uTime.value = reduced ? 0 : state.clock.elapsedTime;
    u.uRipple.value = reduced ? 0 : PATH_LOOK.rippleStrength;
  });

  if (!objects) return null;
  return (
    <group name="approach:path-and-ground">
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
