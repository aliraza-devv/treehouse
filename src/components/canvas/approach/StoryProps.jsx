"use client";

// THE STORY PROPS (Section 2, "The Approach"): one quiet detail per stretch of path, never a UI card.
//
//   a child's wellington boot  lying on its side at the foot of close trunk c2, off the worn dirt, its mouth turned
//                              toward the path: green rubber with a wet sheen, scuffed, a muddy treaded sole, a bit
//                              of leaf litter and moss over it, a loop of sock yarn caught in the opening
//   a coil of hemp rope        on a sawn stump beside the path (STUMP in world.js): the stump has its root flare and
//                              bark, a sawn top with painted growth rings and drying checks, moss, bracket fungus
//                              and new shoots; the rope is weathered manila (the hero rope textures), six loose
//                              coils with a loose end trailing over the rim to the ground
//   a hand painted arrow       on close trunk c4 at 1.45 m: a pine offcut bent round the bark, a childlike arrow in
//                              faded warm cream paint (chipped), two nails with rust streaks, one corner being
//                              swallowed by the bark. Its face looks at the walker and the arrow points with the walk.
//
// Every prop is placed from the world contract and from the real trunk shapes (see propStoryGeometry.js). Mounted
// by the scene host inside <RevealGroup>; every material goes through makeRevealable. Nothing is mounted until the
// staged build (propStoryBuild.js) is complete. Nothing here moves.
//
// Triangles drawn at once: about 1.1k (build.result.triangleBreakdown tells exactly).
// Textures: stump top 256 x 256, arrow board 256 x 88, boot sole 64 x 160 (albedo, normal, roughness and AO each);
// painting takes about 0.2 s of CPU in chunks of at most 26 ms.

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { createStoryBuild } from "./propStoryBuild";

// Milliseconds of build work per frame (a painter chunk is 10 to 26 ms; at least one runs per frame)
const FRAME_BUDGET_MS = 6;

export default function StoryProps() {
  const [objects, setObjects] = useState(null);
  const buildRef = useRef(null);

  // Created in an effect so StrictMode's mount, unmount, mount does not leak the first build.
  useEffect(() => {
    const build = createStoryBuild();
    buildRef.current = build;
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") window.__storyStats = build; // dev only
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
    <group name="approach:story-props">
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
