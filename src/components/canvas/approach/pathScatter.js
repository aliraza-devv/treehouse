// Litter and small ground debris along the path: fallen leaves, twigs, pebbles, beech mast and acorn
// cups. Placement only (seeded, so identical on every load): it returns instance matrices and colours
// for InstancedMesh, never three.js meshes.
//
// Density follows how a real path is used. The worn centre is swept by boots and nearly bare, the dirt
// edge and the verge hold the heaviest litter, leaves drift into pockets (drifts), and collect in the
// lee of roots and stones. Nothing is placed inside a trunk, a signpost, the stump, a mushroom
// cluster, the log, a stone or a root.

import * as THREE from "three";
import { PATH_LENGTH, atPath } from "@/lib/sections/world";
import { createRng, range } from "@/lib/random";
import { clamp, smoothstep } from "@/lib/noise";
import { PALETTE } from "@/lib/sceneConfig";
import { rideHeight, dirtEdge, locate, puddleAt } from "./pathMath";
import { rootDistance } from "./pathLayout";
import { LEAF_COLOURS, TONES, colorFromBytes, leafTint, mixBytes, hexBytes, scaleBytes } from "./pathTones";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// TUNING (each leaf is 2 triangles, a twig 12, a pebble 12, a mast husk or acorn cup 15)
// ------------------------------------------------------------------------------------------------
export const SCATTER = {
  leaves: 236,
  twigs: 14,
  pebbles: 14,
  mast: 9,
  acorns: 6,
  leafLength: [0.07, 0.15], // metres, base to tip (a beech or oak leaf; the quad is a little larger)
  corridor: 2.7, // litter is placed within this many metres of the centreline
  drifts: 9, // pockets where leaves pile up
};

const _d = new THREE.Object3D();

function pickWeighted(rng, list) {
  let r = rng() * list.reduce((s, x) => s + x.w, 0);
  for (const it of list) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}

function makeOut(count, withCell = false) {
  return {
    count: 0,
    max: count,
    matrix: new Float32Array(count * 16),
    color: new Float32Array(count * 3),
    cell: withCell ? new Float32Array(count * 2) : null,
  };
}
function pushInstance(out, d, color, cell = null) {
  const i = out.count++;
  d.updateMatrix();
  out.matrix.set(d.matrix.elements, i * 16);
  out.color[i * 3] = color.r;
  out.color[i * 3 + 1] = color.g;
  out.color[i * 3 + 2] = color.b;
  if (cell && out.cell) {
    out.cell[i * 2] = cell[0];
    out.cell[i * 2 + 1] = cell[1];
  }
}

// layout: { stones, rootSegs, obstacles } from buildPathLayout()
export function buildScatter(layout) {
  const rng = createRng(6006);
  const { stones, rootSegs, obstacles } = layout;

  // Is (x, z) free to hold a small object of radius r?
  const free = (x, z, r = 0, allowRootEdge = false) => {
    for (const o of obstacles) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    for (const st of stones) if (Math.hypot(st.x - x, st.z - z) < st.rMax + r) return false;
    if (rootDistance(rootSegs, x, z) < (allowRootEdge ? -0.02 : 0.0) + r * 0.5) return false;
    return true;
  };

  // Leaf drift pockets: on the verges, a little outside the dirt edge
  const drifts = [];
  for (let i = 0; i < SCATTER.drifts; i++) {
    const s = range(rng, 0.04, 0.97);
    const side = rng() < 0.5 ? -1 : 1;
    drifts.push({ s, lateral: side * range(rng, 0.9, 1.9), sigma: range(rng, 0.32, 0.7), gain: range(rng, 1.4, 2.6) });
  }

  // 0..1 base density of litter by distance from the dirt edge e (metres, positive on the dirt)
  const baseDensity = (e) => {
    if (e > 0) return 0.07 + 0.85 * (1 - smoothstep(0, 0.7, e)); // boot-swept centre, heavier toward the edge
    return Math.max(0.16, 1 - smoothstep(0.6, 2.2, -e)); // the verge: heavy near the dirt, fading out
  };

  // density multiplier from drifts, roots and stones
  const boostAt = (s, lat, x, z) => {
    let b = 1;
    for (const d of drifts) {
      const ds = (s - d.s) * PATH_LENGTH; // along, metres
      const dl = lat - d.lateral;
      b += d.gain * Math.exp(-(ds * ds + dl * dl) / (2 * d.sigma * d.sigma));
    }
    const rd = rootDistance(rootSegs, x, z);
    if (rd > 0) b += 1.5 * Math.exp(-rd / 0.22);
    for (const st of stones) {
      const sd = Math.hypot(st.x - x, st.z - z) - st.rMax;
      if (sd > 0 && sd < 0.6) b += 1.1 * Math.exp(-sd / 0.2);
    }
    return b;
  };

  // generic rejection sampler: calls make(s, lat, p) for accepted candidates
  const sample = (count, density, radius, make, { latRange = SCATTER.corridor } = {}) => {
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < count * 60) {
      const s = range(rng, 0.015, 0.99);
      const lat = range(rng, -latRange, latRange);
      const p = atPath(s, lat);
      const e = dirtEdge(s, lat);
      const prob = clamp(density(e, s, lat, p) * 0.62);
      if (rng() > prob) continue;
      if (!free(p.x, p.z, radius)) continue;
      make(s, lat, p, e);
      n++;
    }
  };

  // ---- fallen leaves ---------------------------------------------------------------------------
  const leaves = makeOut(SCATTER.leaves, true);
  const tint = new THREE.Color();
  sample(
    SCATTER.leaves,
    (e, s, lat, p) => baseDensity(e) * boostAt(s, lat, p.x, p.z),
    0.04,
    (s, lat, p, e) => {
      const species = pickWeighted(rng, [
        { w: 0.38, v: 0 }, // beech
        { w: 0.24, v: 1 }, // oak
        { w: 0.2, v: 2 }, // hornbeam
        { w: 0.18, v: 3 }, // hazel
      ]).v;
      const along = s * PATH_LENGTH;
      const wet = puddleAt(along, lat);
      // fresh or decayed (more decay in the damp places and near the dirt edge)
      const decayed = rng() < 0.32 + 0.4 * wet + (e < 0.3 ? 0.12 : 0);
      const col = pickWeighted(rng, LEAF_COLOURS);
      const dim = (decayed ? 0.82 : 1) * (1 - 0.35 * wet) * range(rng, 0.84, 1.1);
      leafTint(scaleBytes(col.bytes, dim), tint);
      const len = range(rng, SCATTER.leafLength[0], SCATTER.leafLength[1]) * (species === 1 ? 1.12 : species === 3 ? 0.85 : 1);
      const size = len / 0.84; // the atlas leaf fills 84 percent of its cell
      // flat, with a few degrees of curl; leaves resting on a root or against a stone stand up
      const nearRoot = rootDistance(rootSegs, p.x, p.z) < 0.14;
      const tilt = (nearRoot ? 0.35 : 0.1) * range(rng, -1, 1);
      _d.position.set(p.x, rideHeight(p.x, p.z) + 0.006 + Math.abs(Math.sin(tilt)) * size * 0.4, p.z);
      _d.rotation.set(tilt, rng() * TAU, (nearRoot ? 0.3 : 0.1) * range(rng, -1, 1), "YXZ");
      _d.scale.setScalar(size);
      pushInstance(leaves, _d, tint, [species, decayed ? 1 : 0]);
    },
  );

  // ---- twigs and small sticks ----------------------------------------------------------------
  const twigs = makeOut(SCATTER.twigs);
  const barkA = TONES.barkDark;
  const barkB = mixBytes(TONES.bark, TONES.stoneSand, 0.25);
  sample(
    SCATTER.twigs,
    (e) => baseDensity(e) * 0.8,
    0.12,
    (s, lat, p) => {
      const len = range(rng, 0.14, 0.62);
      const thick = range(rng, 0.0038, 0.011) * (len > 0.4 ? 1.2 : 1);
      const rd = rootDistance(rootSegs, p.x, p.z);
      // a twig that has fallen across a root leans on it
      const lean = rd < len * 0.5 ? range(rng, 0.12, 0.35) : range(rng, -0.04, 0.05);
      _d.position.set(p.x, rideHeight(p.x, p.z) + thick + 0.002, p.z);
      _d.rotation.set(0, rng() * TAU, lean, "YXZ");
      _d.scale.set(len, thick, thick);
      const silver = rng() < 0.25; // old, grey, stripped of bark
      const col = silver ? mixBytes(TONES.stoneSand, TONES.stoneFlint, 0.5) : mixBytes(barkA, barkB, rng());
      pushInstance(twigs, _d, colorFromBytes(scaleBytes(col, range(rng, 0.75, 1.15))));
    },
  );

  // ---- pebbles: washed up on and beside the dirt --------------------------------------------
  const pebbles = makeOut(SCATTER.pebbles);
  const pebbleCols = [TONES.stoneFlint, TONES.stoneSand, mixBytes(TONES.stoneFlint, hexBytes(PALETTE.cream), 0.35), scaleBytes(TONES.stoneFlint, 0.6)];
  sample(
    SCATTER.pebbles,
    (e) => (e > -0.3 ? 0.4 + 0.6 * smoothstep(-0.3, 0.3, e) : 0.12),
    0.05,
    (s, lat, p) => {
      const r = range(rng, 0.011, 0.04) * (rng() < 0.2 ? 1.35 : 1);
      const flat = range(rng, 0.5, 0.82);
      const y = rideHeight(p.x, p.z) + 0.002 + r * flat * 0.2;
      _d.position.set(p.x, y, p.z);
      _d.rotation.set(range(rng, -0.25, 0.25), rng() * TAU, range(rng, -0.25, 0.25), "YXZ");
      _d.scale.set(r * range(rng, 1, 1.35), r * flat, r);
      const base = pebbleCols[Math.floor(rng() * pebbleCols.length)];
      pushInstance(pebbles, _d, colorFromBytes(scaleBytes(base, range(rng, 0.8, 1.15))));
    },
  );

  // ---- beech mast husks and acorn cups, in two small clusters each (squirrels, jays) ------------
  const mast = makeOut(SCATTER.mast);
  const acorns = makeOut(SCATTER.acorns);
  const clusterOf = (out, count, sCentre, latCentre, spread, scale, tone, upright) => {
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < 80) {
      const s = sCentre + range(rng, -spread, spread) / PATH_LENGTH;
      const lat = latCentre + range(rng, -spread, spread);
      const p = atPath(s, lat);
      if (!free(p.x, p.z, 0.03) || dirtEdge(s, lat) > 0.1) continue;
      const k = range(rng, scale[0], scale[1]);
      _d.position.set(p.x, rideHeight(p.x, p.z) + 0.003, p.z);
      _d.rotation.set(upright ? range(rng, -0.4, 0.4) : range(rng, -1.3, 1.3), rng() * TAU, range(rng, -0.4, 0.4), "YXZ");
      _d.scale.set(k, k * range(rng, 0.8, 1.1), k);
      pushInstance(out, _d, colorFromBytes(scaleBytes(mixBytes(tone[0], tone[1], rng()), range(rng, 0.8, 1.1))));
      n++;
    }
  };
  const huskTone = [mixBytes(TONES.bark, TONES.barkDark, 0.4), mixBytes(TONES.bark, hexBytes(PALETTE.litterWarm), 0.5)];
  const cupTone = [mixBytes(TONES.barkDark, TONES.stoneSand, 0.15), mixBytes(TONES.bark, TONES.stoneSand, 0.3)];
  clusterOf(mast, 5, 0.3, 1.75, 0.45, [0.011, 0.017], huskTone, false);
  clusterOf(mast, SCATTER.mast - 5, 0.71, -1.5, 0.4, [0.011, 0.017], huskTone, false);
  clusterOf(acorns, 3, 0.52, 1.5, 0.35, [0.01, 0.015], cupTone, false);
  clusterOf(acorns, SCATTER.acorns - 3, 0.88, -1.35, 0.35, [0.01, 0.015], cupTone, false);

  return { leaves, twigs, pebbles, mast, acorns };
}

// Triangle total of the scatter (per piece geometry triangles times instance counts).
export function scatterTriangles(scatter, per) {
  return (
    scatter.leaves.count * per.leaf +
    scatter.twigs.count * per.twig +
    scatter.pebbles.count * per.pebble +
    scatter.mast.count * per.mast +
    scatter.acorns.count * per.acorn
  );
}

// Used by the integrator or a test to see roughly where litter landed: [count in dirt, count outside].
export function leafSplit(scatter) {
  let inDirt = 0;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let i = 0; i < scatter.leaves.count; i++) {
    m.fromArray(scatter.leaves.matrix, i * 16);
    v.setFromMatrixPosition(m);
    const l = locate(v.x, v.z);
    if (dirtEdge(l.s, l.lateral) > 0) inDirt++;
  }
  return [inDirt, scatter.leaves.count - inDirt];
}
