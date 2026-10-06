import * as THREE from "three";
import { groundHeight } from "@/lib/sceneConfig";
import { atPath } from "@/lib/sections/world";
import { SHAFTS } from "./airTuning";

// Light shafts: PLAN and GEOMETRY (pure three.js, no React). The shader lives in airShaders.js and the
// material in AirAndLight.jsx.
//
// Each shaft is one quad: four vertices, merged with the others into ONE mesh (one draw call). The quad is a
// CYLINDRICAL BILLBOARD about the beam axis: the vertex shader turns it every frame so its normal faces the
// camera as much as the axis constraint allows, which means it can never go edge on (it only collapses when
// the camera looks straight down the beam, and then it reads as a soft glow). All shape work (soft edges,
// streaks, fade at both ends) is in the fragment shader, so the geometry needs nothing more.

// One entry per shaft: where it lands (on the ground beside the path), its length along the sun ray and the
// per shaft look parameters. `sunDir` is the unit vector toward the sun (SUN_DIR from GodRays.jsx).
export function planShafts() {
  return SHAFTS.map((def, index) => {
    const p = atPath(def.s, def.lateral);
    const y = groundHeight(p.x, p.z);
    return { index, def, landing: [p.x, y, p.z] };
  });
}

// Merged geometry. Attributes (all constant per shaft, repeated on its four vertices):
//   position  the landing point (three needs it; the vertex shader rebuilds the real position)
//   aCorner   x: -1 / +1 across the beam, y: 0 at the landing point end, 1 at the sky end
//   aBase     xyz landing point, w beam length (metres)
//   aShapeA   x width at the landing point, y taper (width at the sky end / width at the landing end),
//             z noise seed, w breathing phase
//   aShapeB   x breathing period (s), y gain, z tint (0 cream .. 1 warm light), w streak frequency across the beam
export function buildShaftGeometry(plan) {
  const positions = [];
  const corners = [];
  const base = [];
  const shapeA = [];
  const shapeB = [];
  const index = [];
  plan.forEach(({ def, landing }, i) => {
    for (const [cx, cy] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ]) {
      positions.push(landing[0], landing[1], landing[2]);
      corners.push(cx, cy);
      base.push(landing[0], landing[1], landing[2], def.length);
      shapeA.push(def.width, def.taper, def.seed, def.phase);
      shapeB.push(def.period, def.gain, def.tint, def.streak);
    }
    const o = i * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  g.setAttribute("aBase", new THREE.Float32BufferAttribute(base, 4));
  g.setAttribute("aShapeA", new THREE.Float32BufferAttribute(shapeA, 4));
  g.setAttribute("aShapeB", new THREE.Float32BufferAttribute(shapeB, 4));
  g.setIndex(index);
  return g;
}
