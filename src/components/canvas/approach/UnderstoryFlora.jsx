"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import useReducedMotion from "@/hooks/useReducedMotion";
import { BUILD_BUDGET_MS } from "./floraTuning";
import { createFloraBuild, GROUPS } from "./floraAssemble";

// ---------------------------------------------------------------------------------------------------
// UNDERSTOREY FLORA for Section 2, "The Approach".
//
//   ferns          three species (male fern, hart's tongue, bracken), each in several cluster geometries,
//                  instanced, every clump leaning its own way, with age and colour variation
//   ground cover   moss patches, ivy runners, dog's mercury and wood sorrel carpets, sedge, bramble,
//                  a drift of beech leaves in the lee of the log
//   the fallen log a moss covered beech trunk with a rotted hollow, peeling bark, splintered ends, an
//                  upturned root plate, bracket fungus, ivy and small ferns growing on it
//   mushrooms      honey fungus, a ring of small brown caps, one cluster of larger caps
//
// Everything is procedural (canvas painted textures, generated geometry). The build is STAGED: a job
// (floraAssemble.js) runs a few milliseconds per frame, painting one texture at a time and mounting each
// part the moment it is ready, so the main thread is never blocked. Every material is passed through
// makeRevealable, so the whole understorey dissolves in with the rest of the world (this component is
// mounted by the scene host inside <RevealGroup>; it never draws at progress 0).
//
// The component renders one empty group per draw group so the reveal prewarm can compile the programs in
// small batches; the staged job adds meshes to those groups as they finish.
// ---------------------------------------------------------------------------------------------------
export default function UnderstoryFlora() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  const groups = useRef({});
  const job = useRef(null);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const build = createFloraBuild({
      isReduced: () => reducedRef.current,
      onPart: (name, object) => groups.current[name]?.add(object),
    });
    job.current = build;
    if (typeof window !== "undefined") window.__floraStats = build.stats; // dev only: timings and triangle counts
    return () => {
      build.dispose();
      job.current = null;
    };
  }, []);

  // A few milliseconds of building per rendered frame until the job is done.
  useFrame(() => {
    const b = job.current;
    if (b && !b.done) b.step(BUILD_BUDGET_MS);
  });

  const setRef = useCallback(
    (name) => (g) => {
      if (g) groups.current[name] = g;
      else delete groups.current[name];
    },
    [],
  );

  return (
    <>
      {GROUPS.map((name) => (
        <group key={name} name={`flora:${name}`} ref={setRef(name)} />
      ))}
    </>
  );
}
