// Colour helpers for the understorey flora. Every tone is derived from PALETTE / BRAND in
// src/lib/sceneConfig.js (no hard-coded hexes): the painted textures work in sRGB bytes (0..255), the
// instance colours are three.js linear colours.

import * as THREE from "three";
import { PALETTE, BRAND } from "@/lib/sceneConfig";

export const hexRgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRgb = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v) || 0));
// rgba() string for canvas fills. Clamps and coerces so a NaN can never throw inside a gradient.
export const rgbCss = (c, a = 1) =>
  `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},${Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1))})`;

// Named tones (sRGB bytes). Greens are the brand greens; browns come from the timber and bark tones;
// the mushroom and litter tones are brand colours mixed toward each other, never new hexes.
const leafDark = hexRgb(PALETTE.leafDark);
const leafMid = hexRgb(PALETTE.leafMid);
const leafLight = hexRgb(PALETTE.leafHighlight);
const timber = hexRgb(BRAND.timber);
const timberDark = hexRgb(BRAND.timberDark);
const cream = hexRgb(BRAND.cream);
const stone = hexRgb(BRAND.stone);
const warm = hexRgb(BRAND.warmLight);
const moss = hexRgb(PALETTE.mossTone);
const litter = hexRgb(PALETTE.litterWarm);
const forest = hexRgb(BRAND.forest);

export const TONE = {
  leafDark,
  leafMid,
  leafLight,
  moss,
  forest,
  timber,
  timberDark,
  bark: hexRgb(PALETTE.bark),
  wood: hexRgb(PALETTE.wood),
  litter,
  cream,
  stone,
  warm,
  // a yellowed green for bracken and the new growth on wood sorrel
  yellowGreen: mixRgb(leafMid, warm, 0.22),
  // grey weathered wood under peeled bark: stone darkened toward the bark
  greyWood: mixRgb(stone, timberDark, 0.45),
  // rotten, punky wood: warm timber pushed toward the dark timber
  rotWood: mixRgb(timber, timberDark, 0.55),
  // copper beech leaf litter, from rusty to ochre
  beechRust: mixRgb(litter, warm, 0.38),
  beechOchre: mixRgb(litter, cream, 0.28),
};

// Instance colour (linear) from sRGB bytes; `gain` lets a tint exceed 1 on purpose (a multiplier on
// the albedo that shifts a green frond toward yellow or brown).
const _c = new THREE.Color();
export function instanceTint(r, g, b) {
  return { r, g, b };
}
export function linearFromBytes(rgb, gain = 1, out = new THREE.Color()) {
  _c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  return out.setRGB(_c.r * gain, _c.g * gain, _c.b * gain, THREE.LinearSRGBColorSpace);
}
