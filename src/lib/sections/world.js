import * as THREE from "three";
import { TREE, CAMERA, groundHeight, trunkRadiusAt } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";

// ===========================================================================================
// SECTION 2 WORLD CONTRACT: "The Approach"
//
// Single source of truth for WHERE things are in the woodland the camera walks through. The
// camera rig, the path, flora, trunks, props, signposts, light and treehouse glimpses all place
// themselves with the helpers below, so nothing is placed by hand and nothing drifts.
//
// Units: 1 world unit = 1 metre. The hero tree stands at (TREE.x, TREE.z) = (2.2, 0). The hero
// camera starts at CAMERA.position = (0, 0.9, 15) looking toward -Z (pitched up 20 degrees).
// The walker moves from z = 15 toward the tree at z = 0 and stops about 3 m from its base.
// ===========================================================================================

// ----- The path -------------------------------------------------------------------------------
// Centreline control points as [x, z]. It begins exactly under the hero camera so there is no
// jump, swings right, then a long swing left, then back right: a gentle S that ends at the
// trunk's camera-facing side. Total length is roughly 14 m.
export const PATH_CONTROL_XZ = [
  [0.0, 15.0],
  [0.9, 13.2],
  [-0.7, 11.4],
  [-1.6, 9.4],
  [-0.1, 7.4],
  [1.3, 5.6],
  [1.9, 4.0],
  [2.1, 3.1],
];

// Worn dirt width (metres). Lighter in the centre, edges break up into litter and moss.
export const PATH_WIDTH = 1.7;
// Decor (ferns, litter, mushrooms, logs) keeps out of this half width around the centreline.
// Fern fronds may lean in over it by up to 0.4 m.
export const PATH_CLEAR_HALF_WIDTH = 0.95;

const _curve = new THREE.CatmullRomCurve3(
  PATH_CONTROL_XZ.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  "centripetal",
);
export const PATH_LENGTH = _curve.getLength();

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

// Position on the centreline at arc length fraction s (0 = hero camera, 1 = trunk base).
// Returns { x, y, z, tx, tz, rx, rz }: y is the ground height there, (tx, tz) the unit walking
// direction and (rx, rz) the unit vector to the walker's RIGHT (+lateral).
export function pathAt(s) {
  const u = THREE.MathUtils.clamp(s, 0, 1);
  _curve.getPointAt(u, _p);
  _curve.getTangentAt(u, _t);
  const len = Math.hypot(_t.x, _t.z) || 1;
  const tx = _t.x / len;
  const tz = _t.z / len;
  // Facing -Z, "right" is +X: right = (-tz, tx) rotates the heading clockwise seen from above.
  return { x: _p.x, y: groundHeight(_p.x, _p.z), z: _p.z, tx, tz, rx: -tz, rz: tx };
}

// World position at path fraction s, offset sideways by `lateral` metres (+ right, - left).
export function atPath(s, lateral = 0) {
  const p = pathAt(s);
  const x = p.x + p.rx * lateral;
  const z = p.z + p.rz * lateral;
  return { x, y: groundHeight(x, z), z, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz };
}

// Signed lateral distance of an arbitrary point from the centreline and the nearest s.
// Used to keep decor off the path and to fade effects with distance from it. Sampled (cheap enough
// at scene build time, do not call per frame for thousands of points).
export function toPath(x, z, samples = 96) {
  let best = { s: 0, dist: Infinity, lateral: 0 };
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const p = pathAt(s);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best.dist) {
      best = { s, dist: d, lateral: (x - p.x) * p.rx + (z - p.z) * p.rz };
    }
  }
  return best;
}

// True when (x, z) is on or very near the worn dirt (used by flora to keep the path open).
export function onPath(x, z, pad = 0) {
  return toPath(x, z).dist < PATH_CLEAR_HALF_WIDTH + pad;
}

// ----- Signposts: hand carved, weathered, slightly leaning. One per real project. -----------------
// yawDeg is added to the direction that faces the oncoming walker, so each board is angled a
// little differently. leanDeg tilts the post away from vertical (towards `leanToward`).
export const SIGNS = [
  { id: "surrey", label: "Surrey", s: 0.2, lateral: -1.6, yawDeg: 18, leanDeg: 4.5, leanToward: "path" },
  { id: "lake-como", label: "Lake Como", s: 0.41, lateral: 1.55, yawDeg: -22, leanDeg: 3.5, leanToward: "away" },
  { id: "quebec", label: "Quebec", s: 0.61, lateral: -1.5, yawDeg: 12, leanDeg: 5.5, leanToward: "away" },
  { id: "seychelles", label: "Seychelles", s: 0.79, lateral: 1.6, yawDeg: -15, leanDeg: 3, leanToward: "path" },
];

// ----- Trunks ---------------------------------------------------------------------------------
// CLOSE trunks: the camera weaves past these within about 0.6 to 1.1 m, the big parallax moments.
// (lateral is measured from the centreline; the camera weave is +-0.4 m, so these really are close.)
export const CLOSE_TRUNKS = [
  { id: "c1", s: 0.1, lateral: 1.35, r: 0.42, h: 26, lean: [0.03, -0.02], ivy: false, brokenBranches: 2, seed: 101 },
  { id: "c2", s: 0.33, lateral: -1.4, r: 0.5, h: 28, lean: [-0.02, 0.02], ivy: true, brokenBranches: 3, seed: 102 }, // wellington boot at its base
  { id: "c3", s: 0.55, lateral: 1.2, r: 0.38, h: 24, lean: [0.02, 0.03], ivy: false, brokenBranches: 1, seed: 103 },
  { id: "c4", s: 0.73, lateral: -1.3, r: 0.46, h: 27, lean: [-0.03, -0.02], ivy: true, brokenBranches: 2, seed: 104 }, // hand painted arrow nailed to it
];

// MID-GROUND trunks: scattered outside the path corridor. Deterministic (seeded), at least 2.3 m
// apart, never closer than 3.2 m to the hero trunk. Moss grows on the NORTH side, which is the +Z
// world side (facing the walker); the sun is south, at -Z. So the moss is visible from the path
// and faces the same way on every trunk.
function buildMidTrunks() {
  const rng = createRng(2024);
  const out = [];
  let guard = 0;
  while (out.length < 30 && guard++ < 4000) {
    const s = range(rng, 0.0, 1.0);
    const side = rng() < 0.5 ? -1 : 1;
    const lateral = side * range(rng, 2.7, 11);
    const p = atPath(s, lateral);
    // Keep out of the hero trunk's footprint and behind the camera start (nothing is built there).
    if (Math.hypot(p.x - TREE.x, p.z - TREE.z) < 3.2 || p.z > CAMERA.position[2] + 1) continue;
    const r = range(rng, 0.28, 0.72);
    const tooClose = [...CLOSE_TRUNKS.map((c) => ({ ...atPath(c.s, c.lateral), r: c.r })), ...out].some(
      (o) => Math.hypot(o.x - p.x, o.z - p.z) < 2.3 + o.r + r,
    );
    if (tooClose) continue;
    out.push({
      id: `m${out.length}`,
      x: p.x,
      y: p.y,
      z: p.z,
      s,
      lateral,
      r,
      h: range(rng, 22, 32),
      lean: [range(rng, -0.05, 0.05), range(rng, -0.05, 0.05)],
      ivy: rng() < 0.3,
      brokenBranches: Math.floor(range(rng, 0, 3.4)),
      seed: 300 + out.length,
    });
  }
  return out;
}
export const MID_TRUNKS = buildMidTrunks();

// ----- Ground features --------------------------------------------------------------------------
// A moss covered fallen log lying across the ground left of the path (yaw = angle from +X toward +Z).
export const FALLEN_LOG = { s: 0.4, lateral: -3.4, length: 4.4, r: 0.36, yawDeg: 62 };

// Roots crossing the worn dirt (exposed, polished by boots) plus flaring roots at each close trunk.
export const ROOT_CROSSINGS = [
  { s: 0.15, lateral: 0.0, span: 2.6, r: 0.11 },
  { s: 0.47, lateral: 0.2, span: 2.9, r: 0.13 },
  { s: 0.68, lateral: -0.1, span: 2.4, r: 0.1 },
];

// 2 or 3 mushroom clusters (a few caps each, mixed sizes).
export const MUSHROOM_CLUSTERS = [
  { s: 0.17, lateral: -2.35, count: 6 },
  { s: 0.58, lateral: 2.5, count: 4 },
  { s: 0.77, lateral: -2.1, count: 7 },
];

// A cut stump beside the path that carries the coil of hemp rope (story prop).
export const STUMP = { s: 0.5, lateral: -1.85, r: 0.34, h: 0.55 };

// ----- Story props: one quiet detail per stretch of path -----------------------------------------
export const STORY_PROPS = {
  // A child's wellington boot at the base of close trunk c2, toppled, its mouth toward the path.
  boot: { trunkId: "c2", yawDeg: 35 },
  // A coil of hemp rope on STUMP.
  rope: { onStump: true },
  // A small hand painted arrow nailed to close trunk c4 at 1.45 m, pointing along the walking direction.
  arrow: { trunkId: "c4", height: 1.45 },
};

// ----- The first wooden steps at the base of the hero trunk (Climb section starts here) -----------
// Steps are pegs and boards nailed up the trunk's camera facing side. azimuthDeg is measured from +X
// toward +Z (90 faces the approaching walker); the steps spiral up slightly.
export const TRUNK_STEPS = {
  baseY: 0.4,
  count: 8,
  rise: 0.42,
  azimuthDeg: 84,
  spiralDegPerStep: -4,
  width: 0.7,
};

// World position of the cabin centre (the glimpse target). Matches PostProcessing's CABIN_CENTER.
export const TREEHOUSE_CENTER = new THREE.Vector3(TREE.x + 2.5, TREE.platformY + 1.3, 0.7);

// Moments when the treehouse is glimpsed through gaps. `visible` is the fraction of the cabin
// silhouette that should be unobstructed from the camera at that path fraction (it grows).
// The bridge and walkway are never shown in this section.
export const GLIMPSES = [
  { s: 0.3, visible: 0.15 },
  { s: 0.44, visible: 0.3 },
  { s: 0.58, visible: 0.45 },
  { s: 0.72, visible: 0.6 },
  { s: 0.86, visible: 0.7 },
];

// Light and air ramps over the section's local progress 0..1 (value at the start, value at the end).
// The light controller blends toward brighter, thinner, warmer daylight.
export const LIGHT_RAMP = {
  fogDensity: [0.028, 0.017], // FogExp2 density (hero value to a thinner late-morning haze)
  exposure: [0.92, 1.03],
  environmentIntensity: [0.6, 0.78],
  keyIntensity: [3.0, 3.5],
  keyColor: ["#FFF5E6", "#FFE6BE"], // warmer sun
  fogColor: ["#9DAAB4", "#B9C3C4"], // cool blue-gray mist toward a warmer, paler haze
};

// ----- Camera intent (the rig author turns this into keyframes) -----------------------------------
export const EYE_HEIGHT = 1.62; // walking eye level above ground (the hero camera is lower, 0.9)
export const EYE_HEIGHT_END = 1.78; // rises slightly toward the end
// First guess of the end pose: close to the trunk base, looking at the first steps and roots, pitched
// up a few degrees. The rig author finalises and exports END_POSE from src/lib/sections/approach.js.
export const END_POSE_SEED = {
  position: [0.95, EYE_HEIGHT_END, 5.0],
  lookAt: [TREE.x + 0.1, 2.35, TREE.z + 1.7],
  roll: 0,
  fov: 50,
};

// Convenience: the hero trunk surface radius near the ground, for roots and steps.
export const TRUNK_BASE_RADIUS = trunkRadiusAt(0.8);
export const HERO_CAMERA_POSITION = new THREE.Vector3(...CAMERA.position);
