// Colour vocabulary for the signposts, story props and trunk steps (Signposts.jsx, StoryProps.jsx,
// TrunkSteps.jsx and the prop*.js helpers). Everything is DERIVED from the brand palette (PALETTE and
// BRAND in sceneConfig) by blending and dimming, so a brand change flows through. Values are sRGB bytes
// [r, g, b] (0..255), blended as authored, the same convention the hero texture toolkit paints in.
// Nothing in the components is a hard coded hex.

import * as THREE from "three";
import { BRAND, PALETTE } from "@/lib/sceneConfig";

const hexBytes = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mixBytes = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleBytes = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// Per channel multipliers: a hue nudge for the few natural colours the palette has no hue for
// (the red in rust, the blue in a cool flint grey).
export const nudgeBytes = (a, m) => [a[0] * m[0], a[1] * m[1], a[2] * m[2]];
const B = hexBytes;

export const TONES = {
  // ---- timber: from sapwood-gold to heartwood, then silvered by weather ----------------------------
  oakEarly: mixBytes(B(PALETTE.wood), B(BRAND.timber), 0.35), // springwood
  oakLate: scaleBytes(mixBytes(B(BRAND.timber), B(BRAND.timberDark), 0.4), 0.9), // summerwood, pores
  chestnutEarly: mixBytes(B(PALETTE.wood), B(BRAND.warmLight), 0.14), // sweet chestnut, a touch more honey
  chestnutLate: scaleBytes(mixBytes(B(BRAND.timber), B(BRAND.timberDark), 0.55), 0.88),
  // weathered grey: stone dulled with charcoal and warmed a little by timber (never a cold blue grey)
  silver: mixBytes(mixBytes(B(PALETTE.stone), B(BRAND.charcoal), 0.5), B(BRAND.timber), 0.14),
  silverDark: scaleBytes(mixBytes(mixBytes(B(PALETTE.stone), B(BRAND.charcoal), 0.7), B(BRAND.timberDark), 0.2), 0.9),
  stain: mixBytes(B(BRAND.timberDark), B(BRAND.charcoal), 0.4), // rain stain, tannin, groove soot
  // ---- growth on wood and ground ------------------------------------------------------------------------
  lichenPale: scaleBytes(mixBytes(B(PALETTE.stone), B(PALETTE.mossTone), 0.42), 0.92), // crustose grey green
  lichenYellow: nudgeBytes(scaleBytes(mixBytes(B(PALETTE.leafHighlight), B(BRAND.warmLight), 0.4), 0.82), [1.02, 0.98, 0.7]),
  moss: scaleBytes(mixBytes(B(PALETTE.mossTone), B(PALETTE.leafMid), 0.35), 0.85),
  mossDark: scaleBytes(mixBytes(B(PALETTE.mossTone), B(PALETTE.leafDark), 0.5), 0.7),
  soil: mixBytes(B(PALETTE.barkDark), B(PALETTE.floorDark), 0.35),
  soilWet: scaleBytes(mixBytes(B(PALETTE.barkDark), B(PALETTE.floorDark), 0.6), 0.9),
  litter: scaleBytes(mixBytes(B(PALETTE.litterWarm), B(BRAND.timber), 0.25), 0.85),
  grassGreen: scaleBytes(mixBytes(B(PALETTE.leafMid), B(PALETTE.mossTone), 0.35), 0.9),
  grassDry: scaleBytes(mixBytes(B(PALETTE.stone), B(BRAND.timber), 0.5), 0.78),
  stone: mixBytes(B(PALETTE.stone), B(BRAND.charcoal), 0.55),
  stoneWarm: scaleBytes(mixBytes(B(PALETTE.stone), B(BRAND.timber), 0.35), 0.7),
  // ---- metal, rope, paint, rubber -----------------------------------------------------------------------
  iron: scaleBytes(mixBytes(B(BRAND.charcoal), B(PALETTE.stone), 0.18), 0.9), // blackened wrought iron
  ironWorn: mixBytes(mixBytes(B(BRAND.charcoal), B(PALETTE.stone), 0.3), B(BRAND.warmLight), 0.1), // bright where rubbed
  rust: nudgeBytes(mixBytes(B(BRAND.timberDark), B(BRAND.warmLight), 0.5), [1.1, 0.7, 0.5]),
  paintWarm: mixBytes(B(BRAND.warmLight), B(BRAND.cream), 0.3), // the child's arrow
  paintCream: B(BRAND.cream),
  rubberGreen: scaleBytes(mixBytes(B(BRAND.green), B(BRAND.forest), 0.35), 0.95), // a child's wellington
  rubberSole: scaleBytes(mixBytes(B(BRAND.charcoal), B(BRAND.forest), 0.4), 0.9),
  sock: mixBytes(B(BRAND.warmLight), B(BRAND.cream), 0.55), // yarn stuck in the boot mouth
  fungus: mixBytes(B(BRAND.timber), B(BRAND.warmLight), 0.35), // bracket fungus on the stump
  fungusPale: mixBytes(B(PALETTE.stone), B(BRAND.cream), 0.5),
};

const _c = new THREE.Color();
// sRGB bytes -> linear THREE.Color (what vertex colour attributes and uniforms expect).
export function colorFromBytes(bytes, out = _c) {
  return out.setRGB(bytes[0] / 255, bytes[1] / 255, bytes[2] / 255, THREE.SRGBColorSpace);
}
// sRGB bytes -> [r, g, b] linear floats (for vertex colour attributes).
export function linearOf(bytes) {
  colorFromBytes(bytes, _c);
  return [_c.r, _c.g, _c.b];
}
