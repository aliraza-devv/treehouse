// Pure math for the worn path and the ground around it (no three.js objects, no canvas).
//
// Everything that lays something onto the path asks THIS file where the dirt is, how wide it is at
// that point, how high the real rendered ground is and where the puddles lie, so the ribbon mesh, its
// painted textures, the stepping stones, roots and litter all agree with each other.
//
// Coordinates: s is the arc length fraction along the centreline (0 = under the hero camera, 1 = the
// trunk base). `lateral` is metres to the walker's RIGHT of the centreline (negative = left).

import { groundHeight } from "@/lib/sceneConfig";
import { createNoise, clamp, smoothstep } from "@/lib/noise";
import { PATH_LENGTH, PATH_WIDTH, pathAt } from "@/lib/sections/world";

// ------------------------------------------------------------------------------------------------
// TUNING: the strip of ground the path mesh covers
// ------------------------------------------------------------------------------------------------
export const RIBBON = {
  along: 96, // segments along the path (about 15 cm each). 120 is smoother, costs +190 triangles
  across: 4, // segments across. The dirt shape is painted, so a straight strip needs very few
  halfWidth: 1.95, // metres either side of the centreline that the strip covers (alpha cut inside it)
  // Metres the strip rides above the rendered hero ground. The strip is a bilinear patch over ~0.9 m by
  // 15 cm cells but the hero floor is a coarse piecewise linear mesh whose creases cut through those
  // cells, so the strip can sit up to ~1.8 cm too low there; 2 cm clears every case (measured over the
  // whole strip). 2 cm is invisible at eye level and the alpha cut edge hides the step.
  lift: 0.02,
  fringe: 0.5, // metres of litter-coloured fringe beyond the dirt edge before the ragged alpha cut
  microTile: 2.4, // metres of ground one tile of the fine (pebble and cracks) texture covers
};

// ------------------------------------------------------------------------------------------------
// The rendered hero ground. ForestEnvironment builds its floor as a coarse graded grid (about 2.7 m
// cells near the path) whose vertices sit on groundHeight(). Between vertices it is piecewise LINEAR,
// which differs from the smooth analytic height by up to 3 cm here, more than a path laid a few
// millimetres above groundHeight() can hide. So the path samples the actual triangles.
// MIRRORS ForestEnvironment.buildGround (axisCoords, the xs / zs focus values and the triangle split
// a-c-b / b-c-d). If that grid is ever changed, change this to match.
// ------------------------------------------------------------------------------------------------
function axisCoords(focus, minus, plus) {
  const out = [focus];
  let d = 0;
  while (d < plus - 0.01) {
    d = Math.min(plus, d + 2.7 + 0.09 * d);
    out.push(focus + d);
  }
  d = 0;
  while (d < minus - 0.01) {
    d = Math.min(minus, d + 2.7 + 0.09 * d);
    out.unshift(focus - d);
  }
  return out;
}
const GRID_X = axisCoords(1, 100, 100);
const GRID_Z = axisCoords(2, 105, 22);

// Index i with arr[i] <= v < arr[i + 1] (clamped to the grid).
function cellOf(arr, v) {
  let lo = 0;
  let hi = arr.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Height of the rendered hero floor at (x, z). Falls back toward the analytic height if the grid
// mirror ever drifts (the deviation is clamped to 5 cm).
export function groundSurface(x, z) {
  const i = cellOf(GRID_X, x);
  const j = cellOf(GRID_Z, z);
  const x0 = GRID_X[i];
  const x1 = GRID_X[i + 1];
  const z0 = GRID_Z[j];
  const z1 = GRID_Z[j + 1];
  const u = (x - x0) / (x1 - x0);
  const v = (z - z0) / (z1 - z0);
  const ha = groundHeight(x0, z0);
  const hb = groundHeight(x1, z0);
  const hc = groundHeight(x0, z1);
  const hd = groundHeight(x1, z1);
  // The cell is split along the b-c diagonal: u + v <= 1 is the (a, c, b) triangle.
  const h = u + v <= 1 ? ha + (hb - ha) * u + (hc - ha) * v : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  const g = groundHeight(x, z);
  return g + clamp(h - g, -0.05, 0.05);
}

// Height at which something lying on the ground should rest at (x, z): on top of the dirt strip where
// the strip is opaque (the dirt and its fringe), on the bare hero floor beyond it. Blends over the
// ragged alpha cut zone so litter at the dirt's edge does not float or sink.
export function rideHeight(x, z) {
  const l = locate(x, z);
  const ed = dirtEdge(l.s, l.lateral);
  return groundSurface(x, z) + RIBBON.lift * smoothstep(-RIBBON.fringe - 0.05, -0.2, ed);
}

// ------------------------------------------------------------------------------------------------
// Path profile: where the dirt really is (it wanders off the control spline, it is never a constant
// width, and the two edges are ragged independently)
// ------------------------------------------------------------------------------------------------
const pn = createNoise(5151);

// Returns { centre, left, right, width }. The dirt spans lateral in [centre - left, centre + right].
// centre is the wear line (boots follow it, it drifts up to about 15 cm off the spline). width is the
// full dirt width (1.3 to 2.0 m), widening a little where the walker reaches the trunk and the ground
// is trampled.
export function pathProfile(s) {
  const a = s * PATH_LENGTH; // metres walked
  const trample = 1 + 0.16 * smoothstep(0.84, 1.0, s);
  const width = clamp((PATH_WIDTH + 0.26 * pn.perlin2(a * 0.23, 3.1) + 0.12 * pn.perlin2(a * 0.7, 7.7)) * trample, 1.3, 2.0);
  const centre = 0.1 * pn.perlin2(a * 0.18, 11.3) + 0.05 * pn.perlin2(a * 0.5, 4.2);
  // low frequency noise on each edge so there are no ruler lines (about +-10 percent)
  let left = 0.5 * width * (1 + 0.1 * pn.perlin2(a * 1.3, 21.5));
  let right = 0.5 * width * (1 + 0.1 * pn.perlin2(a * 1.1, 33.1));
  // narrower on the inside of the tight elbows (the corner is cut off, as it would be on the ground)
  const bend = pathBend(s);
  const cap = Math.max(0.3, bend.limit - 0.18);
  if (bend.inner > 0) right = Math.min(right, cap - centre);
  else left = Math.min(left, cap + centre);
  return { centre, left, right, width };
}

// Metres INSIDE the dirt edge at (s, lateral): positive on the dirt, 0 at the edge, negative outside.
export function dirtEdge(s, lateral) {
  const p = pathProfile(s);
  const d = lateral - p.centre;
  return d >= 0 ? p.right - d : p.left + d;
}

// ------------------------------------------------------------------------------------------------
// Fast nearest-point lookup on the centreline (the world.js toPath is a 97 sample scan that is too
// slow for thousands of placement tests). A 256 sample table with segment projection.
// ------------------------------------------------------------------------------------------------
const SAMPLES = 256;
const TBL = [];
for (let i = 0; i <= SAMPLES; i++) {
  const p = pathAt(i / SAMPLES);
  TBL.push({ s: i / SAMPLES, x: p.x, z: p.z, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz });
}

// { s, lateral, dist, along } for the centreline point nearest to (x, z). `along` is metres walked.
export function locate(x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const d = (x - TBL[i].x) ** 2 + (z - TBL[i].z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  // project onto the two neighbouring segments and keep the closer foot point
  let out = null;
  let od = Infinity;
  for (const k of [best - 1, best]) {
    if (k < 0 || k >= SAMPLES) continue;
    const a = TBL[k];
    const b = TBL[k + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez), 0, 1);
    const fx = a.x + ex * t;
    const fz = a.z + ez * t;
    const d = Math.hypot(x - fx, z - fz);
    if (d < od) {
      od = d;
      const rx = a.rx + (b.rx - a.rx) * t;
      const rz = a.rz + (b.rz - a.rz) * t;
      const rl = Math.hypot(rx, rz) || 1;
      const s = a.s + (b.s - a.s) * t;
      out = { s, lateral: ((x - fx) * rx + (z - fz) * rz) / rl, dist: d, along: s * PATH_LENGTH };
    }
  }
  return out;
}

// Smallest radius of curvature of the centreline in metres (the strip folds over on the inside of a
// bend tighter than RIBBON.halfWidth; the folded part is always in the alpha cut zone, but this is
// exported so the integrator can check it).
export function minCurvatureRadius() {
  let min = Infinity;
  for (let i = 2; i < SAMPLES - 1; i++) {
    const a = TBL[i - 1];
    const b = TBL[i];
    const c = TBL[i + 1];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 > 1e-9) min = Math.min(min, (ab * bc * ca) / (2 * area2));
  }
  return min;
}


// ------------------------------------------------------------------------------------------------
// Bends. The centreline has two tight elbows (radius about 0.9 to 1.4 m around s = 0.15 and s = 0.47).
// A straight cross-section strip folds over itself on the INSIDE of a bend tighter than its half
// width, so on the inside of those elbows the strip is trimmed (and the dirt narrowed) to stay
// clear of the centre of curvature. { inner: +1 | -1 | 0, limit } where inner is the side (+1 right)
// the centre of curvature lies on, limit the largest safe lateral distance on that side in metres.
// ------------------------------------------------------------------------------------------------
const BEND = (() => {
  const inner = new Float32Array(SAMPLES + 1);
  const raw = new Float32Array(SAMPLES + 1).fill(Infinity);
  for (let i = 1; i < SAMPLES; i++) {
    const a = TBL[i - 1];
    const b = TBL[i];
    const c = TBL[i + 1];
    const dtx = c.tx - a.tx;
    const dtz = c.tz - a.tz;
    const ds = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    const kappa = Math.hypot(dtx, dtz) / ds; // 1 / radius
    inner[i] = dtx * b.rx + dtz * b.rz >= 0 ? 1 : -1;
    raw[i] = kappa > 1e-4 ? 1 / kappa : Infinity;
  }
  // conservative envelope: minimum radius within +-8 samples, then a +-3 sample blur (which can
  // only stay at or under the true radius at every sample)
  const env = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    let m = Infinity;
    for (let k = Math.max(0, i - 8); k <= Math.min(SAMPLES, i + 8); k++) m = Math.min(m, raw[k]);
    env[i] = Math.min(m, 50);
  }
  const limit = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(SAMPLES, i + 3); k++) {
      sum += env[k];
      n++;
    }
    limit[i] = 0.94 * (sum / n);
  }
  // side of the nearest curved sample, filled in where the radius is large
  for (let i = 1; i <= SAMPLES; i++) if (!inner[i]) inner[i] = inner[i - 1];
  for (let i = SAMPLES - 1; i >= 0; i--) if (!inner[i]) inner[i] = inner[i + 1];
  return { inner, limit };
})();

export function pathBend(s) {
  const f = clamp(s, 0, 1) * SAMPLES;
  const i = Math.min(SAMPLES - 1, Math.floor(f));
  const t = f - i;
  return {
    inner: BEND.inner[Math.round(f)],
    limit: BEND.limit[i] + (BEND.limit[i + 1] - BEND.limit[i]) * t,
  };
}

// ------------------------------------------------------------------------------------------------
// Puddles. Placed in the two low, damp stretches of the path (the ground dips there). Metres: ra is
// the radius ALONG the path, rl the radius ACROSS it. The outline is made irregular when painted.
// ------------------------------------------------------------------------------------------------
export const PUDDLES = [
  { s: 0.255, lateral: -0.12, ra: 0.95, rl: 0.5, seed: 3 },
  { s: 0.635, lateral: 0.3, ra: 0.6, rl: 0.42, seed: 7 },
];

// Soft puddle membership 0..1 at (along metres, lateral metres) without outline noise (used for
// placement tests: stones may stand in a puddle, litter floats on it).
export function puddleAt(along, lateral) {
  let m = 0;
  for (const p of PUDDLES) {
    const q = Math.hypot((along - p.s * PATH_LENGTH) / p.ra, (lateral - p.lateral) / p.rl);
    m = Math.max(m, 1 - smoothstep(0.7, 1.0, q));
  }
  return m;
}

// Slope of the ground along the path (rise over run, absolute), used to find the steeper stretches
// where stones are set.
export function pathSlope(s) {
  const d = 0.012;
  const a = pathAt(Math.max(0, s - d));
  const b = pathAt(Math.min(1, s + d));
  const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return Math.abs(groundSurface(b.x, b.z) - groundSurface(a.x, a.z)) / run;
}
