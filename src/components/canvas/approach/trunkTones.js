// Tuning knobs, species and colours for the approach trunks (Trunks.jsx and the trunk*.js helpers).
//
// Everything a person would want to tweak by eye lives in this file. Colours are derived from the brand
// palette (BRAND / PALETTE in sceneConfig), never typed as hexes here. Beech, hornbeam and birch have no
// brand equivalent, so they are blends of stone, cream, charcoal, timber and moss.

import * as THREE from "three";
import { BRAND, PALETTE } from "@/lib/sceneConfig";

const col = (hex) => new THREE.Color(hex);
const mixc = (a, b, t) => col(a).lerp(col(b), t);
export const hexOf = (c) => `#${c.getHexString()}`;
// sRGB bytes [r, g, b] of a THREE.Color (the painters write sRGB bytes).
export const rgb255 = (c) => {
  const h = c.getHex();
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
};
const scale = (rgb, k) => rgb.map((v) => Math.max(0, Math.min(255, v * k)));

// ------------------------------------------------------------------------------------------------
// GLOBAL TUNING
// ------------------------------------------------------------------------------------------------
export const TRUNK_TUNING = {
  // Milliseconds of build work per frame (texture painting is chunked, geometry is many small tasks).
  frameBudgetMs: 7,

  // Ring and radial counts per class (triangles scale with radial x rings). `detail` multiplies radial.
  detail: 1,
  closeRadial: 20,
  midNearRadial: 12,
  midFarRadial: 8,
  // Heights (m above the trunk's ground) of the rings. Dense low where the flare changes quickly,
  // coarse high up where only the silhouette matters. The first ring is below ground (no gap at the foot).
  closeRings: [-0.25, 0, 0.22, 0.5, 0.9, 1.45, 2.2, 3.3, 5, 7.5, 11, 15, 18],
  midNearRings: [-0.25, 0, 0.35, 1.2, 3, 6, 10, 14.5],
  midFarRings: [-0.25, 0, 0.6, 2.5, 6, 10.5, 15],
  // trunks with |lateral| at most this are "near" mid trunks (more rings, more radial)
  midNearLateral: 5.5,

  // Far (instanced, slim, fogged) trunks, 13 to 25 m ahead and beside the path.
  farCount: 12,
  farRadial: 7,
  farRings: [-0.3, 0, 0.8, 5, 15], // one geometry for every instance, scaled in x/z only

  // Crown dressing: leaf cluster counts and size (metres across a cluster of two crossed cards).
  crownMinLateral: 6, // mid trunks at least this far from the centreline get a crown
  crownClusters: [7, 10], // clusters per crowned mid trunk (min, max)
  crownCloseClusters: 3, // per close trunk, high up, only to hide the cut top
  farCrownClusters: 6,
  crownSize: [1.8, 2.5],
  crownMinHeight: 8.5,

  // Overhang sprays at set path fractions. Heights are above the local ground.
  sprayClearance: 0.7, // metres from the walker's weave tube to the nearest leaf or branch
  spraySize: [0.95, 1.45],
  sprayClusters: 6,

  // Ivy
  ivyCardWidth: [0.3, 0.46], // m, cards are 1.25x taller than wide
  ivyExtraTrunks: 3, // trunks not flagged ivy that still get a small patch
  ivyCardsClose: 22, // per patch on a close trunk
  ivyCardsMid: 15, // per patch on a mid trunk

  // Sunlit and shaded flank tints (vertex colour multipliers).
  sunTint: [1.05, 1.02, 0.95],
  shadeTint: [0.9, 0.96, 0.97],
};

// Foliage look. Multipliers on the leaf card albedo, same idea as the hero canopy (Tree.jsx).
export const LEAF_LOOK = {
  dark: [0.26, 0.37, 0.32], // deep interior, cool blue-green
  lit: [1.12, 1.2, 0.88], // sun touched, warm sage
  translucency: 0.8,
  roughness: 0.72,
  normalScale: 0.8,
  wind: { amplitude: 0.07, speed: 1.1 },
  sprayWind: { amplitude: 0.05, speed: 1.2 },
  alphaTest: 0.5,
};

export const IVY_LOOK = {
  dark: [0.5, 0.64, 0.46], // glossy old leaves
  fresh: [1.12, 1.16, 0.66], // new growth, lighter and warmer
  freshChance: 0.2,
  roughness: 0.45,
  translucency: 0.4,
  wind: { amplitude: 0.01, speed: 1.4 },
};

// Colours for the shader wear (moss, lichen, fresh wood), linear THREE.Colors.
export const WEAR_COLOURS = {
  mossDark: mixc(PALETTE.mossTone, PALETTE.floorDark, 0.55),
  mossLight: mixc(PALETTE.mossTone, PALETTE.leafHighlight, 0.28),
  lichen: mixc(PALETTE.stone, PALETTE.leafHighlight, 0.32).multiplyScalar(0.62),
  // freshly broken wood: warm timber lifted toward cream, then dimmed (it sits in shade and mist)
  wood: mixc(PALETTE.wood, BRAND.cream, 0.42).multiplyScalar(0.78),
};
export const UMBEL_COLOUR = mixc(PALETTE.leafHighlight, PALETTE.warmLight, 0.22);
export const IVY_STEM_COLOUR = mixc(PALETTE.barkDark, PALETTE.floorDark, 0.4);
export const TWIG_COLOUR = mixc(PALETTE.barkDark, PALETTE.stone, 0.14);
export const LICHEN_STRAND = {
  light: scale(rgb255(mixc(PALETTE.stone, PALETTE.leafHighlight, 0.35)), 0.82),
  dark: scale(rgb255(mixc(PALETTE.mossTone, PALETTE.stone, 0.4)), 0.8),
};

// ------------------------------------------------------------------------------------------------
// SPECIES
// ------------------------------------------------------------------------------------------------
// bark:     { kind: "toolkit", ... } uses createBarkTextures; { kind: "smooth", variant } is painted here.
// tileW:    metres of circumference per bark tile (uRepeat = round(circumference / tileW)).
// lobes:    { count, amp, twist } low frequency fluting of the cross section (hornbeam muscles).
// knob:     amplitude of the organic radius noise.
// flare:    extra radius factor at ground level (1 + flare), buttress: peak of the root lobes.
// taper:    radius lost by 22 m of height (fraction of the breast height radius).
// curve:    amplitude (m) of the gentle S curve of the axis.
// moss, lichen: species multipliers for the shader wear.
// leaf:     which leaf card the crown carries.
export const SPECIES = {
  oakA: {
    id: "oakA",
    bark: { kind: "toolkit", seed: 7, size: 768 }, // identical call to the hero tree: a free cache hit
    tileW: 0.95,
    normal: 1.3,
    lobes: { count: 3, amp: 0.04, twist: 0 },
    knob: 0.05,
    flare: 0.5,
    buttress: 0.55,
    taper: 0.26,
    curve: 0.22,
    moss: 1.0,
    lichen: 0.5,
    leaf: "oak",
    tint: [1, 1, 1],
  },
  oakB: {
    id: "oakB",
    // a greyer, more lichened oak: its own paint (384 px keeps a single frame under about 110 ms)
    bark: {
      kind: "toolkit",
      seed: 31,
      size: 384,
      tone: hexOf(mixc(BRAND.timberDark, BRAND.stone, 0.12)),
      moss: 0.1,
      lichen: 0.85,
    },
    tileW: 0.8,
    normal: 1.3,
    lobes: { count: 4, amp: 0.035, twist: 0.05 },
    knob: 0.055,
    flare: 0.45,
    buttress: 0.5,
    taper: 0.3,
    curve: 0.26,
    moss: 0.8,
    lichen: 0.9,
    leaf: "oak",
    tint: [0.97, 0.98, 1.0],
  },
  beech: {
    id: "beech",
    bark: { kind: "smooth", variant: "beech", seed: 5, size: 512 },
    tileW: 1.5,
    normal: 1.0,
    lobes: { count: 2, amp: 0.02, twist: 0 },
    knob: 0.03,
    flare: 0.38,
    buttress: 0.4,
    taper: 0.2,
    curve: 0.12,
    moss: 0.8,
    lichen: 1.1,
    leaf: "beech",
    tint: [1, 1, 1],
  },
  hornbeam: {
    id: "hornbeam",
    bark: { kind: "smooth", variant: "hornbeam", seed: 12, size: 384 },
    tileW: 1.3,
    normal: 1.0,
    lobes: { count: 7, amp: 0.075, twist: 0.1 }, // the fluted muscles; count is reduced for coarse rings
    knob: 0.035,
    flare: 0.3,
    buttress: 0.3,
    taper: 0.25,
    curve: 0.18,
    moss: 0.9,
    lichen: 0.8,
    leaf: "beech",
    tint: [1, 1, 1],
  },
  birch: {
    id: "birch",
    bark: { kind: "smooth", variant: "birch", seed: 9, size: 512 },
    tileW: 1.1,
    normal: 0.9,
    lobes: { count: 2, amp: 0.012, twist: 0 },
    knob: 0.025,
    flare: 0.15,
    buttress: 0.12,
    taper: 0.42,
    curve: 0.32,
    moss: 0.25,
    lichen: 0.25,
    leaf: "sprig",
    tint: [1, 1, 1],
    darkBase: true, // old birch bark is black and fissured for the first metre or so
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

// How the mid trunks are shared out between species (a deterministic interleave, not luck).
export const MID_SPECIES_MIX = { oakA: 6, oakB: 5, beech: 8, hornbeam: 3, birch: 3 };
// Species of the four close trunks (the big parallax moments): smooth beech, an ivied oak, a fluted
// hornbeam and a dark lichened oak. Order follows CLOSE_TRUNKS (c1..c4).
export const CLOSE_SPECIES = ["beech", "oakA", "hornbeam", "oakB"];
// Species of far trunks (cheap instanced, three flavours).
export const FAR_SPECIES = ["beech", "oakA", "beech", "hornbeam", "oakB", "birch"];

// ------------------------------------------------------------------------------------------------
// Smooth bark colours (sRGB bytes)
// ------------------------------------------------------------------------------------------------
export function smoothBarkColours(variant) {
  const stone = col(PALETTE.stone);
  // scale() works on sRGB bytes, so "0.5" really is half as bright on screen
  const greyDark = scale(rgb255(mixc(stone, BRAND.timberDark, 0.35)), 0.5);
  const greyLight = scale(rgb255(mixc(stone, BRAND.timberDark, 0.2)), 0.62);
  const lichen = scale(rgb255(mixc(stone, PALETTE.leafHighlight, 0.3)), 0.72);
  const algae = scale(rgb255(mixc(PALETTE.mossTone, PALETTE.floorDark, 0.2)), 0.9);
  if (variant === "hornbeam") {
    const dark = scale(rgb255(mixc(rgb255ToColor(greyDark), PALETTE.mossTone, 0.2)), 0.82);
    const light = rgb255(mixc(rgb255ToColor(greyLight), PALETTE.mossTone, 0.1));
    return { dark, light, lichen, algae };
  }
  if (variant === "birch") {
    const white = scale(rgb255(mixc(BRAND.cream, BRAND.stone, 0.22)), 0.94);
    const shade = scale(rgb255(mixc(BRAND.cream, BRAND.timberDark, 0.2)), 0.86);
    const black = scale(rgb255(mixc(BRAND.charcoal, BRAND.timberDark, 0.35)), 0.9);
    const brown = rgb255(mixc(BRAND.timber, BRAND.timberDark, 0.5));
    return { dark: shade, light: white, black, brown, lichen, algae };
  }
  return { dark: greyDark, light: greyLight, lichen, algae };
}
function rgb255ToColor(rgb) {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}
export { scale as scaleRGB };
