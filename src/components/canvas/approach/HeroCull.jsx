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
// TIMING. The fade window sits just past two things that must stay untouched: the reveal dissolve
// (REVEAL_END, reveal.js, about 0.045) and the hero identity smoothness check (0.001 to 0.06 of local
// progress). By 0.14 the rig's own yaw/pitch schedule (approach.js: smooth(0, 0.14, s) / smooth(0,
// 0.13, s)) has already carried the gaze well away from the hero look, so the hero dressing would be
// visibly adrift by then anyway: the cut lands where it would stop looking anchored, not before.
//
// Mounted OUTSIDE <RevealGroup> (see ApproachScene.jsx's Controllers) so it runs from progress 0, the
// same as LightRamp; it does nothing until local progress enters the fade window and puts everything
// back, bit for bit, the moment the visitor scrolls back above it.
//
// FADE, NOT A FLIP. A same-frame `.visible = false` on a dozen large background objects (the far tree
// line, the whole background tree ring) is exactly the kind of pop CLAUDE.md's "grounded cinematic
// realism" direction rules out; every other transition in this codebase (RevealGroup's dissolve,
// LIGHT_RAMP's lerped fog, the camera's splines) is built to avoid one. So HIDE_FROM..HIDE_TO is a
// short opacity cross-fade instead of a threshold: each discovered object's materials are faded to 0
// over that window, then `.visible` is set false (recovering the full triangle-budget saving) only
// once the fade has actually finished, and restored true the instant it starts fading back in.
// ---------------------------------------------------------------------------------------------

const HIDE_FROM = 0.1; // section-local approach progress: fade starts here
const HIDE_TO = 0.14; // ...and finishes here (fully hidden)

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

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Collect every material on an object's own subtree (it may be a single mesh or a whole dressing
// group), remembering each one's original opacity/transparent flags so fade = 1 can restore them
// EXACTLY (not just visually) rather than leaving `transparent: true` behind at the hero pose.
function collectMaterials(object) {
  const mats = new Set();
  object.traverse((c) => {
    const m = c.material;
    if (!m) return;
    for (const one of Array.isArray(m) ? m : [m]) {
      if (one && !mats.has(one)) {
        mats.add(one);
        if (one.userData.heroCullBase === undefined) {
          one.userData.heroCullBase = { opacity: one.opacity, transparent: one.transparent };
        }
      }
    }
  });
  return [...mats];
}

function applyFade(entry, fade) {
  entry.object.visible = fade > 0.001; // skip the draw entirely once fully faded out (the triangle saving)
  for (const m of entry.materials) {
    const base = m.userData.heroCullBase;
    if (fade >= 0.999) {
      // Back at (or above) the hero pose: put the material back exactly as it was found, bit for bit.
      m.opacity = base.opacity;
      m.transparent = base.transparent;
    } else {
      m.transparent = true;
      m.opacity = base.opacity * fade;
    }
  }
}

export default function HeroCull() {
  const found = useRef(new Map()); // name -> { object, materials }
  const lastFade = useRef(1);

  useFrame((state) => {
    const map = found.current;
    const t = scrollState.sections.approach ?? 0;
    const fade = 1 - smoothstep(HIDE_FROM, HIDE_TO, t); // 1 = hero visible, 0 = fully faded out

    // Some of these (ForegroundLeaves, the far tree line...) mount a few frames after HeroScene itself
    // (ForestEnvironment stages them in one at a time). Scan every frame, not every Nth, until every
    // name is found: the traversal only runs while map.size < NAMES.length (a handful of frames at
    // most, since it stops touching the scene forever the moment the last name turns up), so the cost
    // is negligible and a visitor who lands mid section (a direct window.__scrub jump, a reload after
    // scrolling, or the dev scrubber used for screenshots) never gets a frame or two where a newly
    // mounted object is still at its un-faded default before this controller has seen it.
    if (map.size < NAMES.length) {
      state.scene.traverse((o) => {
        if (NAMES.includes(o.name) && !map.has(o.name)) {
          const entry = { object: o, materials: collectMaterials(o) };
          map.set(o.name, entry);
          applyFade(entry, fade);
        }
      });
    }
    if (lastFade.current === fade) return;
    lastFade.current = fade;
    for (const entry of map.values()) applyFade(entry, fade);
  });

  return null;
}
