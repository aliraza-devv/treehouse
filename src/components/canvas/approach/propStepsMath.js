// Pure maths for the first wooden steps (TrunkSteps.jsx): a mirror of the hero trunk and its buttress roots,
// and the placement of the treads against them. No canvas, no React: it runs under plain node.
//
// THE HERO TRUNK IS A LUMPY TUBE, so the treads are scribed to it. src/components/canvas/Tree.jsx builds the trunk
// (addTrunk: radius from trunkRadiusAt, three octaves of noise, six buttress flutes) and six buttress root tubes
// (addRoots). The mirror below copies those formulas (same noise seed, same buttress table, same root curves), so
// heroSolid.sd() is the signed distance to the hero wood: negative inside the trunk or a root. If Tree.jsx changes
// its trunk or roots, change HERO_BUTTRESS / the radius formula here to match; nothing else depends on it.
//
// The six buttress roots are the reason the steps do not start where TRUNK_STEPS.azimuthDeg (84) points: that is the
// crest of the biggest root, a ridge 1.3 m high where it meets the trunk. The treads start in the FLUTE (the valley)
// between that root and the one at 143 degrees, which is also the side that faces the end pose camera, and drift
// toward the right as the roots merge into the trunk above 1.8 m. Every tread's back edge is then SCRIBED: it follows
// the solid at a small gap, the way a carpenter scribes a board to an uneven surface.

import * as THREE from "three";
import { TREE, trunkRadiusAt, groundHeight } from "@/lib/sceneConfig";
import { TRUNK_STEPS } from "@/lib/sections/world";
import { createNoise, smoothstep } from "@/lib/noise";
import { createRng, range } from "@/lib/random";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const STEPS_LOOK = {
  valleyAzDeg: 115, // azimuth of the first treads: the flute between the buttress roots at 84 and 143 (from +X toward +Z)
  holdSteps: 5, // treads that stay in the flute before the spiral begins (the roots are still proud of the trunk)
  driftDegPerStep: -8, // then the spiral drifts to the right, toward the roots' side, about 91 degrees at the top
  gap: 0.026, // metres between the scribed back edge of a tread and the wood
  widthRange: [0.64, 0.76],
  depthRange: [0.25, 0.31], // beyond the deepest point of the scribed back edge
  thicknessRange: [0.052, 0.066],
  wearRange: [0.003, 0.009], // how deep the boots have dished the middle of each tread (metres)
  profileSamples: 5, // rings along a tread's width
  marchStep: 0.01,
};

// ------------------------------------------------------------------------------------------------
// The mirror of the hero wood (tree local space: x, z from the TREE axis at ground, y up)
// ------------------------------------------------------------------------------------------------
const HERO_NOISE = createNoise(41); // Tree.jsx buildTreeData: createNoise(41)
// Tree.jsx BUTTRESS: azimuth (deg from +X toward +Z), length, start radius, angular half width (radians)
const HERO_BUTTRESS = [
  { az: 24, len: 4.6, r0: 0.6, w: 0.42 },
  { az: 84, len: 4.9, r0: 0.62, w: 0.4 },
  { az: 143, len: 4.2, r0: 0.52, w: 0.38 },
  { az: 212, len: 4.8, r0: 0.6, w: 0.42 },
  { az: 278, len: 3.9, r0: 0.5, w: 0.36 },
  { az: 330, len: 4.4, r0: 0.55, w: 0.4 },
];
// Bumps on the trunk below 5 m: the swell where the broken stub (STUBS[0] in Tree.jsx) left, and the three burls (BURLS).
// { y, az (radians), amp (relative radius), h (vertical extent m), w (arc m) }
const HERO_BUMPS = [
  { y: 3.4, az: 62 * DEG, amp: (0.45 * 0.11) / trunkRadiusAt(3.4), h: 1.6 * 0.11 + 0.25, w: 1.5 * 0.11 + 0.25 },
  { y: 4.2, az: 95 * DEG, amp: 0.1, h: 0.55, w: 0.45 },
  { y: 6.0, az: 240 * DEG, amp: 0.08, h: 0.5, w: 0.4 },
  { y: 2.9, az: 330 * DEG, amp: 0.09, h: 0.45, w: 0.5 },
];

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// trunk axis offset at height y (the S curve in Tree.jsx; zero at the fork)
const axisX = (y) => 0.2 * Math.sin(0.45 * (y - TREE.forkY));
const axisZ = (y) => 0.15 * (Math.sin(0.31 * (y - TREE.forkY) + 0.4) - Math.sin(0.4));

// Trunk radius at height y and azimuth az (radians). Mirrors Tree.jsx addTrunk radiusAt.
function trunkRadius(y, az) {
  const yy = Math.max(y, 0);
  const cx = Math.cos(az);
  const sz = Math.sin(az);
  let r = trunkRadiusAt(yy);
  r *= 1 - 0.45 * smoothstep(16.4, 18.2, y);
  const lobes = HERO_NOISE.simplex3(cx * 1.25, sz * 1.25, y * 0.22);
  const plates = HERO_NOISE.simplex3(cx * 3.6 + 10, sz * 3.6, y * 0.7);
  const ridges = HERO_NOISE.simplex3(cx * 8.5, sz * 8.5 + 5, y * 1.6);
  let k = 1 + 0.055 * lobes + 0.028 * plates + 0.012 * ridges;
  const A = 0.28 * Math.exp(-yy / 1.7);
  for (const b of HERO_BUTTRESS) {
    const d = angDiff(az, b.az * DEG) / b.w;
    k += A * Math.exp(-d * d);
  }
  for (const bp of HERO_BUMPS) {
    const dy = (y - bp.y) / bp.h;
    const da = (angDiff(az, bp.az) * r) / bp.w;
    k += bp.amp * Math.exp(-(dy * dy + da * da));
  }
  return r * k;
}

// The six buttress roots as chains of ORIENTED ellipsoids, tree local. Mirrors Tree.jsx addRoots: the same control
// points, a centripetal Catmull-Rom curve, the radius rAt(t) and the flattened section (taller than wide near the
// trunk: semi axes rx sideways and ry along the in-plane "up"). Each sample carries the tube's own frame (tangent T,
// lateral S, in-plane up U) because near the trunk the roots run steeply down and a world aligned ellipsoid would be
// wrong there. Everything is 5 percent generous.
function buildRoots() {
  const roots = [];
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  HERO_BUTTRESS.forEach((br, i) => {
    const az = br.az * DEG;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const pts = [];
    const N = 9;
    const rAt = (t) => br.r0 * (0.14 + 0.86 * Math.pow(1 - t, 1.1));
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = 0.4 + (br.len - 0.4) * t;
      const sway = 0.35 * HERO_NOISE.perlin2(i * 4.1 + 0.3, t * 2.2) * Math.sin(Math.PI * t);
      const x = dx * d - dz * sway;
      const z = dz * d + dx * sway;
      const prof = 2.0 * Math.pow(1 - t, 2.4) + 0.12;
      const rr = rAt(t);
      let y = Math.max(prof, groundHeight(TREE.x + x, TREE.z + z) + rr * 0.35);
      y -= rr * 1.3 * smoothstep(0.8, 1.0, t);
      pts.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const S = 72;
    const STRIDE = 14;
    const data = new Float32Array((S + 1) * STRIDE);
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const L = new THREE.Vector3();
    for (let m = 0; m <= S; m++) {
      const u = m / S;
      const p = curve.getPointAt(u);
      curve.getTangentAt(u, T).normalize();
      U.copy(WORLD_UP).addScaledVector(T, -WORLD_UP.dot(T));
      if (U.lengthSq() < 1e-6) U.set(1, 0, 0);
      U.normalize();
      L.crossVectors(T, U).normalize();
      const flat = 1 - smoothstep(0, 0.7, u);
      const rr = rAt(u);
      data.set([p.x, p.y, p.z, T.x, T.y, T.z, L.x, L.y, L.z, U.x, U.y, U.z, rr * (1 - 0.22 * flat) * 1.05, rr * (1 + 0.3 * flat) * 1.05], m * STRIDE);
    }
    roots.push({ az, data, count: S + 1, stride: STRIDE });
  });
  return roots;
}

export const HERO = (() => {
  const roots = buildRoots();
  // world space signed distance to the hero wood (trunk and roots): negative inside
  const sd = (wx, wy, wz) => {
    const px = wx - TREE.x;
    const pz = wz - TREE.z;
    const cx = axisX(wy);
    const cz = axisZ(wy);
    const rx = px - cx;
    const rz = pz - cz;
    const rho = Math.hypot(rx, rz);
    let d = (rho - trunkRadius(wy, Math.atan2(rz, rx))) * 0.88; // the flare slopes: a vertical offset is not a normal offset
    for (const r of roots) {
      // only roots in front of the point (within 80 degrees) can matter
      const a = Math.atan2(rz, rx);
      if (Math.abs(angDiff(a, r.az)) > 1.5) continue;
      const st = r.stride;
      for (let m = 0; m < r.count; m++) {
        const o = m * st;
        const ddx = px - r.data[o];
        const ddy = wy - r.data[o + 1];
        const ddz = pz - r.data[o + 2];
        const pT = ddx * r.data[o + 3] + ddy * r.data[o + 4] + ddz * r.data[o + 5];
        const pS = ddx * r.data[o + 6] + ddy * r.data[o + 7] + ddz * r.data[o + 8];
        const pU = ddx * r.data[o + 9] + ddy * r.data[o + 10] + ddz * r.data[o + 11];
        const rxs = r.data[o + 12];
        const rys = r.data[o + 13];
        // ellipsoid: sideways rx, in-plane up ry, and 0.12 m along the tube (the samples are 7 cm apart, so the
        // chain has no scallops); the distance estimate is scaled by the smaller section axis
        const q = Math.sqrt((pT * pT) / 0.0144 + (pS * pS) / (rxs * rxs) + (pU * pU) / (rys * rys));
        const e = (q - 1) * Math.min(rxs, rys);
        if (e < d) d = e;
      }
    }
    return d;
  };
  return {
    sd,
    roots,
    axis: (y) => ({ x: TREE.x + axisX(y), z: TREE.z + axisZ(y) }),
    radius: trunkRadius,
    // a point ON the trunk surface (ignoring the roots): azimuth az (radians), height y
    surface: (y, az) => {
      const r = trunkRadius(y, az);
      return { x: TREE.x + axisX(y) + Math.cos(az) * r, y, z: TREE.z + axisZ(y) + Math.sin(az) * r };
    },
    // outward normal of the wood at a world point (finite differences of sd)
    normal: (wx, wy, wz, e = 0.02) => {
      const n = new THREE.Vector3(sd(wx + e, wy, wz) - sd(wx - e, wy, wz), sd(wx, wy + e, wz) - sd(wx, wy - e, wz), sd(wx, wy, wz + e) - sd(wx, wy, wz - e));
      return n.normalize();
    },
  };
})();

// ------------------------------------------------------------------------------------------------
// Placement: one record per tread
// ------------------------------------------------------------------------------------------------
// Returns an array of { k, az, top, bottom, thickness, width, depth, ur, ul, centre: {x, z}, s: [lateral samples],
// back: [radial of the scribed back edge per sample], front, anchor: {radial, normal}, wear, pitch, yaw }.
// Radial coordinates are metres from the trunk axis at that height along ur (unit vector at azimuth az).
export function* placeTreadsStaged() {
  const L = STEPS_LOOK;
  const rng = createRng(31337);
  const out = [];
  for (let k = 0; k < TRUNK_STEPS.count; k++) {
    const top = TRUNK_STEPS.baseY + k * TRUNK_STEPS.rise; // top surface of the tread
    const thickness = range(rng, L.thicknessRange[0], L.thicknessRange[1]);
    const bottom = top - thickness;
    const azDeg = L.valleyAzDeg + (k >= L.holdSteps ? (k - L.holdSteps + 1) * L.driftDegPerStep : 0) + range(rng, -2.2, 2.2);
    const az = azDeg * DEG;
    const ur = { x: Math.cos(az), z: Math.sin(az) };
    const ul = { x: -Math.sin(az), z: Math.cos(az) }; // along +azimuth (to the walker's left when facing the trunk from az 90)
    const ymid = (top + bottom) / 2;
    const ax = HERO.axis(ymid);
    const width = range(rng, L.widthRange[0], L.widthRange[1]);
    const nS = L.profileSamples;
    const s = [];
    for (let i = 0; i < nS; i++) s.push(-width / 2 + (width * i) / (nS - 1));
    // march outward from inside the trunk until a sample column is clear (at the top, middle and bottom heights)
    const back = s.map((si) => {
      const r0 = Math.max(0.3, HERO.radius(ymid, az) * 0.55);
      for (let r = r0; r < 6; r += L.marchStep) {
        const x = ax.x + ur.x * r + ul.x * si;
        const z = ax.z + ur.z * r + ul.z * si;
        let clear = true;
        for (const yy of [bottom - 0.01, ymid, top + 0.01]) {
          if (HERO.sd(x, yy, z) < L.gap) {
            clear = false;
            break;
          }
        }
        if (clear) return r;
      }
      return 3;
    });
    // dilate: a bump between two samples must not poke through, so each sample takes the max of its neighbours
    const b2 = back.map((v, i) => Math.max(v, back[Math.max(0, i - 1)] - 0.004, back[Math.min(nS - 1, i + 1)] - 0.004));
    const depth = range(rng, L.depthRange[0], L.depthRange[1]);
    const front = Math.max(...b2) + depth;
    // the surface point under the middle of the tread's back edge (where the bracket plate sits)
    let rs = 0.5;
    for (let r = 0.3; r < 6; r += 0.005) {
      if (HERO.sd(ax.x + ur.x * r, bottom - 0.05, ax.z + ur.z * r) > 0) {
        rs = r;
        break;
      }
    }
    const anchorPt = { x: ax.x + ur.x * rs, y: bottom - 0.05, z: ax.z + ur.z * rs };
    out.push({
      k,
      az,
      azDeg,
      top,
      bottom,
      thickness,
      width,
      depth,
      ur,
      ul,
      axis: ax,
      s,
      back: b2,
      front,
      anchor: { radial: rs, point: anchorPt, normal: HERO.normal(anchorPt.x, anchorPt.y, anchorPt.z) },
      wear: range(rng, L.wearRange[0], L.wearRange[1]),
      pitch: range(rng, 0, 0.026), // the tread tilts outward-down a degree or so so the rain runs off
      yaw: range(rng, -0.035, 0.035),
      seed: 500 + k,
    });
    if (k % 2 === 1) yield; // two treads per chunk: each is a few thousand signed distance queries
  }
  return out;
}

// All eight in one go (for the dev checks)
export function placeTreads() {
  const g = placeTreadsStaged();
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
