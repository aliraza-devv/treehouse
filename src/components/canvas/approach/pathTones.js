// Colour vocabulary for the path and ground. Everything is DERIVED from the brand palette
// (PALETTE / BRAND in sceneConfig) by blending and dimming, so a brand change flows through. Values are
// sRGB bytes [r, g, b] (0..255), blended as authored, the same convention the hero texture toolkit
// paints in. Nothing here is a hard-coded hex.

import * as THREE from "three";
import { BRAND, PALETTE } from "@/lib/sceneConfig";

export function hexBytes(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixBytes = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleBytes = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// Channel multipliers on bytes (a hue nudge, for the few natural colours the palette has no hue for,
// for instance the red in a rusty beech leaf).
export const nudgeBytes = (a, m) => [a[0] * m[0], a[1] * m[1], a[2] * m[2]];

const B = (hex) => hexBytes(hex);

// Ground and stone tones (sRGB bytes)
export const TONES = {
  // boot-polished clay in the centre of the path: soft stone warmed with timber, dimmed
  clayBuff: scaleBytes(mixBytes(B(PALETTE.stone), B(PALETTE.wood), 0.55), 0.74),
  // compacted damp earth between the centre and the edges
  earthMid: scaleBytes(mixBytes(B(BRAND.timber), B(PALETTE.barkDark), 0.5), 0.95),
  // peaty brown at the edges, close to the hero floor
  peat: mixBytes(B(PALETTE.barkDark), B(PALETTE.floorDark), 0.42),
  // mossy fringe patches, where the path meets the forest floor
  fringeMoss: scaleBytes(mixBytes(B(PALETTE.mossTone), B(PALETTE.litterWarm), 0.3), 0.66),
  floorLight: B(PALETTE.floorLight),
  // stones: warm sandstone and cool grey flint, plus the moss that grows on them
  stoneSand: scaleBytes(mixBytes(B(PALETTE.stone), B(BRAND.timber), 0.35), 0.66),
  stoneFlint: mixBytes(B(PALETTE.stone), B(BRAND.charcoal), 0.62),
  stoneMoss: scaleBytes(mixBytes(B(PALETTE.mossTone), B(PALETTE.leafMid), 0.3), 0.8),
  bark: B(PALETTE.bark),
  barkDark: B(PALETTE.barkDark),
};

// The mean colour of the fine (micro) ground texture. The macro maps store COLOUR MULTIPLIERS relative
// to this, so the micro texture can stay a neutral, detailed earth while the macro paints the zones
// (buff centre, peat edges, moss).
export const MICRO_MEAN = mixBytes(TONES.earthMid, TONES.clayBuff, 0.3);

// The neutral light tan every leaf in the atlas is painted in; instance colours multiply it.
export const LEAF_BASE = mixBytes(B(PALETTE.stone), B(PALETTE.wood), 0.4);

const srgb = (bytes) => new THREE.Color().setRGB(bytes[0] / 255, bytes[1] / 255, bytes[2] / 255, THREE.SRGBColorSpace);
export { srgb as colorFromBytes };

// The leaf litter palette (final sRGB colour of a leaf, weight): beech copper, oak brown, dark wet
// leaves, olive, and a few yellows. The nudge puts a little red into the copper and rust tones.
export const LEAF_COLOURS = [
  { w: 0.24, bytes: nudgeBytes(scaleBytes(mixBytes(B(BRAND.timber), B(BRAND.warmLight), 0.25), 0.8), [1.1, 0.78, 0.6]) }, // rust and copper
  { w: 0.3, bytes: scaleBytes(mixBytes(B(PALETTE.litterWarm), B(BRAND.timber), 0.3), 1.0) }, // oak and beech brown
  { w: 0.2, bytes: scaleBytes(mixBytes(B(PALETTE.barkDark), B(PALETTE.floorDark), 0.25), 1.15) }, // dark, wet
  { w: 0.16, bytes: scaleBytes(mixBytes(B(PALETTE.mossTone), B(PALETTE.litterWarm), 0.5), 0.95) }, // olive
  { w: 0.08, bytes: scaleBytes(mixBytes(B(BRAND.warmLight), B(BRAND.cream), 0.18), 0.82) }, // a few yellows
];

// Multiplier colour that turns the neutral leaf base into `finalBytes` (linear space, as the GPU
// multiplies it). Clamped so a very bright target does not blow out.
export function leafTint(finalBytes, out = new THREE.Color()) {
  const f = srgb(finalBytes);
  const b = srgb(LEAF_BASE);
  return out.setRGB(Math.min(1.5, f.r / b.r), Math.min(1.5, f.g / b.g), Math.min(1.5, f.b / b.b), THREE.LinearSRGBColorSpace);
}
