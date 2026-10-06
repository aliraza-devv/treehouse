import * as THREE from "three";

// Shared contract for every hero scene component. Change values here, not inline.

// Official Treehouse Life brand colours (owner supplied). UI uses these directly.
export const BRAND = {
  green: "#6F9D68", // primary brand green, muted natural
  greenLight: "#B6D4A5", // soft leaf / sage
  forest: "#18251C", // deep forest, very dark green
  moss: "#66745A", // muted secondary green
  timber: "#8A633F", // warm timber, natural wood brown
  timberDark: "#49372A", // dark timber, deep bark brown
  cream: "#F1EEE4", // warm cream, natural off-white
  stone: "#D8D5C9", // soft stone, secondary neutral
  charcoal: "#1C211D", // UI / text dark
  warmLight: "#D89A52", // lantern / sunset accent
};

// Scene base colours (albedo guidance). They are derived from the brand palette:
// the brand swatch is the mid tone, shadow and highlight tones are darker/lighter
// shades of the same hue. Realistic lighting, mist and grade then push them around,
// so albedo can sit a little brighter than what ends up on screen.
// Fog, sky and the cool ambient have no brand equivalent (a misty morning is cool
// blue-gray), so they keep the brief values.
export const PALETTE = {
  barkDark: BRAND.timberDark, // fissures and shaded bark
  bark: "#5E4733", // sun-dried ridges, lifted from dark timber
  woodDark: BRAND.timber, // weathered cedar, shadow side
  wood: "#A8815A", // fresh or sunlit boards, lifted from warm timber
  leafDark: "#3D5A3A", // deep canopy interior, darkened brand green
  leafMid: BRAND.green, // main leaf tone
  leafHighlight: BRAND.greenLight, // sunlit, backlit leaf edges
  mossTone: BRAND.moss, // moss on bark, roofs, rocks, ground cover
  floorDark: BRAND.forest, // forest floor shadow
  floorLight: "#3A4631", // litter and moss patches, dark moss
  fogDark: "#A0ADB8",
  fog: "#9DAAB4",
  skyLow: "#C5D5E0",
  skyHigh: "#E0E8EE",
  skyCloud: "#F2F6F9", // thin cloud veil in the lighting-only environment capture
  litterWarm: "#7A5A34", // fallen oak and beech leaf litter, warm end (timber, darkened)
  lampGlow: `#${new THREE.Color(BRAND.warmLight).lerp(new THREE.Color(BRAND.cream), 0.3).getHexString()}`, // bulb and lantern core: warm light lifted toward cream
  ambient: "#8BA4B8",
  key: "#FFF5E6",
  warmLight: BRAND.warmLight, // lanterns, interior glow, sun glow, sunset accent
  particle: BRAND.cream, // dust and pollen motes
  cream: BRAND.cream,
  stone: BRAND.stone,
  pageBg: BRAND.forest,
};

// Hero tree. The treehouse platform sits where the main branches fork,
// about 65-75% up the trunk length that is visible in frame.
export const TREE = {
  x: 2.2,
  z: 0,
  height: 18,
  forkY: 8.4,
  platformY: 8.8,
};

// Camera: low on the forest floor, pitched up toward the canopy.
// Sway amplitude and period are owned by hooks/useIdle.js.
export const CAMERA = {
  position: [0, 0.9, 15],
  pitchDeg: 20,
  fov: 50,
  near: 0.1,
  far: 140,
};

// Point the camera looks at: 20 units ahead along its pitched forward vector (-Z, tilted up).
export function getCameraTarget() {
  const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
  const [x, y, z] = CAMERA.position;
  return [x, y + Math.sin(pitch) * 20, z - Math.cos(pitch) * 20];
}

// Intensities are in three.js physical units: keyIntensity 3.0 is the equivalent of the brief's
// 1.5 under the legacy (pi scaled) lighting mode, and ambient 0.2 sits just under the brief's 0.3
// because the sky IBL already supplies the cool fill.
export const LIGHT = {
  keyPosition: [8, 15, -5],
  // Where the sun looks: a point on the trunk a little above the platform. The shadow frustum,
  // the sky disc, the god ray axis and the particle forward scatter all derive the sun
  // direction from keyPosition - target, so shadows and visible shafts agree.
  target: [TREE.x + 0.8, 7, 0],
  keyColor: PALETTE.key,
  keyIntensity: 3.0,
  ambientColor: PALETTE.ambient,
  ambientIntensity: 0.2,
};

// THREE.FogExp2 transmittance is exp(-(density * distance)^2).
// 0.028 leaves ~83% at 15 units (treehouse clear), ~49% at 30 units and ~21% at 45 (faded).
// Garden pass: lighter fog so the lawn, shrub beds and fence read clearly (was 0.028, which hid the ground).
export const FOG = { color: PALETTE.fog, density: 0.012 };

// Rolling forest floor. Flattened near the hero tree and under the camera
// so the roots and the lens never clip into a hill.
export function groundHeight(x, z) {
  const toTree = Math.hypot(x - TREE.x, z - TREE.z);
  const toCam = Math.hypot(x - CAMERA.position[0], z - CAMERA.position[2]);
  const open =
    THREE.MathUtils.smoothstep(toTree, 3, 12) * THREE.MathUtils.smoothstep(toCam, 2, 9);
  const h = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.9 + Math.sin(x * 0.37 + z * 0.29) * 0.22;
  return h * open;
}

// World position of a point seen through the BASE camera: ndcX/ndcY in [-1, 1]
// (-1,-1 bottom-left, 1,1 top-right) at `dist` units along that view ray.
// Use it to place foreground leaves "at the edge of the frame" without guessing numbers.
export function viewToWorld(ndcX, ndcY, dist, aspect = 16 / 9) {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  cam.position.fromArray(CAMERA.position);
  cam.lookAt(...getCameraTarget());
  cam.updateMatrixWorld(true);
  const point = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam);
  const dir = point.sub(cam.position).normalize();
  return cam.position.clone().addScaledVector(dir, dist);
}

// ---------------------------------------------------------------------------
// Tree structure contract shared by Tree.jsx (builds the wood) and Treehouse.jsx
// (builds the cabin on top of it). Azimuth is measured in the XZ plane from +X
// toward +Z (so 90 degrees points at the camera), tilt is degrees above horizontal.
// ---------------------------------------------------------------------------

// Trunk radius in world units at height y: slim taper plus a wide buttress flare near the ground.
export function trunkRadiusAt(y) {
  const t = THREE.MathUtils.clamp(y / TREE.height, 0, 1);
  const taper = THREE.MathUtils.lerp(0.95, 0.5, t);
  const flare = 1 + 1.1 * Math.exp(-y * 0.8);
  return taper * flare;
}

// The three main fork branches the platform rests on. Tree.jsx grows them as curved,
// tapering tubes that start INSIDE the trunk at y; Treehouse.jsx braces onto them.
export const FORK_BRANCHES = [
  { y: TREE.forkY, azimuthDeg: 15, tiltDeg: 8, length: 4.8, radius: 0.34 },
  { y: TREE.forkY + 0.15, azimuthDeg: 165, tiltDeg: 6, length: 4.0, radius: 0.3 },
  { y: TREE.forkY - 0.1, azimuthDeg: 100, tiltDeg: 4, length: 3.4, radius: 0.28 },
];

// Deck footprint relative to the trunk axis (x, z offsets of the deck centre) and size.
// Deck extends toward the camera (+Z) so the underside is visible from the forest floor.
export const PLATFORM = {
  y: TREE.platformY,
  centerOffset: [1.2, 0.8],
  width: 6.2,
  depth: 4.8,
  thickness: 0.22,
};

// Hard triangle budget for the whole hero scene (CLAUDE.md: under 50k per section).
// Suggested split: tree trunk and branches 8k, canopy cards 12k, treehouse 12k,
// forest ground and background 12k, foreground 4k.
export const TRIANGLE_BUDGET = 50000;
