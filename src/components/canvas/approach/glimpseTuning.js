import * as THREE from "three";
import { LIGHT, PALETTE } from "@/lib/sceneConfig";

// ===========================================================================================
// TREEHOUSE GLIMPSE: tuning constants (everything you might want to change lives here).
//
// The glimpse layer is a handful of understory plants (hazel stools, leaning saplings, a stray holly,
// dead poles dressed with honeysuckle and bramble) standing between the walker and the cabin. Their
// POSITIONS were solved offline against the line of sight evaluator (glimpseVisibility.js), so the
// cabin shows through gaps in the right amounts at the right moments (see glimpseLayout.js). The
// constants below only change how they LOOK and how much they cost.
// ===========================================================================================

// Hard cap on triangles drawn at once (the integrator's allotment for this component). The builder
// trims the least important leaf clusters if a plan ever exceeds it.
export const TRIANGLE_BUDGET = 4000;

// Leaf card textures are shared with the hero through the toolkit cache (same kind, seed and size as
// Tree.jsx / ForestEnvironment.jsx, so they are free when the hero has painted them) and are NEVER
// disposed here. Index into the arrays below.
export const TEX = { sprig: 0, beech: 1, oak: 2, ivy: 3 };
export const TEX_SPECS = [
  { kind: "sprig", seed: 5, size: 512 }, // small serrated leaves: hazel, bramble
  { kind: "beech", seed: 4, size: 512 }, // smooth ovate leaves: beech, hornbeam, honeysuckle
  { kind: "oak", seed: 3, size: 512 }, // lobed: the oak sapling
  { kind: "ivy", seed: 6, size: 512 }, // dark pointed leaves: the holly
];
export const BARK_SPEC = { seed: 7 }; // the hero's bark set, a free cache hit

// A cluster is three crossed alpha cut cards, each arched along its length and a little cupped across
// its width (12 triangles). One geometry per texture, scaled per instance.
export const CLUSTER_GEOMETRY = { cards: 3, segments: [1, 2], bend: 0.22, cup: 0.1, normalBlend: 0.6 };
export const CLUSTER_TRIANGLES = CLUSTER_GEOMETRY.cards * CLUSTER_GEOMETRY.segments[0] * CLUSTER_GEOMETRY.segments[1] * 2;

// How the line of sight evaluator treats a leaf cluster: a sphere of radius CLUSTER_RADIUS * size
// centred half a size along the cluster's growth direction, with optical density rho per metre of chord.
export const CLUSTER_RADIUS = 0.42;
export const CLUSTER_RHO = 2.4;
// Minimum radius the evaluator gives to wood (thin twigs read about 3 cm wide once blurred).
export const WOOD_MIN_RADIUS = 0.03;

// ----- foliage looks -------------------------------------------------------------------------------
// Each hue multiplies the leaf card albedo (linear RGB, as the hero canopy does). `dark` is the shaded
// interior, `lit` the sunlit rim, mixed by the cluster's own light value; `accent` is an occasional
// different leaf colour (copper beech edges, yellowing hazel, bronze bramble) with its chance.
export const HUES = {
  hazel: { dark: [0.3, 0.42, 0.28], lit: [1.28, 1.34, 0.76], accent: { chance: 0.1, rgb: [1.55, 1.25, 0.45] } },
  beech: { dark: [0.26, 0.37, 0.32], lit: [1.12, 1.2, 0.88], accent: { chance: 0.34, rgb: [1.8, 0.84, 0.36] } }, // copper edges
  oak: { dark: [0.26, 0.37, 0.32], lit: [1.12, 1.2, 0.88], accent: { chance: 0.06, rgb: [1.45, 1.15, 0.5] } },
  holly: { dark: [0.2, 0.3, 0.26], lit: [0.7, 0.84, 0.64], accent: null },
  honey: { dark: [0.24, 0.36, 0.38], lit: [0.92, 1.1, 0.96], accent: { chance: 0.08, rgb: [1.3, 1.1, 0.7] } },
  bramble: { dark: [0.26, 0.3, 0.24], lit: [1.02, 0.96, 0.6], accent: { chance: 0.35, rgb: [1.5, 0.7, 0.42] } },
};

// One entry per instanced mesh: the card texture, how glossy it is, how much light shows through it.
// `calm` clusters flutter a little (amplitude in metres at the card tip), `sway` clusters move visibly.
export const FOLIAGE_LOOK = [
  { name: "sprig", roughness: 0.68, translucency: 0.85, normalScale: 0.7, calm: { amplitude: 0.035, speed: 1.2 }, sway: { amplitude: 0.13, speed: 0.95 } },
  { name: "beech", roughness: 0.62, translucency: 0.9, normalScale: 0.7, calm: { amplitude: 0.035, speed: 1.3 }, sway: { amplitude: 0.14, speed: 1.0 } },
  { name: "oak", roughness: 0.72, translucency: 0.8, normalScale: 0.75, calm: { amplitude: 0.03, speed: 1.1 }, sway: { amplitude: 0.1, speed: 0.9 } },
  { name: "ivy", roughness: 0.38, translucency: 0.45, normalScale: 0.6, calm: { amplitude: 0.012, speed: 1.4 }, sway: { amplitude: 0.05, speed: 1.1 } },
];
export const FOLIAGE_ALPHA_TEST = 0.5;
// Backlit glow: soft leaf green pulled toward the warm light, as the hero canopy does (never lime).
export const FOLIAGE_GLOW = new THREE.Color(PALETTE.leafHighlight).lerp(new THREE.Color(PALETTE.warmLight), 0.35);

// ----- wood -----------------------------------------------------------------------------------------
// Vertex colour multipliers on the shared bark texture (linear RGB). Hazel is warm brown, young beech
// silvery grey-green, a dead pole bleached grey, vines dark brown-green.
export const BARK_TONES = {
  hazel: [1.1, 0.96, 0.78],
  beech: [0.88, 0.95, 0.96],
  oak: [0.95, 0.9, 0.82],
  holly: [0.78, 0.82, 0.74],
  dead: [1.18, 1.14, 1.05],
  honey: [0.8, 0.72, 0.6],
  bramble: [0.95, 0.6, 0.62],
};
export const BARK_NORMAL_SCALE = 1.0;
// World size of one bark texture tile in metres. The hero maps one tile to a whole circumference (a
// metre or more); a twig takes a window of the same tile (see glimpseWood.js), so the bark detail
// stays at a believable scale: fissures a few centimetres apart.
export const BARK_TILE = 0.55;
// Tube cross section: radial segments by radius (metres). Thin things stay cheap.
export function radialFor(radius) {
  if (radius < 0.02) return 3;
  if (radius < 0.045) return 4;
  return 5;
}

// ----- light ----------------------------------------------------------------------------------------
// Unit vector toward the sun (the key light), used to bake a sunlit rim into the cluster colours.
// A plain [x, y, z] array, because glimpsePlants.js does its vector maths on arrays (it runs in node).
export const SUN = new THREE.Vector3(...LIGHT.keyPosition).sub(new THREE.Vector3(...LIGHT.target)).normalize().toArray();
