// Tuning knobs for the Section 2 light and air (AirAndLight.jsx and the air*.js helpers).
// Everything a human might want to adjust after the first real render lives here, with what it does.
// Units are metres and seconds. No em dashes or en dashes anywhere (CLAUDE.md).

// ----- Shadow fit (the sun's shadow camera follows the walker) ------------------------------------------
// HeroScene fits the sun's orthographic shadow camera to SHADOW_REGION only (the hero tree, z -5..6).
// The walk spans z 15 to 3, so while the approach is active LightRamp re-fits the SAME light to a box
// that travels with the camera. HERO_SHADOW_REGION below is a COPY of HeroScene's SHADOW_REGION and must
// match it (HeroScene is not ours to edit): it is what the shadow camera is restored to at progress 0.
export const HERO_SHADOW = {
  halfWidth: 6.5, // box is TREE.x +- 6.5 in x
  yMin: -0.3,
  yMax: 19.5, // TREE.height + 1.5
  zMin: -5,
  zMax: 6,
  radius: 2.5, // HeroScene shadow-radius (PCF kernel width in shadow map texels)
  normalBias4096: 0.014, // HeroScene normalBias for the 4096 map
  normalBias2048: 0.028, // and for the 2048 (touch) map
  pad: 0.4, // HeroScene fit margin so the PCF kernel never samples outside the map
};

export const WALKER_SHADOW = {
  ahead: 6, // box centre this far ahead of the camera along the path
  halfWidth: 11, // 22 m wide (world X)
  halfDepth: 10, // 20 m deep (world Z)
  yMin: -0.5,
  yMax: 20, // high enough that the hero crown (18 m) still shades
  nearExtra: 6, // metres the near plane is pulled toward the sun so canopy casters over the sunward edge are not clipped
  blendEnd: 0.06, // local approach progress at which the walker box is fully in (hero box at 0)
  radiusEnd: 4.5, // shadow.radius at the walker box. Real leaf shadows from 10 m up have a ~10 cm penumbra,
  // about 14 texels at 7 mm per texel. 6 blurred the dapple on the ground and trunks into a near-flat
  // wash in the s2-p040..p075 renders (CLAUDE.md: "dappled moving shadows... never a single flat
  // light"); 4.5 keeps the kernel wide enough to stay smooth (not noisy, per the original comment)
  // while letting individual leaf-shaped shadow shapes actually read at ground level.
  refreshEvery: 6, // frames between shadow map refreshes while active (the hero schedule is also 6)
  centreRate: 3, // 1/s: how quickly the box centre follows its target (smooths the camera weave)
};

// ----- Light ramp curves ------------------------------------------------------------------------------------
// The values themselves come from LIGHT_RAMP in world.js. These only shape WHEN each one moves.
export const RAMP_CURVES = {
  fog: [0.0, 1.0], // smoothstep window on local progress: the haze thins steadily over the whole walk
  sun: [0.1, 1.0], // sun colour and intensity: a little later, the "light brightens" beat is 0.6 to 1.0
  environment: [0.05, 1.0],
  exposure: [0.1, 1.0],
};

// ----- Shadow only canopy (dappled, moving shadows) ------------------------------------------------------------
// Instanced leaf cards 9 to 15 m above the ground that cast shadows and render nothing. They are placed in
// "landing space": pick where the shade should land on the ground, then put the clump on the sun ray above it
// (landing + SUN_DIR * altitude / SUN_DIR.y), so the dapples fall exactly where the plan says.
export const CANOPY = {
  seed: 5081,
  clumps: 96, // total clumps (cards x 2 triangles each). More = more shade. 96 shades about 55 percent of the dirt (45 lit) before trunks and the hero crown add theirs.
  cards: 1, // leaf cards per clump (1 card = 2 triangles, so about 240 triangles in all). 2 cards makes solid masses.
  denseShare: 0.56, // share of clumps using the dense leaf mat (the rest use the broken, more open mat). Raised a
  // little: combined with the tighter shadow.radius above, more of the clumps now cast a crisper,
  // darker shadow shape instead of the mass reading as one soft grey pool.
  altitude: [9, 15], // metres above the ground
  size: [1.1, 2.2], // card width in metres (a leaf is 10 to 15 percent of it, so 11 to 33 cm, softened by the penumbra)
  minSpacing: 0.6, // minimum distance between landing points (clumps may still overlap through their size)
  sPad: 0.07, // corridor extends this far beyond each end of the path (as a path fraction)
  lateralMax: 8, // corridor half width in metres
  // Density map: shade only lands where this fbm is high, so the canopy has real gaps.
  noiseScale: 0.3, // lattice cells per metre (a gap or mass every ~3 m)
  noiseLow: 0.12, // below this value nothing lands, above noiseHigh it is always accepted
  noiseHigh: 0.85,
  // Sway: every clump drifts in a slow ellipse so the dapples slide across the ground and trunks.
  swayShared: 0.26, // metres, a shared gust all clumps lean into
  swayOwn: [0.18, 0.42], // metres, each clump's own amplitude
  swayPeriod: [6.5, 12.5], // seconds
  yawWobble: 0.14, // radians
  wind: { amplitude: 0.05, speed: 1.15 }, // vertex shimmer in the depth pass (local units, times card size)
  // The treehouse is the hero's approved object and Section 2 only glimpses it: no canopy clump may drop leaf shade on
  // it. A clump whose shadow ray would cross this box (cabin and deck, with margin) is lowered below the box instead.
  cabinAvoid: { min: [-0.5, 8.4, -2.4], max: [7.5, 13.0, 4.0] },
  lowAltitude: [5.5, 8.0], // altitude of a lowered clump (a ray from 8 m or lower never reaches 8.4 m)
  shaftClear: 1.5, // extra clear radius around each shaft landing, on top of half its width (metres)
};

// ----- Light shafts ---------------------------------------------------------------------------------------------
// Each shaft is rooted in a canopy gap up on the sun ray and lands on the floor 1 to 3 m beside the path. No two
// share a width, length, taper, streak scale, tint or breathing period. `lateral` is + right, - left of the
// centreline. They alternate sides and sit opposite the signposts (SIGNS) so the boards are never washed out.
export const SHAFTS = [
  { s: 0.2, lateral: 2.4, length: 11.0, width: 1.7, taper: 1.25, gain: 1.0, period: 10.4, phase: 0.6, seed: 0.13, tint: 0.45, streak: 3.4 },
  { s: 0.41, lateral: -2.7, length: 13.4, width: 2.5, taper: 0.9, gain: 0.8, period: 12.6, phase: 2.7, seed: 0.51, tint: 0.62, streak: 2.3 },
  { s: 0.6, lateral: 1.8, length: 9.2, width: 1.2, taper: 1.5, gain: 1.1, period: 9.3, phase: 4.4, seed: 0.77, tint: 0.35, streak: 4.6 },
  { s: 0.8, lateral: -2.2, length: 12.2, width: 2.0, taper: 1.1, gain: 0.9, period: 11.5, phase: 1.5, seed: 0.93, tint: 0.55, streak: 3.0 },
];
export const SHAFT_LOOK = {
  strength: 0.55, // overall additive strength (peak alpha of the brightest, ground end of a shaft)
  under: 0.35, // metres the quad reaches below the landing point (the ground hides it)
  nearFade: [0.9, 3.0], // metres from the camera: invisible below the first, full above the second
  haze: 1.2, // exponent on (fog density / hero fog density): shafts weaken as the haze thins
  dimWithT: 0.28, // extra dimming at t = 1 as the sun climbs (0 = none)
  breath: 0.22, // opacity swing around the mean (period per shaft)
};

// ----- Dust, pollen, midges and seeds ----------------------------------------------------------------------------
export const DUST = {
  seed: 7712,
  inBeam: 96, // motes bound to the shafts (split by shaft volume)
  free: 40, // ambient motes in the wrap volume around the walker
  midges: 10, // tiny insects hovering in three swarms near the path
  seeds: 6, // drifting seeds (pale, a little larger, falling slowly)
  size: [0.02, 0.04], // metres
  seedSize: [0.045, 0.07],
  minPx: 3.0, // smallest sprite in pixels per dpr unit, dimmed by the lost coverage
  freeBrightness: 0.1, // outside the shafts motes are nearly invisible
  beamBrightness: 3.4, // inside a shaft they glint
  box: [18, 6, 18], // wrap volume (x, y, z) in metres, centred 5 m ahead of the camera
  boxY0: 0.2, // bottom of the wrap volume above the world origin
  boxAhead: 5,
};

// Reduced motion freezes shafts and motes at this clock time (shafts near their mean brightness).
export const FROZEN_TIME = 7.0;
