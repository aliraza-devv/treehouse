"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import useReducedMotion from "@/hooks/useReducedMotion";
import { TRUNK_TUNING } from "./trunkTones";
import { createTrunkBuild, GROUPS } from "./trunkBuild";

// ---------------------------------------------------------------------------------------------------
// TRUNKS AND CANOPY DRESSING for Section 2, "The Approach".
//
//   approach:trunks-close   the 4 close trunks the walker weaves past at 0.4 to 0.6 m from the bark (c1 smooth
//                           beech, c2 ivied oak, c3 fluted hornbeam, c4 dark lichened oak, from CLOSE_TRUNKS)
//   approach:trunks-mid     the mid trunks (MID_TRUNKS, 18): oak, beech, hornbeam and birch in a seeded mix
//   approach:crowns         crown limbs and sparse leaf crowns at 10 to 16 m, and the six overhang sprays
//                           that cross the corridor at 2.1 to 4 m (blurred leaves passing close)
//   approach:trunks-far     the far tree line (13 to 25 m, instanced and left to the fog) and its small crowns
//
// Every trunk is its own custom swept tube (organic radius, root flare held back on the side that faces the
// dirt, lean from the data, a slow S in the axis, deeply ridged or smooth bark by species, moss on the north
// side, lichen, snapped low branch stubs with splintered pale ends, ivy runners and leaf cards on the trunks
// flagged ivy). Everything is procedural and seeded, so the woodland is identical on every load.
//
// The build is STAGED (trunkBuild.js): a job runs a few milliseconds per frame, painting one bark texture at
// a time and mounting each trunk the moment it is ready. Every material is passed through makeRevealable, so
// the wood dissolves in with the rest of the world (this component is mounted by the scene host inside
// <RevealGroup> and never draws at progress 0).
//
// The component renders one empty group per draw group so the reveal prewarm can compile programs in small
// batches and the integrator can cull by distance; the job adds meshes to those groups as they finish.
// Nothing here is driven by scroll progress: the trunks are static, and the leaves sway on the shared wind.
// ---------------------------------------------------------------------------------------------------
export default function Trunks() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  const groups = useRef({});
  const job = useRef(null);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const build = createTrunkBuild({
      isReduced: () => reducedRef.current,
      onPart: (name, object) => groups.current[name]?.add(object),
    });
    job.current = build;
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") window.__trunkStats = build.stats; // dev only
    return () => {
      build.dispose();
      job.current = null;
    };
  }, []);

  // A few milliseconds of building per rendered frame until the job is done.
  useFrame(() => {
    const b = job.current;
    if (b && !b.done) b.step(TRUNK_TUNING.frameBudgetMs);
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
        <group key={name} name={`approach:${name}`} ref={setRef(name)} />
      ))}
    </>
  );
}
