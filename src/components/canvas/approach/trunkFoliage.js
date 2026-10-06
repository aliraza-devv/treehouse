// Placement of the trunk dressing that is not bark: crown leaf clusters, the limbs that carry them, the
// overhang sprays that cross the corridor, and the positions of the far (instanced) trunks.
//
// Pure maths, seeded, no canvas. Everything here is a PLAN (matrices, colours, polylines); trunkBuild.js
// turns plans into geometry and meshes.

import * as THREE from "three";
import { CAMERA, LIGHT, TREE, groundHeight } from "@/lib/sceneConfig";
import { range } from "@/lib/random";
import { clamp, createNoise, smoothstep } from "@/lib/noise";
import { atPath, pathAt, toPath } from "@/lib/sections/world";
import { DEG, TAU, blocksCabin, blocksCabinGround, cameraDistance } from "./trunkMath";
import { FAR_SPECIES, LEAF_LOOK, SPECIES, TRUNK_TUNING } from "./trunkTones";

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// Horizontal unit vector toward the sun (south, a little east): the sun side of a crown is brighter.
const SUN_XZ = new THREE.Vector2(LIGHT.keyPosition[0] - LIGHT.target[0], LIGHT.keyPosition[2] - LIGHT.target[2]).normalize();

const clumpNoise = createNoise(913);

// ------------------------------------------------------------------------------------------------
// Leaf colour: a multiplier on the leaf card albedo. e in 0..1 runs deep interior to sun touched shell.
// ------------------------------------------------------------------------------------------------
function leafColour(rng, e) {
  const d = LEAF_LOOK.dark;
  const l = LEAF_LOOK.lit;
  const v = range(rng, 0.9, 1.1);
  const c = [
    (d[0] + (l[0] - d[0]) * e) * v * range(rng, 0.94, 1.08),
    (d[1] + (l[1] - d[1]) * e) * v,
    (d[2] + (l[2] - d[2]) * e) * v * range(rng, 0.92, 1.08),
  ];
  const dead = rng();
  if (dead < 0.04) return [c[0] * 1.45, c[1] * 1.15, c[2] * 0.5]; // yellow olive
  if (dead < 0.058) return [c[0] * 1.1, c[1] * 0.62, c[2] * 0.35]; // rusty brown
  return c;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new V3();

function clusterMatrix(rng, p, size) {
  // random spin round Y plus a slight tilt: the crossed cards then never line up between clusters
  _e.set(range(rng, -0.35, 0.35), rng() * TAU, range(rng, -0.35, 0.35), "YXZ");
  _q.setFromEuler(_e);
  _q2.identity();
  _s.set(size, size * range(rng, 0.88, 1.08), size);
  return _m.compose(p, _q.multiply(_q2), _s).toArray();
}

// ------------------------------------------------------------------------------------------------
// CROWNS
// ------------------------------------------------------------------------------------------------
// A trunk's crown: `limbCount` limbs fork from the trunk at 8.8 to 11.2 m and climb out 3 to 5 m, and the
// leaf clusters gather round the limb tips and the trunk top in clumps with air between them.
//   model   needs centre(h), radius(h, theta), hTop, y0, x, z (a createTrunkModel result or the light
//           stand-in used for far trunks)
// Returns { limbs: [{ pts, radii }], clusters: [{ m, c }] }.
export function planCrown(model, rng, { count, limbCount = 2, size = TRUNK_TUNING.crownSize, minHeight = TRUNK_TUNING.crownMinHeight, spread = 1 }) {
  const limbs = [];
  const anchors = [];
  const top = model.centre(model.hTop - 0.8, new V3());
  anchors.push({ p: top, spread: 1.9 * spread, w: 1.6 });
  // a second anchor lower on the upper trunk, so the cut top never shows as a bare pole with a tuft on it
  anchors.push({ p: model.centre(model.hTop - 3.4, new V3()), spread: 1.5 * spread, w: 0.9 });
  for (let l = 0; l < limbCount; l++) {
    const hs = range(rng, 8.8, 11.2);
    const start = model.centre(hs, new V3());
    const az = rng() * TAU;
    const tilt = range(rng, 32, 55) * DEG;
    const len = range(rng, 3.2, 5.4);
    const dir = new V3(Math.cos(az) * Math.cos(tilt), Math.sin(tilt), Math.sin(az) * Math.cos(tilt));
    const mid = start.clone().addScaledVector(dir, len * 0.5).add(new V3(0, 0.15, 0));
    const end = start.clone().addScaledVector(dir, len).add(new V3(range(rng, -0.3, 0.3), 0.1, range(rng, -0.3, 0.3)));
    const r0 = model.radius ? model.radius(hs, az) * 0.4 : 0.15;
    limbs.push({ pts: [start, mid, end], radii: [r0, r0 * 0.55, 0.03] });
    for (const u of [0.55, 0.8, 1.0]) {
      anchors.push({ p: start.clone().addScaledVector(dir, len * u).add(new V3(0, 0.1 * u, 0)), spread: 1.6 * spread, w: 1 });
    }
  }
  const totalW = anchors.reduce((a, b) => a + b.w, 0);
  const pick = () => {
    let r = rng() * totalW;
    for (const a of anchors) {
      r -= a.w;
      if (r <= 0) return a;
    }
    return anchors[anchors.length - 1];
  };
  const clusters = [];
  const p = new V3();
  // two caps wrap the very top of the trunk, which otherwise ends in a bare pencil point: they ignore the
  // clump gate below (only the cabin sight lines can veto them)
  for (let i = 0; i < Math.min(2, count); i++) {
    p.set(range(rng, -0.45, 0.45), range(rng, 0.1, 0.9), range(rng, -0.45, 0.45)).add(top);
    const sz = range(rng, size[0], size[1]);
    if (blocksCabin(p.x, p.y, p.z, sz * 0.5)) continue;
    clusters.push({ m: clusterMatrix(rng, p, sz), c: leafColour(rng, clamp(0.5 + 0.3 * rng(), 0, 1)) });
  }
  let tries = 0;
  while (clusters.length < count && tries++ < count * 14) {
    const a = pick();
    // a point in a vertically squashed ball round the anchor
    p.set(range(rng, -1, 1), range(rng, -0.7, 0.7), range(rng, -1, 1)).multiplyScalar(a.spread).add(a.p);
    if (p.y < model.y0 + minHeight) continue;
    const sz = range(rng, size[0], size[1]);
    // clumps: low frequency noise leaves holes, so the crown reads as masses of leaves with air between
    const clump = smoothstep(-0.2, 0.4, clumpNoise.simplex3(p.x * 0.5, p.y * 0.55, p.z * 0.5));
    if (rng() > 0.5 + 0.5 * clump) continue;
    if (blocksCabin(p.x, p.y, p.z, sz * 0.5)) continue;
    const out = Math.hypot(p.x - model.x, p.z - model.z) || 1;
    const sun = ((p.x - model.x) / out) * SUN_XZ.x + ((p.z - model.z) / out) * SUN_XZ.y;
    const e = clamp(0.32 + 0.24 * sun + 0.3 * rng() + 0.12 * smoothstep(10, 16, p.y - model.y0), 0, 1);
    clusters.push({ m: clusterMatrix(rng, p, sz), c: leafColour(rng, e) });
  }
  return { limbs, clusters };
}

// ------------------------------------------------------------------------------------------------
// OVERHANG SPRAYS
// ------------------------------------------------------------------------------------------------
// A low limb that crosses the corridor at a set path fraction, high enough that the walker passes under
// or beside it, carrying a few leaf clusters. The camera tube (the weave) is the thing to stay clear of:
// every branch point and every cluster is tested against it (cameraDistance), 0.7 m by default. Clusters
// near the middle of the corridor must also sit well above the eye, so nothing hangs in the centre of the
// frame ahead of the camera.
// side is the side of the path the limb grows from (+1 right). The fractions keep clear of the signposts
// (0.2, 0.41, 0.61, 0.79: a sign never reads through a spray) and of the glimpse moments (0.3, 0.44, 0.58,
// 0.72, 0.86): a spray is passed under at its fraction, and is only in frame for about 0.15 of path before
// that, so these keep every spray out of the frame at the moment the walker looks up at the cabin.
export const SPRAYS = [
  { s: 0.06, side: 1 },
  { s: 0.155, side: -1 },
  { s: 0.255, side: 1 },
  { s: 0.37, side: -1 },
  { s: 0.51, side: 1 },
  { s: 0.655, side: -1 },
];
// How much of the cabin sight clearance a spray respects (crowns use all of it, see blocksCabin).
const SPRAY_SIGHT_SCALE = 0.45;

export function planSprays(trunks, modelFor, rng) {
  const sprays = [];
  const clearance = TRUNK_TUNING.sprayClearance;
  const used = new Set();
  for (const spec of SPRAYS) {
    // origin trunk: on the right side, near the fraction, 1 to 7.5 m from the dirt. A limb reaching across
    // from a trunk about 3 m off the dirt reads best; a close trunk is allowed but not favoured, and no
    // trunk grows two sprays.
    const score = (t) =>
      0.6 * Math.abs(t.pathDist - 3.2) + 5 * Math.abs(t.s - spec.s) + (used.has(t.id) ? 40 : 0) + (t.cls === "close" ? 1.4 : 0);
    const cands = trunks
      .filter((t) => Math.sign(t.lateral) === spec.side && Math.abs(t.s - spec.s) <= 0.22 && t.pathDist > 0.9 && t.pathDist < 7.5)
      .sort((a, b) => score(a) - score(b));
    if (cands.length === 0) continue;
    const origin = cands[0];
    used.add(origin.id);
    const model = modelFor(origin);
    const h0 = range(rng, 3.1, 4.3);
    const surf = model.surface(h0, origin.pathTheta);
    const P0 = surf.p.clone().addScaledVector(surf.n, -0.08);

    // target: where the limb crosses the corridor, 2.6 to 3.0 m above the ground (0.8 to 1.4 above the eye)
    const sT = clamp(spec.s + range(rng, -0.012, 0.012), 0.02, 0.95);
    const T = atPath(sT, -spec.side * range(rng, 0.15, 0.8));
    const PT = new V3(T.x, T.y + range(rng, 2.6, 3.0), T.z);
    const horiz = new V3(PT.x - P0.x, 0, PT.z - P0.z);
    const perp = new V3(-horiz.z, 0, horiz.x).normalize();
    const P1 = P0.clone().lerp(PT, 0.3).add(new V3(0, 0.3, 0)).addScaledVector(perp, range(rng, -0.3, 0.3));
    const P2 = P0.clone().lerp(PT, 0.66).add(new V3(0, 0.12, 0)).addScaledVector(perp, range(rng, -0.35, 0.35));
    const P4 = PT.clone().addScaledVector(PT.clone().sub(P2), 0.45).add(new V3(0, -0.25, 0));
    const curve = new THREE.CatmullRomCurve3([P0, P1, P2, PT, P4], false, "centripetal");
    const SEG = 7;
    const pts = [];
    for (let k = 0; k <= SEG; k++) pts.push(curve.getPointAt(k / SEG));
    const r0 = range(rng, 0.085, 0.12);
    const radii = pts.map((_, k) => r0 * (1 - 0.82 * Math.pow(k / SEG, 0.85)) + 0.012);
    // lift the branch where it comes inside the clearance of the walker's tube. The lift is spread over the
    // neighbouring points with a gaussian (width about 1.6 points), so the limb rises in one smooth bulge
    // instead of bending at a hard elbow. The root point stays on the trunk.
    for (let it = 0; it < 3; it++) {
      const need = pts.map((q, k) => (k === 0 ? 0 : Math.max(0, clearance - (cameraDistance(q.x, q.y, q.z) - radii[k]) + (it === 0 ? 0.05 : 0.02))));
      if (need.every((v) => v === 0)) break;
      for (let k = 1; k <= SEG; k++) {
        let lift = 0;
        for (let j = 1; j <= SEG; j++) lift = Math.max(lift, need[j] * Math.exp(-(((k - j) / 1.6) ** 2)));
        pts[k].y += lift;
      }
    }

    // leaf clusters along the outer part of the limb. A cluster is a crossed set of cards about `sz` wide
    // (half of it reaches out from the centre), so its centre keeps clearance + 0.5 sz from the camera
    // tube. Near the middle of the corridor the lowest leaf edge must be at least 0.9 m above the eye;
    // toward the sides leaves may hang lower (they are the blurred leaves at the edge of the frame).
    const clusters = [];
    const twigs = [];
    const c = new V3();
    let tries = 0;
    const want = TRUNK_TUNING.sprayClusters;
    while (clusters.length < want && tries++ < 320) {
      const u = range(rng, 0.3, 1.0) * SEG;
      const k = Math.min(SEG - 1, Math.floor(u));
      const base = pts[k].clone().lerp(pts[k + 1], u - k);
      c.copy(base).add(new V3(range(rng, -0.7, 0.7), range(rng, -0.25, 0.75), range(rng, -0.7, 0.7)));
      const sz = range(rng, TRUNK_TUNING.spraySize[0], TRUNK_TUNING.spraySize[1]);
      if (cameraDistance(c.x, c.y, c.z) < clearance + 0.5 * sz) continue;
      const loc = toPath(c.x, c.z, 48);
      const eye = pathAt(loc.s).y + 1.7;
      const lowEdge = c.y - 0.5 * sz;
      if (Math.abs(loc.lateral) < 0.9 ? lowEdge - eye < 0.9 : lowEdge - eye < 0.15) continue;
      if (blocksCabin(c.x, c.y, c.z, sz * 0.3, SPRAY_SIGHT_SCALE)) continue;
      // keep clusters from piling on one another: at least 0.45 sz apart
      if (clusters.some((o) => o.pos.distanceTo(c) < 0.45 * Math.max(sz, o.sz))) continue;
      const e = clamp(0.5 + 0.2 * rng() + 0.2 * (c.y - 2) / 2, 0, 1);
      clusters.push({ m: clusterMatrix(rng, c, sz), c: leafColour(rng, e), pos: c.clone(), sz });
      const dir = c.clone().sub(base);
      const len = dir.length();
      if (len > 0.12) twigs.push({ origin: base.clone(), dir: dir.normalize(), len: len * 0.85, r0: range(rng, 0.01, 0.016) });
    }
    sprays.push({ spec, origin, model, pts, radii, clusters, twigs, leaf: SPECIES[origin.species].leaf });
  }
  return sprays;
}

// ------------------------------------------------------------------------------------------------
// FAR TRUNKS (13 to 25 m ahead of the walker, beside the line of sight)
// ------------------------------------------------------------------------------------------------
// The hero's own background trees (ForestEnvironment BG_TREES: [ndc x, depth from the hero camera, radius]).
// Far trunks keep clear of them.
const HALF_W = Math.tan((CAMERA.fov / 2) * DEG) * (16 / 9);
const BG = [
  [-0.92, 15, 0.95],
  [-0.22, 24, 1.0],
  [-0.6, 38, 1.05],
  [0.75, 30, 0.95],
  [0.95, 16, 0.9],
  [0.32, 45, 1.1],
  [-0.97, 42, 1.0],
].map(([ndc, depth, r]) => ({ x: ndc * HALF_W * depth, z: CAMERA.position[2] - depth, r }));

export function planFarTrunks(trunks, count, rng) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < 900) {
    const s = range(rng, 0.0, 0.8);
    const p = pathAt(s);
    const side = rng() < 0.5 ? -1 : 1;
    const fwd = range(rng, 13, 24);
    const lat = side * range(rng, 3.5, 6 + 0.3 * fwd);
    const x = p.x + p.tx * fwd + p.rx * lat;
    const z = p.z + p.tz * fwd + p.rz * lat;
    const r = range(rng, 0.22, 0.6);
    if (Math.hypot(x - TREE.x, z - TREE.z) < 4.5) continue;
    if (toPath(x, z, 48).dist < 6) continue;
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 2.4 + t.r + r)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 3.4)) continue;
    if (BG.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 2.6 + 1.2 + r)) continue;
    if (blocksCabinGround(x, z, r)) continue;
    const species = FAR_SPECIES[Math.floor(rng() * FAR_SPECIES.length)];
    out.push({
      x,
      y: groundHeight(x, z),
      z,
      r,
      species,
      hScale: range(rng, 0.9, 1.15),
      tiltX: range(rng, -0.03, 0.03),
      tiltZ: range(rng, -0.03, 0.03),
      tone: range(rng, 0.8, 1.1),
    });
  }
  return out;
}

// A light stand-in with the bits planCrown needs, for a far trunk.
export function farModel(t) {
  return {
    x: t.x,
    z: t.z,
    y0: t.y,
    hTop: 15 * t.hScale,
    radius: null,
    centre: (h, out = new V3()) => out.set(t.x + t.tiltX * h, t.y + h, t.z + t.tiltZ * h),
  };
}

export { UP };
