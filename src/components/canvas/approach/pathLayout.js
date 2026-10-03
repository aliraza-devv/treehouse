// WHERE the discrete things on and beside the path go: exposed roots, stepping stones and the
// obstacle circles that litter must keep out of. Pure data (no three.js objects), seeded, so the
// geometry builders, the painted ground maps and the litter scatter all read the same layout.

import { atPath, CLOSE_TRUNKS, MID_TRUNKS, ROOT_CROSSINGS, FALLEN_LOG, STUMP, MUSHROOM_CLUSTERS, SIGNS } from "@/lib/sections/world";
import { TREE } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { createNoise, clamp, smoothstep } from "@/lib/noise";
import { rideHeight, locate, dirtEdge, pathSlope, puddleAt } from "./pathMath";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const ROOT_TUNING = {
  flareCounts: [7, 6, 6, 7], // roots per CLOSE_TRUNKS entry (6 to 8; each costs 24 triangles)
  // The trunk author may flare the base of a trunk (the hero trunk is 2x its breast height radius at
  // the ground). Roots start inside the trunk at 0.8 r and are measured from the assumed ground level
  // surface at trunkBaseFlare * r, so they emerge from a flared trunk instead of being swallowed.
  trunkBaseFlare: 1.5,
  flareReach: [0.35, 1.5], // metres a flare root runs out of the trunk surface (skewed to the short end)
  crossingRings: 9, // rings along a path crossing root
  subRootsPerCrossing: 2,
};
export const STONE_TUNING = {
  diameter: [0.25, 0.6], // metres across (the long axis)
  sink: [0.03, 0.06], // metres buried below the dirt
  top: [0.02, 0.05], // metres the dome stands proud of the dirt
};

const noise = createNoise(6161);

// World frame helper: the trunk bases the roots belong to.
function trunkWorld(t) {
  const p = atPath(t.s, t.lateral);
  return { id: t.id, x: p.x, z: p.z, r: t.r, lateral: t.lateral, s: t.s };
}
const CLOSE = CLOSE_TRUNKS.map(trunkWorld);
const MID = MID_TRUNKS.map((t) => ({ id: t.id, x: t.x, z: t.z, r: t.r, lateral: t.lateral, s: t.s }));

// ------------------------------------------------------------------------------------------------
// ROOTS
// A root is a list of rings along its axis: { x, z, y, w, h, d } with the ring centre (x, y, z), the
// half width w across, the height h of the visible top above the centre, and the distance d from the
// start. It is a half tube: only the upper part shows, the rest is buried.
// ------------------------------------------------------------------------------------------------
function ringsFor(points, radiusAt, { rise = 0, riseLen = 0.45, riseFrom = 0, sinkFrac = 0.8, wk = 1.38, hk = 0.64, burial = 0.0, d0 = 0 } = {}) {
  const rings = [];
  let d = d0; // distance of the first ring from the trunk centre line start (r0)
  const last = points.length - 1;
  for (let i = 0; i <= last; i++) {
    const p = points[i];
    if (i > 0) d += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const u = i / last;
    const R = radiusAt(d, u);
    const w = wk * R;
    const h = hk * R;
    // the centre sits at the dirt level, lifted where the root climbs into the trunk and dipping
    // under the ground at its far end (it dives into the soil there)
    const sink = (h * 1.25 + 0.02) * smoothstep(sinkFrac, 1, u);
    const y = rideHeight(p.x, p.z) + 0.004 + rise * Math.exp(-Math.max(0, d - riseFrom) / riseLen) - sink - burial * R;
    rings.push({ x: p.x, z: p.z, y, w, h, d });
  }
  return rings;
}

function nearestTrunkOffPath(C) {
  let best = null;
  let bd = Infinity;
  for (const t of [...CLOSE, ...MID]) {
    if (Math.abs(t.lateral) < 1.0) continue;
    const d = Math.hypot(t.x - C.x, t.z - C.z);
    if (d - t.r > 0.45 && d < bd) {
      bd = d;
      best = t;
    }
  }
  return best ? { trunk: best, dist: bd } : null;
}

// One root that crosses the path. Starts inside the trunk it belongs to, swells where it leaves it,
// runs across the dirt at a believable (not perpendicular) angle and dives into the far verge, with
// a couple of finer sub-roots forking off it.
function buildCrossingRoot(rc, k) {
  const rng = createRng(9100 + k * 77);
  const C = atPath(rc.s, rc.lateral);
  const found = nearestTrunkOffPath(C);
  const roots = [];
  if (!found) return roots;
  const T = found.trunk;
  let dx = (C.x - T.x) / found.dist;
  let dz = (C.z - T.z) / found.dist;
  // not quite straight at the path: roots wander, so rotate the heading by up to ~20 degrees
  const rot = (rng() < 0.5 ? -1 : 1) * range(rng, 0.1, 0.34);
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  [dx, dz] = [dx * ca - dz * sa, dx * sa + dz * ca];
  const px = -dz;
  const pz = dx;
  const r0 = T.r * 0.8; // start inside the trunk
  const dSurf = Math.max(0, T.r * ROOT_TUNING.trunkBaseFlare - r0); // metres from the start to the trunk surface
  const reach = found.dist - r0 + rc.span * 0.5;
  const N = ROOT_TUNING.crossingRings;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const d = reach * Math.pow(u, 0.9);
    // gentle S wander across the heading, none at the trunk
    const wob = (0.13 * Math.sin(1.7 * d + k * 2.1) + 0.07 * noise.perlin2(d * 1.3, k * 5.1)) * smoothstep(0, 0.8, d);
    pts.push({ x: T.x + dx * (r0 + d) + px * wob, z: T.z + dz * (r0 + d) + pz * wob });
  }
  // radius profile: a swelling flare at the trunk, tapering and lumpy along the run
  const main = ringsFor(
    pts,
    (d, u) =>
      rc.r * (0.62 + 1.25 * Math.exp(-Math.max(0, d - dSurf) / 0.65)) * (1 - 0.62 * smoothstep(0.55, 1, u)) * (1 + 0.1 * noise.perlin2(d * 2.1 + k * 9, 9.9)),
    { rise: 0.55 * rc.r * 2, riseLen: 0.4, riseFrom: dSurf },
  );
  roots.push({ kind: "crossing", trunkId: T.id, rings: main });

  // sub-roots: forks that leave the main root and bury themselves
  for (let q = 0; q < ROOT_TUNING.subRootsPerCrossing; q++) {
    const ta = range(rng, 0.32, 0.72);
    const idx = ta * (N - 1);
    const i0 = Math.floor(idx);
    const f = idx - i0;
    const a = main[i0];
    const b = main[Math.min(i0 + 1, N - 1)];
    const ox = a.x + (b.x - a.x) * f;
    const oz = a.z + (b.z - a.z) * f;
    const Rm = (a.w + (b.w - a.w) * f) / 1.38;
    const side = q === 0 ? 1 : -1;
    const ang = side * range(rng, 0.5, 0.85);
    // main root heading at the fork (towards the next ring)
    const hx = b.x - a.x;
    const hz = b.z - a.z;
    const hl = Math.hypot(hx, hz) || 1;
    const c2 = Math.cos(ang);
    const s2 = Math.sin(ang);
    const sx = (hx / hl) * c2 - (hz / hl) * s2;
    const sz = (hx / hl) * s2 + (hz / hl) * c2;
    const len = range(rng, 0.55, 0.95);
    const sp = [];
    const M = 5;
    for (let i = 0; i < M; i++) {
      const u = i / (M - 1);
      const d = len * u;
      const bend = 0.12 * Math.sin(u * 3 + q * 2) * u;
      sp.push({ x: ox + sx * d - sz * bend, z: oz + sz * d + sx * bend });
    }
    const Rs = Rm * 0.55;
    roots.push({
      kind: "sub",
      trunkId: T.id,
      rings: ringsFor(sp, (d, u) => Rs * (1 - 0.7 * u) * (1 + 0.1 * noise.perlin2(d * 3 + q * 5, k)), { sinkFrac: 0.6 }),
    });
  }
  return roots;
}

// The buttress roots at the foot of a close trunk. Their reach is shortened until the tip stays off
// the worn dirt, and the boot's side of c2 is kept clear for the story prop.
function buildFlareRoots(trunk, ti) {
  const rng = createRng(trunk.id.charCodeAt(1) * 977 + ti * 31);
  const n = ROOT_TUNING.flareCounts[ti % ROOT_TUNING.flareCounts.length];
  // direction from the trunk to the nearest dirt, to leave the boot a clear patch on c2
  const loc = locate(trunk.x, trunk.z);
  const centre = atPath(loc.s, 0);
  const pathDir = Math.atan2(centre.z - trunk.z, centre.x - trunk.x);
  const gap = trunk.id === "c2" ? 0.62 : 0;

  const roots = [];
  const phase = rng() * TAU;
  let k = 0;
  let guard = 0;
  while (roots.length < n && guard++ < 40) {
    // evenly spread with strong jitter (clumps and gaps, never a star)
    const ang = phase + (k / n) * TAU + range(rng, -0.42, 0.42) * (TAU / n);
    k++;
    const dAng = Math.atan2(Math.sin(ang - pathDir), Math.cos(ang - pathDir));
    if (gap && Math.abs(dAng) < gap) continue;
    const scale = trunk.r / 0.42;
    // reach (metres beyond the trunk surface) skewed to the short end: a few long roots among
    // many stubby buttress ridges, never a regular star
    const bias = Math.pow(rng(), 1.7);
    let reach = (ROOT_TUNING.flareReach[0] + (ROOT_TUNING.flareReach[1] - ROOT_TUNING.flareReach[0]) * bias) * Math.sqrt(scale);
    const dirx = Math.cos(ang);
    const dirz = Math.sin(ang);
    const r0 = trunk.r * 0.8; // start inside the trunk
    const dSurf = Math.max(0, trunk.r * ROOT_TUNING.trunkBaseFlare - r0);
    // keep the tip off the dirt (and its ragged fringe): shorten until clear
    for (let tries = 0; tries < 8; tries++) {
      const tx = trunk.x + dirx * (r0 + dSurf + reach);
      const tz = trunk.z + dirz * (r0 + dSurf + reach);
      const l = locate(tx, tz);
      if (dirtEdge(l.s, l.lateral) < -0.12) break;
      reach *= 0.72;
    }
    if (reach < 0.25) continue;
    // longer roots are thicker where they leave the trunk
    const R0 = range(rng, 0.075, 0.12) * scale * (0.75 + 0.55 * bias);
    const pts = [
      { d: dSurf * 0.9, u: 0 },
      { d: dSurf + reach * 0.25, u: 0.25 },
      { d: dSurf + reach * 0.6, u: 0.6 },
      { d: dSurf + reach, u: 1 },
    ].map(({ d, u }) => {
      const wob = (0.07 * Math.sin(ang * 3 + u * 4 + ti) + 0.05 * noise.perlin2(ti * 7 + k, u * 2)) * u * (0.5 + bias);
      return { x: trunk.x + dirx * (r0 + d) - dirz * wob, z: trunk.z + dirz * (r0 + d) + dirx * wob };
    });
    roots.push({
      kind: "flare",
      trunkId: trunk.id,
      rings: ringsFor(pts, (d) => R0 * (0.5 + 0.75 * Math.exp(-Math.max(0, d - dSurf) / 0.45)) * (1 - 0.5 * Math.min(1, Math.max(0, d - dSurf) / reach)), {
        rise: 0.2 * scale + range(rng, 0, 0.1),
        riseLen: 0.5,
        riseFrom: dSurf,
        d0: dSurf * 0.9,
        sinkFrac: 0.62,
        wk: 1.25,
        hk: 0.85,
      }),
    });
  }
  return roots;
}

export function buildRoots() {
  const crossing = ROOT_CROSSINGS.flatMap((rc, k) => buildCrossingRoot(rc, k));
  const flares = CLOSE.flatMap((t, i) => buildFlareRoots(t, i));
  return { crossing, flares, all: [...crossing, ...flares] };
}

// Distance from (x, z) to the nearest root surface (negative inside a root). Used so litter does not
// sit inside a root and stones do not overlap one. Segment list is built once per layout.
function rootSegments(roots) {
  const segs = [];
  for (const root of roots) {
    for (let i = 0; i < root.rings.length - 1; i++) {
      const a = root.rings[i];
      const b = root.rings[i + 1];
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, wa: a.w, wb: b.w });
    }
  }
  return segs;
}
export function rootDistance(segs, x, z) {
  let best = Infinity;
  for (const s of segs) {
    const ex = s.bx - s.ax;
    const ez = s.bz - s.az;
    const t = clamp(((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    const d = Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)) - (s.wa + (s.wb - s.wa) * t);
    if (d < best) best = d;
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// STEPPING STONES
// Anchors are where the path is wet (the puddles) or steeper (the rise in the middle): irregular
// spacing, some in a short run across the water, some alone. Each anchor is jittered, then nudged
// until it clears the roots and the other stones.
// ------------------------------------------------------------------------------------------------
const STONE_ANCHORS = [
  // a run across the first puddle: three stones, uneven gaps
  { s: 0.213, lateral: 0.22 },
  { s: 0.252, lateral: -0.2 },
  { s: 0.292, lateral: 0.1 },
  // a loner at the lowest part of the bend
  { s: 0.385, lateral: -0.32 },
  // the steeper rise, two close together and one off to the side
  { s: 0.575, lateral: 0.18 },
  { s: 0.612, lateral: -0.26 },
  { s: 0.655, lateral: 0.42 },
  // near the end, where the ground is trampled and wet under the trunk
  { s: 0.822, lateral: -0.12 },
  { s: 0.9, lateral: 0.3 },
];

export function buildStones(rootSegs) {
  const rng = createRng(4747);
  const out = [];
  STONE_ANCHORS.forEach((a, i) => {
    const sizeBias = i % 3 === 0 ? 0.7 : rng();
    const dia = range(rng, STONE_TUNING.diameter[0], STONE_TUNING.diameter[1]) * (0.8 + 0.3 * sizeBias);
    const diameter = clamp(dia, STONE_TUNING.diameter[0], STONE_TUNING.diameter[1]);
    const rx = diameter / 2;
    const rz = rx * range(rng, 0.62, 0.98);
    const rMax = Math.max(rx, rz);
    let placed = null;
    for (let tries = 0; tries < 16 && !placed; tries++) {
      const s = a.s + (tries === 0 ? 0 : range(rng, -0.012, 0.012) * tries * 0.5) + range(rng, -0.006, 0.006);
      const p = atPath(s, a.lateral + (tries === 0 ? 0 : range(rng, -0.1, 0.1)) + range(rng, -0.05, 0.05));
      const clearOfRoots = rootDistance(rootSegs, p.x, p.z) > rMax + 0.04;
      const clearOfStones = out.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > o.rMax + rMax + 0.14);
      if (clearOfRoots && clearOfStones) placed = p;
    }
    if (!placed) return;
    const l = locate(placed.x, placed.z);
    out.push({
      id: i,
      x: placed.x,
      z: placed.z,
      s: l.s,
      lateral: l.lateral,
      rx,
      rz,
      rMax,
      yaw: rng() * TAU,
      top: range(rng, STONE_TUNING.top[0], STONE_TUNING.top[1]),
      sink: range(rng, STONE_TUNING.sink[0], STONE_TUNING.sink[1]),
      pitch: range(rng, -0.05, 0.05),
      roll: range(rng, -0.05, 0.05),
      variant: i % 4,
      // 0 = warm sandstone, 1 = grey flint, picked by the stone, with a little mix
      grey: clamp((i * 0.37 + rng() * 0.5) % 1, 0, 1),
      wetness: clamp(puddleAt(l.along, l.lateral) + 0.35 * pathSlope(l.s) * 6, 0, 1),
    });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// OBSTACLES for litter: circles (x, z, r) around everything solid that other agents place near the
// path, so a fallen leaf never lies inside a trunk, a signpost, a stump, a mushroom or the log.
// ------------------------------------------------------------------------------------------------
export function buildObstacles() {
  const out = [];
  for (const t of [...CLOSE, ...MID]) out.push({ x: t.x, z: t.z, r: t.r + 0.1 });
  out.push({ x: TREE.x, z: TREE.z, r: 2.1 });
  for (const sg of SIGNS) {
    const p = atPath(sg.s, sg.lateral);
    out.push({ x: p.x, z: p.z, r: 0.28 });
  }
  const st = atPath(STUMP.s, STUMP.lateral);
  out.push({ x: st.x, z: st.z, r: STUMP.r + 0.12 });
  for (const m of MUSHROOM_CLUSTERS) {
    const p = atPath(m.s, m.lateral);
    out.push({ x: p.x, z: p.z, r: 0.3 });
  }
  // the boot at the base of c2 on the path side
  const c2 = CLOSE.find((t) => t.id === "c2");
  if (c2) {
    const l = locate(c2.x, c2.z);
    const toward = atPath(l.s, 0);
    const dx = toward.x - c2.x;
    const dz = toward.z - c2.z;
    const dl = Math.hypot(dx, dz) || 1;
    out.push({ x: c2.x + (dx / dl) * (c2.r + 0.18), z: c2.z + (dz / dl) * (c2.r + 0.18), r: 0.22 });
  }
  // the fallen log: a capsule approximated by circles along its axis (yaw is from +X toward +Z)
  const lc = atPath(FALLEN_LOG.s, FALLEN_LOG.lateral);
  const ly = (FALLEN_LOG.yawDeg * Math.PI) / 180;
  for (let t = -FALLEN_LOG.length / 2; t <= FALLEN_LOG.length / 2 + 0.01; t += 0.4) {
    out.push({ x: lc.x + Math.cos(ly) * t, z: lc.z + Math.sin(ly) * t, r: FALLEN_LOG.r + 0.14 });
  }
  return out;
}

// One call that builds the whole layout (cheap: a few hundred floating point operations per item).
export function buildPathLayout() {
  const roots = buildRoots();
  const rootSegs = rootSegments(roots.all);
  const stones = buildStones(rootSegs);
  return { roots, rootSegs, stones, obstacles: buildObstacles() };
}
