import { MathUtils } from "three";

// World position of the hero tree trunk (see Scene.jsx).
export const TREE_X = 2.6;

// Gentle rolling ground. Two sine layers keep it cheap and deterministic.
// The terrain is flattened around the hero tree so the stairs and roots sit cleanly.
export function groundHeight(x, z) {
  const dist = Math.hypot(x - TREE_X, z);
  // 0 inside 12 units of the tree, easing up to 1 beyond 24 units.
  const open = MathUtils.smoothstep(dist, 12, 24);
  const h = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.4 + Math.sin(x * 0.31 + z * 0.23) * 0.35;
  return h * open;
}
