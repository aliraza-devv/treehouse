"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { scrollState } from "@/lib/scroll/scrollStore";

// ---------------------------------------------------------------------------------------------
// HERO CULL (Section 2, "The Approach"): turns off the hero-only dressing that the walk leaves behind.
//
// trunkBuild.js and floraAssemble.js both render their own content into one empty <group> per draw
// class specifically "so the integrator can cull by distance" (their own comments). This is that
// integrator pass, but it starts on the HERO side: HeroScene's ForegroundLeaves, FallingLeaves, the
// background tree ring and its own (off path) ground cover are all placed and sized for ONE camera,
// the static hero pose at (0, 0.9, 15) looking at the cabin. The moment the walker leaves that pose
// they stop doing their job twice over:
//   - they are no longer anchored to the view (ForegroundLeaves in particular is built by projecting
//     fixed screen anchors through the HERO camera; once the real camera diverges from that pose the
//     cards drift to arbitrary, unanchored positions in frame) so they read as debris, not framing
//   - Section 2 has already grown its own corridor dressing by then (trunks-far is the approach's own
//     far tree line, UnderstoryFlora its own ground cover), so the hero versions are pure duplicate cost
// Hiding them is therefore both a correctness fix and most of the triangle budget recovered (see the
// integrator's run of window.__heroStats.top): about 10 to 12k triangles, permanently, for the 90+
// percent of the walk this component covers.
//
// TIMING. HIDE_BEYOND sits just past two things that must stay untouched: the reveal dissolve
// (REVEAL_END, reveal.js, about 0.045) and the hero identity smoothness check (0.001 to 0.06 of local
// progress). By 0.12 the rig's own yaw/pitch schedule (approach.js: smooth(0, 0.14, s) / smooth(0,
// 0.13, s)) has already carried the gaze well away from the hero look, so the hero dressing would be
// visibly adrift by then anyway: the cut lands where it would stop looking anchored, not before.
//
// Mounted OUTSIDE <RevealGroup> (see ApproachScene.jsx's Controllers) so it runs from progress 0, the
// same as LightRamp; it does nothing until local progress passes HIDE_BEYOND and puts everything back
// the moment the visitor scrolls back above it.
// ---------------------------------------------------------------------------------------------

const HIDE_BEYOND = 0.12; // section-local approach progress

// Object names set by HeroScene's own files (ForegroundLeaves.jsx, FallingLeaves.jsx,
// ForestEnvironment.jsx, Treehouse.jsx). Plain scene graph names, a one-line tag each: no prop, no
// behaviour change to the hero files themselves.
const NAMES = [
  "foreground-leaves",
  "falling-leaves",
  "far-tree-line",
  "background-trunks",
  "background-crowns-oak",
  "background-crowns-beech",
  "background-crown-mass",
  "hero-ground-cover",
  // The hero's rope ladder reads as finished, lived-in joinery; Section 2 is still telling the
  // "twenty years in the trees" credibility story and ends its own walk at TrunkSteps' first pegs,
  // not this ladder, so once the glimpse layer is doing its job the ladder would only pre-empt the
  // Climb section's reveal and (per the preliminary render) was showing "very clearly" well before
  // the glimpse schedule intends (GLIMPSES in world.js). It is not solved for by the occluder plants
  // (glimpseLayout.js only scores the cabin silhouette), so it is hidden on the same schedule as the
  // rest of the hero-only dressing rather than left to poke through the gaps unplanned.
  "hero-rope-ladder",
];

const SCAN_EVERY = 10; // frames between scene scans while some names are still unresolved

export default function HeroCull() {
  const found = useRef(new Map());
  const frame = useRef(0);
  const hiddenRef = useRef(null); // last applied state, so we only touch .visible on a real change

  useFrame((state) => {
    frame.current += 1;
    const map = found.current;
    const t = scrollState.sections.approach ?? 0;
    const hide = t > HIDE_BEYOND;
    // Some of these (ForegroundLeaves, the far tree line...) mount a few frames after HeroScene itself
    // (ForestEnvironment stages them in one at a time), so a newly discovered object gets today's hide
    // state applied the moment it is found, not just on the next progress crossing: a visitor who lands
    // mid section (a direct window.__scrub jump, or a reload after scrolling) must never see one of
    // these pop in simply because it mounted after the threshold was already crossed.
    if (map.size < NAMES.length && frame.current % SCAN_EVERY === 0) {
      state.scene.traverse((o) => {
        if (NAMES.includes(o.name) && !map.has(o.name)) {
          map.set(o.name, o);
          o.visible = !hide;
        }
      });
    }
    if (hiddenRef.current === hide) return;
    hiddenRef.current = hide;
    for (const o of map.values()) o.visible = !hide;
  });

  return null;
}
