// WHERE everything grows. Pure data (no three.js objects except colours): seeded, so the woodland is
// identical on every load, and nothing is placed by hand. Every record is a plain object that
// floraAssemble.js turns into an instance matrix.
//
// How placement works
//   * Candidate points are drawn from a rectangle around the path and accepted with a probability from a
//     species density field: slow simplex noise (colonies 4 to 6 m across with real bare gaps), damp
//     hollows (low ground), the feet of trunks, light gaps (far from any trunk) and the lee of the log.
//   * The worn path (PATH_CLEAR_HALF_WIDTH around the centreline) stays clear. A fern crown must sit
//     outside it and its fronds may overhang the dirt by FERNS.overhang: a clump near the verge is
//     simply scaled down until its reach fits, which is also how real verge ferns look.
//   * Obstacles (trunks, stump, signposts, the boot, the log and its root plate, mushroom clusters) keep
//     their own exclusion circles, so flora never grows through the other agents' props.

import * as THREE from "three";
import {
  pathAt,
  atPath,
  PATH_CLEAR_HALF_WIDTH,
  SIGNS,
  CLOSE_TRUNKS,
  MID_TRUNKS,
  STUMP,
  MUSHROOM_CLUSTERS,
  FALLEN_LOG,
  STORY_PROPS,
} from "@/lib/sections/world";
import { TREE, groundHeight } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { createNoise, clamp, smoothstep } from "@/lib/noise";
import { FLORA_SEED, REGION, HERO_TRUNK_KEEP_OUT, FERNS, COVER, MUSHROOMS } from "./floraTuning";
import { TONE, mixRgb, linearFromBytes } from "./floraColor";
import { rottenStub } from "./floraLog";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------
// Distance to the path centreline, accelerated. world.js toPath() samples the curve 96 times per query,
// far too slow for thousands of candidates, so the centreline is sampled ONCE and queries run against
// the polyline (exact to a millimetre on this curve).
// ------------------------------------------------------------------------------------------------
export function createPathField(N = 140) {
  const X = new Float32Array(N + 1);
  const Z = new Float32Array(N + 1);
  const RX = new Float32Array(N + 1);
  const RZ = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const p = pathAt(i / N);
    X[i] = p.x;
    Z[i] = p.z;
    RX[i] = p.rx;
    RZ[i] = p.rz;
  }
  const query = (x, z, o = { dist: 0, s: 0, lateral: 0, cx: 0, cz: 0 }) => {
    let best = Infinity;
    let k = 0;
    for (let i = 0; i <= N; i++) {
      const dx = x - X[i];
      const dz = z - Z[i];
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        k = i;
      }
    }
    let bd = Infinity;
    let bt = 0;
    let bi = Math.min(k, N - 1);
    let bcx = X[k];
    let bcz = Z[k];
    for (const i of [k - 1, k]) {
      if (i < 0 || i >= N) continue;
      const ax = X[i];
      const az = Z[i];
      const ex = X[i + 1] - ax;
      const ez = Z[i + 1] - az;
      const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
      const cx = ax + ex * t;
      const cz = az + ez * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < bd) {
        bd = d;
        bt = t;
        bi = i;
        bcx = cx;
        bcz = cz;
      }
    }
    o.dist = bd;
    o.s = (bi + bt) / N;
    o.cx = bcx;
    o.cz = bcz;
    o.lateral = (x - bcx) * RX[bi] + (z - bcz) * RZ[bi];
    return o;
  };
  return { query };
}

// ------------------------------------------------------------------------------------------------
// Obstacles and trunks
// ------------------------------------------------------------------------------------------------
export function createObstacles(frame) {
  const circles = [];
  const trunks = [];
  const add = (x, z, r) => circles.push([x, z, r]);
  add(TREE.x, TREE.z, HERO_TRUNK_KEEP_OUT);
  for (const c of CLOSE_TRUNKS) {
    const p = atPath(c.s, c.lateral);
    add(p.x, p.z, c.r * 1.9 + 0.2); // trunk plus its flaring roots
    trunks.push({ x: p.x, z: p.z, r: c.r });
  }
  for (const m of MID_TRUNKS) {
    add(m.x, m.z, m.r * 1.7 + 0.15);
    trunks.push({ x: m.x, z: m.z, r: m.r });
  }
  const sp = atPath(STUMP.s, STUMP.lateral);
  add(sp.x, sp.z, STUMP.r + 0.3);
  for (const sg of SIGNS) {
    const p = atPath(sg.s, sg.lateral);
    add(p.x, p.z, 0.7);
  }
  // the child's boot lies at the foot of close trunk c2, mouth toward the path
  const c2 = CLOSE_TRUNKS.find((c) => c.id === STORY_PROPS.boot.trunkId);
  if (c2) {
    const tp = atPath(c2.s, c2.lateral);
    const pp = atPath(c2.s, 0);
    const dx = pp.x - tp.x;
    const dz = pp.z - tp.z;
    const l = Math.hypot(dx, dz) || 1;
    add(tp.x + (dx / l) * (c2.r + 0.2), tp.z + (dz / l) * (c2.r + 0.2), 0.55);
  }
  for (const m of MUSHROOM_CLUSTERS) {
    const p = atPath(m.s, m.lateral);
    add(p.x, p.z, 0.62);
  }
  const st = rottenStub();
  add(st.x, st.z, 0.5);
  // the upturned root plate of the log, and the log itself as a capsule along its axis
  add(frame.butt[0] + frame.d[0] * 0.5, frame.butt[2] + frame.d[2] * 0.5, 1.35);
  const A = [frame.butt[0], frame.butt[2]];
  const B = [frame.butt[0] - frame.d[0] * frame.L, frame.butt[2] - frame.d[2] * frame.L];
  const logR = FALLEN_LOG.r * 1.45 + 0.1;
  const logDist = (x, z) => {
    const ex = B[0] - A[0];
    const ez = B[1] - A[1];
    const t = clamp(((x - A[0]) * ex + (z - A[1]) * ez) / (ex * ex + ez * ez), 0, 1);
    return Math.hypot(x - (A[0] + ex * t), z - (A[1] + ez * t));
  };
  const blocked = (x, z, pad = 0) => {
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (Math.hypot(x - c[0], z - c[1]) < c[2] + pad) return true;
    }
    return logDist(x, z) < logR + pad;
  };
  return { blocked, trunks, logDist, logR };
}

// ------------------------------------------------------------------------------------------------
// Density fields (all 0..1). Slow noise gives colonies and bare gaps; the rest shape where.
// ------------------------------------------------------------------------------------------------
export function createFields(obstacles) {
  const noises = [101, 102, 103, 104, 105, 106, 107].map((k) => createNoise(FLORA_SEED + k));
  const colony = (i, x, z, f = 0.21) => 0.5 + 0.5 * noises[i].simplexFbm2(x * f + 3.7 * i, z * f - 1.9 * i, 3);
  const trunkEdge = (x, z) => {
    let d = Infinity;
    for (const t of obstacles.trunks) d = Math.min(d, Math.hypot(x - t.x, z - t.z) - t.r);
    return d;
  };
  return {
    colony,
    // damp hollows: low ground collects water and the damp loving species
    hollow: (x, z) => smoothstep(0.15, -0.55, groundHeight(x, z)),
    // the feet of trunks (humus, shelter, moss)
    foot: (x, z) => smoothstep(2.8, 0.6, trunkEdge(x, z)),
    // light gaps: well away from any trunk
    gap: (x, z) => smoothstep(1.8, 4.4, trunkEdge(x, z)),
    // the lee of the log
    log: (x, z) => smoothstep(2.6, 0.5, obstacles.logDist(x, z) - FALLEN_LOG.r),
    // bare patches where nothing grows at all
    bare: (x, z) => smoothstep(0.64, 0.8, colony(3, x, z, 0.4)),
  };
}

// ------------------------------------------------------------------------------------------------
// Ferns
// ------------------------------------------------------------------------------------------------
const SPECIES = ["bracken", "male", "harts"]; // largest first: the big ones claim their space

function fernTint(rng) {
  const age = rng();
  const v = range(rng, 0.78, 1.12);
  if (age < FERNS.browning) return [1.75 * v, 0.95 * v, 0.55 * v]; // browning
  if (age < FERNS.browning + FERNS.yellowing) return [1.35 * v, 1.1 * v, 0.62 * v]; // yellowing
  return [v * range(rng, 0.92, 1.08), v, v * range(rng, 0.85, 1.08)]; // healthy greens
}

function speciesWeight(species, F, x, z) {
  if (species === "male") {
    const c = smoothstep(0.38, 0.66, F.colony(0, x, z));
    return (0.1 + 0.9 * c) * (0.45 + 0.35 * F.hollow(x, z) + 0.45 * F.foot(x, z));
  }
  if (species === "harts") {
    const c = smoothstep(0.42, 0.7, F.colony(1, x, z));
    return (0.08 + 0.92 * c) * (0.15 + 0.85 * clamp(0.9 * F.hollow(x, z) + 0.7 * F.log(x, z) + 0.5 * F.foot(x, z)));
  }
  const c = smoothstep(0.4, 0.68, F.colony(2, x, z));
  return (0.1 + 0.9 * c) * (0.25 + 0.8 * F.gap(x, z)) * (1 - 0.65 * F.hollow(x, z));
}

// reach: { bracken, male, harts } = measured horizontal reach (m) of one clump at scale 1.
export function* placeFerns(ctx, reach, logFerns) {
  const { path, obstacles, fields: F } = ctx;
  const rng = createRng(FLORA_SEED + 11);
  const placed = [];
  const pq = { dist: 0, s: 0, lateral: 0, cx: 0, cz: 0 };
  const sNoise = createNoise(FLORA_SEED + 120);
  const minCrown = PATH_CLEAR_HALF_WIDTH + 0.08;
  const clearEdge = PATH_CLEAR_HALF_WIDTH - FERNS.overhang; // fronds may reach this close to the centreline

  const fits = (x, z, R) => {
    for (let i = 0; i < placed.length; i++) {
      const o = placed[i];
      if (o.onLog) continue;
      const lim = FERNS.spacing * (R + o.R);
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < lim * lim) return false;
    }
    return true;
  };

  const accept = (species, x, z, scaleIn, edge) => {
    path.query(x, z, pq);
    if (pq.dist < minCrown) return null;
    if (obstacles.blocked(x, z, 0.1)) return null;
    const spec = FERNS[species];
    const rc = reach[species];
    // the verge rule: the fronds may overhang the dirt by `overhang`, so a clump near the path is scaled
    // down until its reach fits
    const maxScale = (pq.dist - clearEdge) / rc;
    const scale = Math.min(scaleIn, maxScale);
    if (scale < spec.scale[0] * (edge ? 0.85 : 0.9)) return null;
    if (!fits(x, z, rc * scale)) return null;
    return { scale, pd: pq.dist, cx: pq.cx, cz: pq.cz };
  };

  const record = (species, x, z, a, leanAz, leanAng) => ({
    species,
    x,
    y: groundHeight(x, z) - 0.04 * a.scale, // the crown sits a little in the humus
    z,
    scale: a.scale,
    sy: a.scale * range(rng, 0.88, 1.16),
    yaw: rng() * TAU,
    leanAz,
    leanAng,
    tint: fernTint(rng),
    R: reach[species] * a.scale,
    onLog: false,
  });

  // ---- 1. colonies by density
  let tries = 0;
  for (const species of SPECIES) {
    const spec = FERNS[species];
    let n = 0;
    let guard = 0;
    // log ferns count toward the minimum instance counts but are added after, so aim for spec.count here
    while (n < spec.count && guard++ < 16000) {
      const x = range(rng, REGION.xMin, REGION.xMax);
      const z = range(rng, REGION.zMin, REGION.zMax);
      path.query(x, z, pq);
      const pd = pq.dist;
      if (pd < minCrown) continue;
      const falloff = (0.45 + 0.55 * smoothstep(1.0, 2.4, pd)) * smoothstep(FERNS.farFade[1], FERNS.farFade[0], pd) * (z < 0 ? 0.5 : 1);
      const w = speciesWeight(species, F, x, z) * falloff * (1 - 0.92 * F.bare(x, z));
      if (rng() > Math.pow(clamp(w), spec.gamma)) {
        if ((++tries & 255) === 0) yield;
        continue;
      }
      const u = 0.55 * rng() + 0.45 * (0.5 + 0.5 * sNoise.simplexFbm2(x * 0.3, z * 0.3, 2));
      const scaleIn = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * u * u * 1.15;
      const a = accept(species, x, z, scaleIn, false);
      if ((++tries & 255) === 0) yield;
      if (!a) continue;
      placed.push(record(species, x, z, a, rng() * TAU, range(rng, FERNS.leanDeg[0], FERNS.leanDeg[1] * 0.8) * DEG));
      n++;
    }
  }
  yield;

  // ---- 2. verge ferns that lean toward the path and overhang the dirt
  for (const species of SPECIES) {
    let n = 0;
    let guard = 0;
    while (n < FERNS.edge[species] && guard++ < 600) {
      const s = range(rng, 0.03, 0.97);
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * range(rng, 1.06, 1.34);
      const p = atPath(s, lat);
      const spec = FERNS[species];
      const a = accept(species, p.x, p.z, range(rng, spec.scale[0] * 1.1, spec.scale[1] * 0.85), true);
      if (!a) continue;
      // lean toward the nearest bit of path, a little off dead on
      const az = Math.atan2(a.cz - p.z, a.cx - p.x) + range(rng, -0.45, 0.45);
      placed.push(record(species, p.x, p.z, a, az, range(rng, 11, FERNS.leanDeg[1]) * DEG));
      n++;
    }
  }
  yield;

  // ---- 3. small ferns rooted in the moss on top of the log (positions come from floraLog)
  for (const f of logFerns) {
    placed.push({
      species: f.species,
      x: f.x,
      y: f.y - 0.02,
      z: f.z,
      scale: f.size,
      sy: f.size * range(rng, 0.9, 1.15),
      yaw: rng() * TAU,
      leanAz: rng() * TAU,
      leanAng: range(rng, 6, 16) * DEG,
      tint: fernTint(rng),
      R: reach[f.species] * f.size,
      onLog: true,
    });
  }
  return placed;
}

// ------------------------------------------------------------------------------------------------
// Ground cover beyond the path
// ------------------------------------------------------------------------------------------------
// Ground normal by central differences of groundHeight.
function groundNormal(x, z, out = [0, 1, 0]) {
  const e = 0.25;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  const l = Math.hypot(dx, 2 * e, dz);
  out[0] = -dx / l;
  out[1] = (2 * e) / l;
  out[2] = -dz / l;
  return out;
}

function greenTint(rng, lo, hi) {
  const v = range(rng, lo, hi);
  return [v * range(rng, 0.92, 1.06), v, v * range(rng, 0.86, 1.04)];
}

export function* placeCover(ctx, logFrame, logDetails) {
  const { path, obstacles, fields: F } = ctx;
  const rng = createRng(FLORA_SEED + 31);
  const pq = { dist: 0, s: 0, lateral: 0, cx: 0, cz: 0 };
  const out = { moss: [], ivy: [], mercury: [], sorrel: [], sedge: [], bramble: [], beech: [] };
  const margin = COVER.pathMargin;
  const nrm = [0, 1, 0];

  // Draw points by weight until `count` are accepted. `extraPad` grows the path margin with card size.
  function* sample(count, weightFn, onAccept, { pad = 0.1, sizeFn = () => 0, guardMax = 9000, minPd = margin } = {}) {
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < guardMax) {
      const x = range(rng, REGION.xMin, REGION.xMax);
      const z = range(rng, REGION.zMin + 1, REGION.zMax - 1);
      path.query(x, z, pq);
      const size = sizeFn();
      if (pq.dist < minPd + size * 0.42) continue;
      if (obstacles.blocked(x, z, pad)) continue;
      const w = weightFn(x, z, pq.dist);
      if (rng() > w) {
        if ((guard & 255) === 0) yield;
        continue;
      }
      onAccept(x, z, size);
      n++;
      if ((n & 15) === 0) yield;
    }
  }

  const farFade = (pd) => smoothstep(14, 7, pd);

  // ---- moss patches: flat cards, damp and shaded, thickest at trunk feet and by the log
  yield* sample(
    COVER.moss.count,
    (x, z, pd) => {
      const c = smoothstep(0.4, 0.7, F.colony(4, x, z, 0.3));
      return clamp((0.12 + 0.88 * c) * (0.2 + 0.8 * clamp(0.8 * F.foot(x, z) + 0.7 * F.hollow(x, z) + 0.7 * F.log(x, z))) * farFade(pd) * 1.6);
    },
    (x, z, size) => {
      groundNormal(x, z, nrm);
      out.moss.push({ x, y: groundHeight(x, z) + COVER.lift, z, size, yaw: rng() * TAU, n: [nrm[0], nrm[1], nrm[2]], tint: greenTint(rng, 0.78, 1.1) });
    },
    { sizeFn: () => range(rng, COVER.moss.size[0], COVER.moss.size[1]), pad: 0.05 },
  );

  // ---- ivy runners lying on the floor, clustered at trunk feet and around the log
  yield* sample(
    COVER.ivy.count,
    (x, z, pd) => clamp((0.1 + 0.9 * smoothstep(0.35, 0.65, F.colony(5, x, z, 0.26))) * (0.15 + 0.85 * clamp(F.foot(x, z) * 0.9 + F.log(x, z) * 0.7)) * farFade(pd) * 1.8),
    (x, z, size) => {
      groundNormal(x, z, nrm);
      out.ivy.push({ x, y: groundHeight(x, z) + COVER.lift * 0.6, z, size, yaw: rng() * TAU, n: [nrm[0], nrm[1], nrm[2]], tint: greenTint(rng, 0.7, 1.0), onLog: false });
    },
    { sizeFn: () => range(rng, COVER.ivy.size[0], COVER.ivy.size[1]), pad: 0.05, minPd: margin + 0.05 },
  );

  // ---- patch carpets: dog's mercury (shaded, damp) and wood sorrel (rotten wood, trunk feet)
  const patchCentres = [];
  function* patches(kind, spec, weightFn, sigma) {
    const centres = [];
    yield* sample(
      spec.patches,
      weightFn,
      (x, z) => centres.push([x, z]),
      { guardMax: 6000, minPd: 1.9, pad: 0.4 },
    );
    for (const [cx, cz] of centres) {
      const count = Math.round(range(rng, spec.perPatch[0], spec.perPatch[1]));
      const sg = range(rng, sigma[0], sigma[1]);
      let n = 0;
      let guard = 0;
      while (n < count && guard++ < 160) {
        // gaussian-ish scatter (sum of two uniforms): dense core, thin edge
        const r = (rng() + rng() - 1) * sg * 1.9;
        const a = rng() * TAU;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        path.query(x, z, pq);
        if (pq.dist < margin + 0.1) continue;
        if (obstacles.blocked(x, z, 0.05)) continue;
        const size = range(rng, spec.size[0], spec.size[1]);
        out[kind].push({ x, y: groundHeight(x, z) - 0.01, z, size, yaw: rng() * TAU, tilt: range(rng, 0, 0.1), tint: greenTint(rng, 0.78, 1.12) });
        n++;
      }
      patchCentres.push([cx, cz]);
      yield;
    }
  }
  yield* patches(
    "mercury",
    COVER.mercury,
    (x, z, pd) => clamp(smoothstep(0.42, 0.68, F.colony(6, x, z, 0.24)) * (0.3 + 0.7 * clamp(F.hollow(x, z) + 0.4 * F.foot(x, z))) * farFade(pd) * 1.5),
    [0.5, 0.85],
  );
  yield* patches(
    "sorrel",
    COVER.sorrel,
    (x, z, pd) => clamp((0.1 + 0.9 * clamp(F.log(x, z) * 0.9 + F.foot(x, z) * 0.7)) * smoothstep(0.35, 0.62, F.colony(5, x + 7, z - 3, 0.3)) * farFade(pd) * 1.6),
    [0.35, 0.55],
  );

  // ---- sedge and tall grass tufts in the light gaps
  const sedgeCentres = [];
  yield* sample(COVER.sedge.clumps, (x, z, pd) => clamp(F.gap(x, z) * smoothstep(0.4, 0.62, F.colony(2, x, z, 0.27)) * farFade(pd) * 1.5), (x, z) => sedgeCentres.push([x, z]), {
    guardMax: 6000,
    minPd: 1.7,
    pad: 0.4,
  });
  for (const [cx, cz] of sedgeCentres) {
    const k = Math.round(range(rng, COVER.sedge.perClump[0], COVER.sedge.perClump[1]));
    for (let i = 0; i < k; i++) {
      const a = rng() * TAU;
      const r = range(rng, 0.05, 0.55);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      path.query(x, z, pq);
      if (pq.dist < margin + 0.2 || obstacles.blocked(x, z, 0.05)) continue;
      out.sedge.push({ x, y: groundHeight(x, z) - 0.02, z, size: range(rng, COVER.sedge.size[0], COVER.sedge.size[1]), yaw: rng() * TAU, tilt: range(rng, -0.05, 0.1), tint: greenTint(rng, 0.8, 1.1) });
    }
    yield;
  }

  // ---- bramble canes arching over the floor at the edge of the glades
  yield* sample(
    COVER.bramble.count,
    (x, z, pd) => clamp(smoothstep(0.38, 0.62, F.colony(3, x + 5, z + 2, 0.25)) * (0.2 + 0.8 * F.gap(x, z)) * smoothstep(1.0, 3.2, pd) * farFade(pd) * 1.6),
    (x, z, size) => out.bramble.push({ x, y: groundHeight(x, z) - 0.02, z, size, yaw: rng() * TAU, tint: greenTint(rng, 0.8, 1.0) }),
    { sizeFn: () => range(rng, COVER.bramble.size[0], COVER.bramble.size[1]), guardMax: 6000, minPd: 2.2, pad: 0.3 },
  );

  // ---- a drift of fallen beech leaves in the lee of the log (the path side, piled toward the crown end)
  {
    const L = logFrame.L;
    let n = 0;
    let guard = 0;
    while (n < COVER.beech.count && guard++ < 2000) {
      // along the trunk, denser toward the crown end where the root plate does not shelter it
      const x = L * (0.15 + 0.85 * Math.pow(rng(), 0.7));
      // sideways from the near flank, exponentially piling against the trunk
      const off = -Math.log(1 - rng() * 0.97) * 0.38;
      const c = logFrame.centre(x);
      const rr = logFrame.R0 * 1.02;
      const px = c[0] + logFrame.side[0] * (rr + off) + range(rng, -0.05, 0.05);
      const pz = c[2] + logFrame.side[2] * (rr + off) + range(rng, -0.05, 0.05);
      path.query(px, pz, pq);
      if (pq.dist < margin) continue;
      if (obstacles.logDist(px, pz) < FALLEN_LOG.r * 0.9) continue;
      const stack = 0.012 + 0.03 * Math.exp(-off * 3) * rng();
      out.beech.push({
        x: px,
        y: groundHeight(px, pz) + stack,
        z: pz,
        size: range(rng, 0.075, 0.12),
        yaw: rng() * TAU,
        cell: Math.floor(rng() * 4),
        tilt: range(rng, -0.12, 0.12),
        roll: range(rng, -0.12, 0.12),
        tint: (() => {
          const v = range(rng, 0.7, 1.1);
          return [v, v * range(rng, 0.9, 1.02), v * range(rng, 0.8, 1.0)];
        })(),
      });
      n++;
    }
    // and a handful lying on top of the trunk's moss
    for (let i = 0; i < 12; i++) {
      const x = L * range(rng, 0.1, 0.95);
      const a = range(rng, -50, 50) * DEG;
      const p = logFrame.point(x, a, 0.012);
      const v = range(rng, 0.7, 1.1);
      out.beech.push({ x: p[0], y: p[1], z: p[2], size: range(rng, 0.07, 0.11), yaw: rng() * TAU, cell: Math.floor(rng() * 4), tilt: 0, roll: 0, tint: [v, v * 0.95, v * 0.88], n: logFrame.normalAt(a) });
    }
  }
  yield;

  // ---- ivy runners draped on the trunk (from the log's own detail list)
  for (const iv of logDetails.ivy) {
    const p = logFrame.point(iv.x, iv.a, 0.008);
    out.ivy.push({ x: p[0], y: p[1], z: p[2], size: iv.size, yaw: iv.yaw, n: logFrame.normalAt(iv.a), tint: greenTint(rng, 0.75, 1.0), onLog: true, along: iv.yaw });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Mushrooms
// ------------------------------------------------------------------------------------------------
// Colour targets are brand tones mixed together (the atlas is near white, the instance colour is the cap).
const MUSH = {
  cream: mixRgb(TONE.cream, TONE.stone, 0.25),
  tan: mixRgb(TONE.cream, TONE.timber, 0.5),
  honey: mixRgb(TONE.timber, TONE.warm, 0.5),
  brown: mixRgb(TONE.timber, TONE.timberDark, 0.5),
  orange: mixRgb(TONE.warm, TONE.timber, 0.3),
  shelf: mixRgb(TONE.timber, TONE.stone, 0.25),
};

function mushTint(rng, bytes, jitter = 0.08) {
  const c = linearFromBytes(bytes, range(rng, 1 - jitter, 1 + jitter));
  return [c.r, c.g, c.b];
}

// Returns records { kind, x, y, z, axis:[x,y,z], radius, stem (stem length multiplier), tint, yaw }.
export function placeMushrooms(logFrame, logDetails) {
  const rng = createRng(FLORA_SEED + 41);
  const out = [];
  const lean = (maxDeg, away = null) => {
    // unit axis tilted from vertical by up to maxDeg, optionally biased away from a point
    const t = range(rng, 0, maxDeg) * DEG;
    const az = away !== null ? away + range(rng, -0.6, 0.6) : rng() * TAU;
    return [Math.sin(t) * Math.cos(az), Math.cos(t), Math.sin(t) * Math.sin(az)];
  };
  const [m0, m1, m2] = MUSHROOM_CLUSTERS;

  // cluster 0: a fairy ring of small brown and tan caps in the litter (an open arc, not a closed circle)
  {
    const c = atPath(m0.s, m0.lateral);
    const arc0 = rng() * TAU;
    const span = range(rng, 3.8, 4.6);
    for (let i = 0; i < m0.count; i++) {
      const a = arc0 + (i / (m0.count - 1)) * span + range(rng, -0.12, 0.12);
      const rr = 0.4 + range(rng, -0.06, 0.06);
      const x = c.x + Math.cos(a) * rr;
      const z = c.z + Math.sin(a) * rr;
      out.push({
        kind: i % 3 === 2 ? "open" : "bun",
        x,
        y: groundHeight(x, z) - 0.008,
        z,
        axis: lean(14, a),
        radius: range(rng, 0.017, 0.032),
        stem: range(rng, 0.8, 1.25),
        tint: mushTint(rng, i % 2 ? MUSH.brown : MUSH.tan),
        yaw: rng() * TAU,
      });
    }
  }

  // cluster 1: one cluster of larger caps: cream, tan and a single orange-brown
  {
    const c = atPath(m1.s, m1.lateral);
    const tints = [MUSH.cream, MUSH.tan, MUSH.orange, MUSH.tan];
    for (let i = 0; i < m1.count; i++) {
      const a = range(rng, 0, TAU);
      const rr = range(rng, 0.05, 0.3);
      const x = c.x + Math.cos(a) * rr;
      const z = c.z + Math.sin(a) * rr;
      out.push({
        kind: i === 2 ? "funnel" : i % 2 ? "open" : "funnel",
        x,
        y: groundHeight(x, z) - 0.01,
        z,
        axis: lean(16, a),
        radius: range(rng, 0.045, 0.085) * (i === 0 ? 1.15 : 1),
        stem: range(rng, 0.7, 1.15),
        tint: mushTint(rng, tints[i % tints.length]),
        yaw: rng() * TAU,
      });
    }
  }

  // cluster 2: honey fungus at the rotting stub, caps of every age pressed together
  {
    const st = rottenStub();
    for (let i = 0; i < m2.count; i++) {
      const a = rng() * TAU;
      const onStub = i < 3; // three grow out of the stub itself, the rest from the ground around its foot
      const rr = onStub ? st.r * 1.0 : range(rng, st.r * 1.3, 0.34);
      const x = st.x + Math.cos(a) * rr;
      const z = st.z + Math.sin(a) * rr;
      const y = onStub ? st.y + range(rng, 0.1, 0.26) : groundHeight(x, z) - 0.008;
      const ax = onStub ? [Math.cos(a) * 0.75, 0.55, Math.sin(a) * 0.75] : lean(30, a);
      const il = 1 / Math.hypot(ax[0], ax[1], ax[2]);
      out.push({
        kind: i % 4 === 0 ? "bun" : "open",
        x,
        y,
        z,
        axis: [ax[0] * il, ax[1] * il, ax[2] * il],
        radius: range(rng, 0.02, 0.048),
        stem: range(rng, 0.7, 1.3),
        tint: mushTint(rng, i % 3 === 0 ? MUSH.tan : MUSH.honey),
        yaw: rng() * TAU,
      });
    }
  }

  // honey fungus on the log itself
  for (const m of logDetails.mushrooms) {
    const p = logFrame.point(m.x, m.a, -0.012);
    const n = logFrame.normalAt(m.a);
    const ax = [n[0] * 0.8, n[1] * 0.8 + 0.7, n[2] * 0.8];
    const il = 1 / Math.hypot(ax[0], ax[1], ax[2]);
    out.push({
      kind: "open",
      x: p[0],
      y: p[1],
      z: p[2],
      axis: [ax[0] * il, ax[1] * il, ax[2] * il],
      radius: m.radius,
      stem: m.stem,
      tint: mushTint(rng, MUSH.honey),
      yaw: rng() * TAU,
    });
  }
  return out;
}

export function shelfTint(rng) {
  const c = linearFromBytes(MUSH.shelf, range(rng, 0.85, 1.1));
  return [c.r, c.g, c.b];
}

// Everything the placement stage computes in one place, driven as a generator by the build scheduler.
export function* placeAll(reach, logFrame, logDetails) {
  const path = createPathField();
  const obstacles = createObstacles(logFrame);
  const fields = createFields(obstacles);
  const ctx = { path, obstacles, fields };
  // log fern spots in world space
  const logFerns = logDetails.ferns.map((f) => {
    const p = logFrame.point(f.x, f.a, -0.015);
    return { species: f.species, size: f.size, x: p[0], y: p[1], z: p[2] };
  });
  yield;
  const ferns = yield* placeFerns(ctx, reach, logFerns);
  const cover = yield* placeCover(ctx, logFrame, logDetails);
  const mushrooms = placeMushrooms(logFrame, logDetails);
  return { ferns, cover, mushrooms };
}

export { MUSHROOMS };
export const _THREE_FOR_TYPES = THREE;
