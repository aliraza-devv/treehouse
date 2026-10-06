import * as THREE from "three";
import { groundHeight } from "@/lib/sceneConfig";
import { createNoise, smoothstep } from "@/lib/noise";
import { createRng, range } from "@/lib/random";
import { PATH_LENGTH, atPath } from "@/lib/sections/world";
import { CANOPY } from "./airTuning";

// The shadow only canopy: PLAN (where the clumps are and how they move), GEOMETRY (a leaf mat of
// horizontal cards) and the per frame MATRICES. Pure three.js and maths, no React, so it can be run
// in node for tuning. See AirAndLight.jsx for how it is rendered and why it casts without being seen.
//
// Landing space. The plan is made on the GROUND: choose where shade should fall (a landing point), then lift the
// clump up the sun ray above it: position = landing + sunDir * (altitude / sunDir.y). Because the sun ray is
// exactly the direction the shadow map projects along, a clump's shadow lands on its landing point (plus the
// sway offset) whatever the altitude. That is why the canopy is not "above the path" in x and z: for a sun 49
// degrees up it hangs 7 to 12 m toward the sun (+X, -Z) from where its shade falls.

const TAU = Math.PI * 2;

// A point in the corridor: path fraction s (may run a little past 0 or 1, extrapolated along the end
// tangent) and a lateral offset in metres. Returns { x, y, z } with y the ground height.
export function corridorPoint(s, lateral) {
  const c = THREE.MathUtils.clamp(s, 0, 1);
  const p = atPath(c, lateral);
  const over = (s - c) * PATH_LENGTH; // metres beyond the end of the centreline
  const x = p.x + p.tx * over;
  const z = p.z + p.tz * over;
  return { x, y: groundHeight(x, z), z };
}

// Does the segment from the ground point `g` up the sun ray (length `lift`) cross the box {min, max}? Slab test:
// the clump sits at g + sunDir * lift and its shadow ray runs back down the same line, so the clump shades the
// box exactly when this segment passes through it.
function rayCrossesBox(g, sunDir, lift, box) {
  let t0 = 0;
  let t1 = lift;
  const o = [g.x, g.y, g.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(sunDir[i]) < 1e-6) {
      if (o[i] < box.min[i] || o[i] > box.max[i]) return false;
      continue;
    }
    let a = (box.min[i] - o[i]) / sunDir[i];
    let b = (box.max[i] - o[i]) / sunDir[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// shaftLandings: [{ x, z, radius }] discs that must stay clear so each light shaft has a gap to come through
// and a lit pool where it lands.
// Returns an array of clump descriptors (plain data, deterministic: the same on every load).
export function planCanopy({ sunDir, shaftLandings = [] }) {
  const rng = createRng(CANOPY.seed);
  const noise = createNoise(CANOPY.seed);
  const clumps = [];
  const sunUp = Math.max(0.3, sunDir[1]);
  let guard = 0;
  while (clumps.length < CANOPY.clumps && guard++ < 9000) {
    const s = range(rng, -CANOPY.sPad, 1 + CANOPY.sPad);
    // Triangular distribution (sum of two uniforms): clumps gather over the path where the shade matters and
    // thin out toward the edges of the corridor.
    const lateral = (rng() + rng() - 1) * CANOPY.lateralMax;
    const ground = corridorPoint(s, lateral);
    // Real gaps: only land where the density field is high.
    const n = noise.fbm2(ground.x * CANOPY.noiseScale, ground.z * CANOPY.noiseScale, 3, 0, 0, 0.5) * 0.5 + 0.5;
    if (rng() > smoothstep(CANOPY.noiseLow, CANOPY.noiseHigh, n)) continue;
    if (shaftLandings.some((l) => Math.hypot(l.x - ground.x, l.z - ground.z) < l.radius)) continue;
    if (clumps.some((c) => Math.hypot(c.landing[0] - ground.x, c.landing[2] - ground.z) < CANOPY.minSpacing)) continue;

    let altitude = range(rng, CANOPY.altitude[0], CANOPY.altitude[1]);
    // Keep leaf shade off the treehouse: if this clump's shadow ray would cross the cabin box, lower it.
    if (rayCrossesBox(ground, sunDir, altitude / sunUp, CANOPY.cabinAvoid)) altitude = range(rng, CANOPY.lowAltitude[0], CANOPY.lowAltitude[1]);
    const lift = altitude / sunUp; // distance along the sun ray
    const ownAmp = range(rng, CANOPY.swayOwn[0], CANOPY.swayOwn[1]);
    const dir = rng() * TAU;
    clumps.push({
      species: rng() < CANOPY.denseShare ? "dense" : "broken",
      landing: [ground.x, ground.y, ground.z],
      // Base position on the sun ray above the landing point.
      base: [ground.x + sunDir[0] * lift, ground.y + sunDir[1] * lift, ground.z + sunDir[2] * lift],
      size: range(rng, CANOPY.size[0], CANOPY.size[1]),
      yaw: rng() * TAU,
      tilt: [range(rng, -0.2, 0.2), range(rng, -0.2, 0.2)],
      // Own sway: an ellipse (amp along dir, 0.6 amp across) at its own period and phase.
      swayDir: [Math.cos(dir), Math.sin(dir)],
      swayAmp: ownAmp,
      swayPeriod: range(rng, CANOPY.swayPeriod[0], CANOPY.swayPeriod[1]),
      swayPhase: rng() * TAU,
      wobblePeriod: range(rng, 7, 14),
      wobblePhase: rng() * TAU,
    });
  }
  return clumps;
}

// A "leaf mat": CANOPY.cards horizontal quads, rotated about Y by 360 / cards degrees apart (plus a little
// jitter), each tipped a few degrees and stacked 0.14 apart, UV covering the full leaf card. Seen from above (the
// sun) they overlap into a rosette of leaves with gaps, which is what a branch tip looks like from below the
// light. Unit size: the instance matrix scales x and z by the clump size. 2 triangles per card.
export function buildLeafMatGeometry(seed = 1) {
  const rng = createRng(seed * 977 + 13);
  const positions = [];
  const normals = [];
  const uvs = [];
  const index = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const corners = [
    [-0.5, -0.5, 0, 0],
    [0.5, -0.5, 1, 0],
    [0.5, 0.5, 1, 1],
    [-0.5, 0.5, 0, 1],
  ];
  const cards = CANOPY.cards;
  for (let k = 0; k < cards; k++) {
    const yaw = (k * TAU) / cards + range(rng, -0.25, 0.25);
    // Quad authored in the XY plane facing +Z; the euler first lays it flat (-90 degrees about X), then tips it.
    e.set(-Math.PI / 2 + range(rng, -0.16, 0.16), yaw, range(rng, -0.16, 0.16), "YXZ");
    q.setFromEuler(e);
    nrm.set(0, 0, 1).applyQuaternion(q);
    const yOff = (k - (cards - 1) / 2) * 0.14;
    const base = positions.length / 3;
    for (const [cx, cy, u, vv] of corners) {
      v.set(cx, cy, 0).applyQuaternion(q);
      positions.push(v.x, v.y + yOff, v.z);
      normals.push(nrm.x, nrm.y, nrm.z);
      uvs.push(u, vv);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

// The shared gust: a slow lean all clumps follow together (so the whole canopy breathes), toward (0.8, -0.6).
// Returns the offset in metres.
export function gustOffset(time, out = { x: 0, z: 0 }) {
  const g = (Math.sin((TAU * time) / 9.3) + 0.5 * Math.sin((TAU * time) / 4.1 + 1.3)) / 1.5;
  out.x = 0.8 * CANOPY.swayShared * g;
  out.z = -0.6 * CANOPY.swayShared * g;
  return out;
}

// Write the instance matrix of one clump at `time` (seconds). Sway moves the clump horizontally, so its
// shade slides across the ground at the same horizontal speed, and the yaw wobble turns the leaf pattern.
export function composeClump(c, time, gust, out = _m) {
  const w = (TAU * time) / c.swayPeriod + c.swayPhase;
  const along = Math.sin(w) * c.swayAmp;
  const across = Math.sin(w + 1.3) * c.swayAmp * 0.6;
  const x = c.base[0] + gust.x + c.swayDir[0] * along - c.swayDir[1] * across;
  const z = c.base[2] + gust.z + c.swayDir[1] * along + c.swayDir[0] * across;
  _pos.set(x, c.base[1], z);
  const yaw = c.yaw + CANOPY.yawWobble * Math.sin((TAU * time) / c.wobblePeriod + c.wobblePhase);
  _e.set(c.tilt[0], yaw, c.tilt[1], "YXZ");
  _q.setFromEuler(_e);
  _scl.set(c.size, c.size * 0.6, c.size);
  return out.compose(_pos, _q, _scl);
}
