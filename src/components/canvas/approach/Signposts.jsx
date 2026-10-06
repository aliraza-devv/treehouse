"use client";

// THE SIGNPOSTS (Section 2, "The Approach")
//
// Four hand carved wooden fingerposts, one per real project: "Surrey", "Lake Como", "Quebec", "Seychelles".
// Each is a rough hewn oak or chestnut post (octagonal, adze scooped, split, silvered, lichened, mossy at the
// foot, a bevelled cap) with an arm that passes through a mortise and is pegged, running AWAY from the path so
// the walking camera can never meet it. The names are CARVED: the lettering is a set of chisel cut V grooves
// (see propLetters.js) turned into a normal map, a stained groove and a lighter cut edge in the board texture,
// so it reads as wood and not as print. Each sign has one detail that differs (a carved oak leaf, a notch in the
// top edge, a rope loop through a drilled hole, a swift) and its own lean, yaw, droop, chip and weathering.
// They stand in packed soil with stones, moss and grass tufts.
//
// Placement comes from SIGNS in src/lib/sections/world.js (path fraction, lateral offset, yaw, lean) and the
// real rendered ground. Mounted by the scene host inside <RevealGroup>; every material is passed through
// makeRevealable. Nothing is mounted until the staged build (propSignBuild.js) is complete, so no sign ever
// pops in half painted. Nothing here moves except the grass tufts' wind (frozen for reduced motion).
//
// Triangles drawn at once: about 1.7k (build.result.triangleBreakdown tells exactly).
// Textures: 4 boards of about 800 x 210 (albedo, normal, roughness and AO), one 384 x 1024 post sheet, one
// 192 x 192 stone sheet, one 128 x 128 grass card. Painting takes about 1.3 s of CPU in total, in chunks of at
// most 25 ms, one chunk or two per frame.

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import useReducedMotion from "@/hooks/useReducedMotion";
import { createSignBuild } from "./propSignBuild";

// Milliseconds of build work per frame (a painter chunk is 10 to 25 ms; at least one runs per frame)
const FRAME_BUDGET_MS = 6;

export default function Signposts() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  const [objects, setObjects] = useState(null);
  const buildRef = useRef(null);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Created in an effect so StrictMode's mount, unmount, mount does not leak the first build (cleanup
  // disposes every texture, geometry and material it made).
  useEffect(() => {
    const build = createSignBuild({ isReduced: () => reducedRef.current });
    buildRef.current = build;
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") window.__signStats = build; // dev only: timings, triangles, plans
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
    <group name="approach:signposts">
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
