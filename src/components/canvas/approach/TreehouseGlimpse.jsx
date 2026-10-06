"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import useReducedMotion from "@/hooks/useReducedMotion";
import { createGlimpseBuild, GROUPS } from "./glimpseBuild";
import { evaluateGlimpse } from "./glimpseLayout";

// ---------------------------------------------------------------------------------------------------
// THE TREEHOUSE GLIMPSE for Section 2, "The Approach".
//
// The cabin must only be GLIMPSED as the walker comes up the path: partly hidden at first, mostly visible
// by the end, flickering in and out between gaps, never a steady window. The hero treehouse and its canopy
// cannot move, so this layer ADDS the things that hide it: ten understory plants (hazel stools, leaning
// beech and oak saplings, a stray holly, dead poles dressed with bramble) standing 2.5 to 9 m from the
// camera line, each built from tapered bark textured stems and instanced alpha cut leaf clusters with
// sunlit rims and backlit translucency. Some sway on the shared wind.
//
// Where they stand is NOT guessed. glimpseLayout.js holds a baked plan from an offline optimisation
// against the line of sight evaluator in glimpseVisibility.js (about 40 rays from the walker's eye to
// the cabin silhouette, tested against exactly the leaf clusters and wood that are drawn here). Open
// the console in dev and run window.__glimpse.evaluate() to see target against achieved visibility at
// the five GLIMPSES fractions.
//
// The rope bridge and the treetop walkway are not in the hero scene and are not added here.
//
// The build is STAGED (glimpseBuild.js): a job runs a few milliseconds per frame, fetching the shared
// leaf and bark textures from the toolkit cache (free when the hero has painted them), then mounting each
// plant's wood and each instanced leaf mesh as it is ready. This component is mounted by the scene host
// inside <RevealGroup>: every material goes through makeRevealable, nothing draws at progress 0, and
// shadows switch on only once the dissolve is mostly in. Nothing here is driven by scroll progress; the
// layer is static apart from the leaves' wind (frozen for reduced motion).
//
// Triangles drawn at once: about 3.0k (stats in window.__glimpse.stats, dev only). Textures: none painted
// here, the four leaf cards (sprig, beech, oak, ivy at 512) and the bark set are the hero's cached ones.
// ---------------------------------------------------------------------------------------------------

// Milliseconds of build work per rendered frame. A step is one texture fetch, one plant's wood or one
// instanced mesh, each well under 10 ms once the textures are cached.
const FRAME_BUDGET_MS = 5;

export default function TreehouseGlimpse() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  const groups = useRef({});
  const job = useRef(null);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const build = createGlimpseBuild({
      isReduced: () => reducedRef.current,
      onPart: (name, object) => groups.current[name]?.add(object),
    });
    job.current = build;
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      window.__glimpse = { stats: build.stats, evaluate: () => evaluateGlimpse() }; // dev only
    }
    return () => {
      build.dispose();
      job.current = null;
      if (process.env.NODE_ENV === "development" && typeof window !== "undefined") delete window.__glimpse;
    };
  }, []);

  // A few milliseconds of building per rendered frame until the job is done.
  useFrame(() => {
    const b = job.current;
    if (b && !b.done) b.step(FRAME_BUDGET_MS);
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
