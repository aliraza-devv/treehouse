import * as THREE from "three";

// Shared contract for every hero scene component. Change values here, not inline.

export const PALETTE = {
  barkDark: "#5C3A1E",
  bark: "#6B4226",
  woodDark: "#8B6914",
  wood: "#A67C3B",
  leafDark: "#2D5016",
  leafMid: "#4A7A2E",
  leafHighlight: "#6B8F3A",
  floorDark: "#1A2E0F",
  floorLight: "#2B3D1A",
  fogDark: "#A0ADB8",
  fog: "#B8C4CC",
  skyLow: "#C5D5E0",
  skyHigh: "#E0E8EE",
  ambient: "#8BA4B8",
  key: "#FFF5E6",
  particle: "#FFF8E7",
  pageBg: "#0d1708",
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
  position: [0, 1.0, 14],
  pitchDeg: 17,
  fov: 52,
  near: 0.1,
  far: 140,
};

// Point the camera looks at: 20 units ahead along its pitched forward vector (-Z, tilted up).
export function getCameraTarget() {
  const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
  const [x, y, z] = CAMERA.position;
  return [x, y + Math.sin(pitch) * 20, z - Math.cos(pitch) * 20];
}

export const LIGHT = {
  keyPosition: [8, 15, -5],
  keyColor: PALETTE.key,
  keyIntensity: 1.5,
  ambientColor: PALETTE.ambient,
  ambientIntensity: 0.3,
};

// THREE.FogExp2 transmittance is exp(-(density * distance)^2).
// 0.036 leaves ~76% at 15 units (treehouse clear) and ~33% at 30 units (background faded).
export const FOG = { color: PALETTE.fog, density: 0.036 };

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
