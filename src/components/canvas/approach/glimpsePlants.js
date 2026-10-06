import { groundHeight } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { CLUSTER_RADIUS, CLUSTER_RHO, SUN, TEX, WOOD_MIN_RADIUS } from "./glimpseTuning";

// ===========================================================================================
// TREEHOUSE GLIMPSE: the plants (pure geometry plans, no THREE objects, runs in node).
//
// growPlant(spec) turns one plant spec into a SKELETON:
//   stems     [{ pts: [[x, y, z]...], radii: [...], bark }]   wood to be swept into tubes
//   clusters  [{ p, d, size, tex, hue, lit, sway, rho }]       leaf clusters: base point p, growth
//                                                              direction d (unit), size in metres
// The same skeleton feeds the line of sight evaluator (plantPrimitives) and the mesh builder, so what
// the solver measured is exactly what is drawn.
//
// Every random draw is made in a fixed order that depends only on the spec's counts and seed, never
// on where the plant stands. Moving a plant therefore moves a plant (it does not reshuffle its leaves),
// which keeps the offline optimiser smooth and the scene identical on every load.
//
// Species, all grown from a `top` point (the crown top or stem tip) and an `offset` (horizontal vector
// from the base to that top: the lean):
//   hazel     a stool of 4 to 6 arching stems, big soft leaves on short side shoots (a coppice hazel)
//   sapling   one leaning stem (young beech, hornbeam or oak reaching for a gap) with a few drooping
//             side branches, each ending in a spray of leaves
//   holly     a dense dark conical bush with a short stem
//   snag      a dead leaning pole with broken stubs, a honeysuckle or bramble vine twisting up it and
//             draping from the stubs, strung with small leaf clusters
// ===========================================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const GOLDEN = 2.399963; // golden angle in radians, spreads side branches round a stem without pattern

// ---- tiny vector helpers on plain arrays (kept allocation light, this runs thousands of times offline)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Quadratic Bezier through p0, c, p1 sampled at n + 1 points.
function bezier2(p0, c, p1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    out.push([a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1], a * p0[2] + b * c[2] + d * p1[2]]);
  }
  return out;
}

// Point and unit tangent at fraction t (0..1) along a polyline.
function along(pts, t) {
  const f = clamp01(t) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const u = f - i;
  return { p: lerp3(pts[i], pts[i + 1], u), tangent: norm(sub(pts[i + 1], pts[i])) };
}

// Radii that taper from r0 at the base to r1 at the tip with a slightly concave profile (a real stem
// stays thick for a while, then thins).
function taper(n, r0, r1, power = 1.25) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(r1 + (r0 - r1) * Math.pow(1 - i / (n - 1), power));
  return out;
}

// Sunlit rim value for a cluster: high on the upper, sun facing outside of the crown, low inside and
// underneath. `out` is the unit direction from the crown axis to the cluster, `h01` its height in the
// crown (0 bottom, 1 top). The sun is high and behind the tree (+X, -Z), so the walker mostly sees the
// shaded faces with bright translucent rims.
function litValue(out, h01, jitter) {
  return clamp01(0.18 + 0.5 * h01 + 0.3 * dot(out, SUN) + jitter);
}

function makeCluster(p, d, size, tex, hue, lit, sway, rhoMul = 1) {
  return { p, d: norm(d), size, tex, hue, lit, sway, rho: CLUSTER_RHO * rhoMul };
}

// ----------------------------------------------------------------------------------------------
// HAZEL STOOL
// spec: { top, offset, seed, spread, stems, perStem, size: [min, max], sway }
// ----------------------------------------------------------------------------------------------
function growHazel(spec) {
  const rng = createRng(spec.seed);
  const [tx, ty, tz] = spec.top;
  const bx = tx - spec.offset[0];
  const bz = tz - spec.offset[1];
  const y0 = groundHeight(bx, bz);
  const H = Math.max(2.5, ty - y0);
  const stems = [];
  const clusters = [];
  for (let i = 0; i < spec.stems; i++) {
    // Each stem leaves the stool at its own angle and ends at its own point round the crown top.
    const a = (i / spec.stems) * TAU + range(rng, -0.5, 0.5);
    const baseR = range(rng, 0.06, 0.26);
    const b = [bx + Math.cos(a) * baseR, y0 - 0.05, bz + Math.sin(a) * baseR];
    const spread = spec.spread * range(rng, 0.25, 1.0);
    const a2 = a + range(rng, -0.7, 0.7);
    const topY = y0 + H * range(rng, 0.7, 1.04);
    const T = [tx + Math.cos(a2) * spread, topY, tz + Math.sin(a2) * spread];
    // The control point sits almost above the base: the stem rises nearly straight, then arches out.
    const C = [b[0] + (T[0] - b[0]) * 0.18, b[1] + (T[1] - b[1]) * 0.82, b[2] + (T[2] - b[2]) * 0.18];
    const pts = bezier2(b, C, T, 4);
    const r0 = range(rng, 0.028, 0.048) * Math.min(1.3, H / 5);
    stems.push({ pts, radii: taper(pts.length, r0, 0.009), bark: "hazel" });
    for (let j = 0; j < spec.perStem; j++) {
      const t = Math.min(1, 0.36 + (0.64 * (j + range(rng, 0, 0.7))) / spec.perStem);
      const { p, tangent } = along(pts, t);
      const horiz = [p[0] - bx, 0, p[2] - bz];
      const out = len3(horiz) > 1e-3 ? norm(horiz) : [Math.cos(a), 0, Math.sin(a)];
      let d = [
        out[0] * range(rng, 0.55, 1.0) + range(rng, -0.35, 0.35),
        range(rng, 0.05, 0.6) + (t > 0.7 ? -0.25 : 0),
        out[2] * range(rng, 0.55, 1.0) + range(rng, -0.35, 0.35),
      ];
      const tip = j === spec.perStem - 1;
      if (tip) d = add(mul(tangent, 0.7), mul(norm(d), 0.3));
      const size = range(rng, spec.size[0], spec.size[1]) * (tip ? 1 : 0.85);
      const lit = litValue(out, clamp01((p[1] - y0) / H), range(rng, -0.15, 0.2));
      clusters.push(makeCluster(p, d, size, TEX.sprig, "hazel", lit, spec.sway));
    }
  }
  return { stems, clusters };
}

// ----------------------------------------------------------------------------------------------
// LEANING SAPLING (beech, hornbeam or oak) reaching toward a gap
// spec: { top, offset, seed, species, r0, branches, size: [min, max], sway }
// ----------------------------------------------------------------------------------------------
function growSapling(spec) {
  const rng = createRng(spec.seed);
  const [tx, ty, tz] = spec.top;
  const bx = tx - spec.offset[0];
  const bz = tz - spec.offset[1];
  const y0 = groundHeight(bx, bz);
  const H = Math.max(3, ty - y0);
  const oak = spec.species === "oak";
  const tex = oak ? TEX.oak : TEX.beech;
  const hue = oak ? "oak" : "beech";
  const bark = oak ? "oak" : "beech";
  // Stem: lean grows toward the top (a sapling is straight at the foot), plus a slow S wobble.
  const ph = range(rng, 0, TAU);
  const wob = range(rng, 0.06, 0.16);
  const side = norm([-spec.offset[1], 0, spec.offset[0]]);
  const N = 6;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const k = Math.pow(t, 1.4);
    const w = wob * Math.sin(t * Math.PI * 1.3 + ph) * Math.min(1, t * 3);
    pts.push([bx + spec.offset[0] * k + side[0] * w, y0 - 0.05 + (H + 0.05) * t, bz + spec.offset[1] * k + side[2] * w]);
  }
  const radii = taper(pts.length, spec.r0, 0.01);
  const stems = [{ pts, radii, bark }];
  const clusters = [];
  const axisXZ = [bx + spec.offset[0] * 0.5, bz + spec.offset[1] * 0.5];
  // Side branches: spiral up the top 60 percent, longest low in the crown, drooping at the ends.
  const nb = spec.branches;
  let az = range(rng, 0, TAU);
  for (let j = 0; j < nb; j++) {
    const t = 0.38 + (0.56 * (j + range(rng, 0, 0.6))) / nb;
    az += GOLDEN + range(rng, -0.35, 0.35);
    const { p: root } = along(pts, t);
    const rootR = radii[Math.min(radii.length - 1, Math.round(t * (radii.length - 1)))];
    const length = (2.0 - 1.3 * t) * range(rng, 0.8, 1.25);
    let elev = range(rng, 22, 50) * DEG;
    const bpts = [root];
    let cur = root;
    const seg = 3;
    for (let k = 0; k < seg; k++) {
      const dir = [Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)];
      cur = add(cur, mul(dir, length / seg));
      bpts.push(cur);
      elev -= range(rng, 6, 18) * DEG; // the branch arches over and its tip hangs
    }
    const br = Math.max(0.011, rootR * 0.5);
    stems.push({ pts: bpts, radii: taper(bpts.length, br, 0.006), bark });
    const nClusters = 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < nClusters; k++) {
      const u = nClusters === 1 ? 1 : k === 0 ? 1 : 0.35 + 0.35 * k + range(rng, -0.1, 0.1);
      const { p, tangent } = along(bpts, u);
      let d = tangent;
      if (u < 0.99) {
        // a mid-branch spray points out sideways and a little down
        const sideDir = [-tangent[2], 0, tangent[0]];
        d = norm(add(add(mul(tangent, 0.5), mul(sideDir, (k % 2 ? 1 : -1) * 0.7)), [0, range(rng, -0.35, 0.05), 0]));
      } else {
        d = norm(add(tangent, [0, -0.15, 0]));
      }
      const outDir = norm([p[0] - axisXZ[0], 0, p[2] - axisXZ[1]]);
      const size = range(rng, spec.size[0], spec.size[1]) * (u > 0.99 ? 1 : 0.8);
      const lit = litValue(outDir, clamp01((p[1] - y0) / H), range(rng, -0.15, 0.2));
      clusters.push(makeCluster(p, d, size, tex, hue, lit, spec.sway));
    }
  }
  // The leading shoot carries a spray along the stem direction.
  const top = along(pts, 1);
  clusters.push(
    makeCluster(top.p, add(top.tangent, [0, 0.2, 0]), range(rng, spec.size[0], spec.size[1]), tex, hue, clamp01(0.7 + range(rng, -0.1, 0.15)), spec.sway),
  );
  return { stems, clusters };
}

// ----------------------------------------------------------------------------------------------
// HOLLY: dense dark cone with a short stem
// spec: { top, offset, seed, spread, layers, size: [min, max], sway }
// ----------------------------------------------------------------------------------------------
function growHolly(spec) {
  const rng = createRng(spec.seed);
  const [tx, ty, tz] = spec.top;
  const bx = tx - spec.offset[0];
  const bz = tz - spec.offset[1];
  const y0 = groundHeight(bx, bz);
  const H = Math.max(2, ty - y0);
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push([bx + spec.offset[0] * Math.pow(t, 1.3), y0 - 0.05 + (H + 0.05) * t, bz + spec.offset[1] * Math.pow(t, 1.3)]);
  }
  const stems = [{ pts, radii: taper(pts.length, 0.05, 0.015), bark: "holly" }];
  const clusters = [];
  for (let l = 0; l < spec.layers; l++) {
    const f = 0.32 + (0.68 * l) / Math.max(1, spec.layers - 1);
    const per = l === spec.layers - 1 ? 2 : 3 + (rng() < 0.4 ? 1 : 0);
    const rad = spec.spread * (1 - 0.78 * f);
    const a0 = range(rng, 0, TAU);
    for (let m = 0; m < per; m++) {
      const a = a0 + (m / per) * TAU + range(rng, -0.45, 0.45);
      const { p: onStem } = along(pts, f);
      const out = [Math.cos(a), 0, Math.sin(a)];
      const p = add(onStem, mul(out, rad * range(rng, 0.1, 0.4)));
      const d = [out[0] * 0.9, range(rng, 0.25, 0.6), out[2] * 0.9];
      const size = range(rng, spec.size[0], spec.size[1]) * (1 - 0.25 * f);
      clusters.push(makeCluster(p, d, size, TEX.ivy, "holly", clamp01(0.15 + 0.5 * f + 0.25 * dot(out, SUN) + range(rng, -0.1, 0.15)), spec.sway, 1.2));
    }
  }
  return { stems, clusters };
}

// ----------------------------------------------------------------------------------------------
// SNAG: a dead leaning pole with a vine
// spec: { top, offset, seed, r0, stubs, vine: "honey" | "bramble", turns, drapes, size: [min, max], sway }
// ----------------------------------------------------------------------------------------------
function growSnag(spec) {
  const rng = createRng(spec.seed);
  const [tx, ty, tz] = spec.top;
  const bx = tx - spec.offset[0];
  const bz = tz - spec.offset[1];
  const y0 = groundHeight(bx, bz);
  const H = Math.max(3, ty - y0);
  const N = 6;
  const pts = [];
  const ph = range(rng, 0, TAU);
  const side = norm([-spec.offset[1], 0, spec.offset[0]]);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = 0.07 * Math.sin(t * Math.PI * 1.5 + ph);
    pts.push([bx + spec.offset[0] * t + side[0] * w, y0 - 0.05 + (H + 0.05) * t, bz + spec.offset[1] * t + side[2] * w]);
  }
  const radii = taper(pts.length, spec.r0, 0.022, 1.0);
  const stems = [{ pts, radii, bark: "dead" }];
  const clusters = [];
  const honey = spec.vine === "honey";
  const hue = honey ? "honey" : "bramble";
  const tex = honey ? TEX.beech : TEX.sprig;
  const vineBark = honey ? "honey" : "bramble";

  // Broken stubs: short dead side branches, which the vine hangs from.
  const stubTips = [];
  let az = range(rng, 0, TAU);
  for (let k = 0; k < spec.stubs; k++) {
    const t = 0.32 + (0.5 * (k + range(rng, 0, 0.8))) / spec.stubs;
    az += GOLDEN + range(rng, -0.4, 0.4);
    const { p } = along(pts, t);
    const elev = range(rng, 35, 62) * DEG;
    const l = range(rng, 0.3, 0.75);
    const tip = add(p, [Math.cos(elev) * Math.cos(az) * l, Math.sin(elev) * l, Math.cos(elev) * Math.sin(az) * l]);
    const r = Math.max(0.014, radii[Math.round(t * (radii.length - 1))] * 0.45);
    stems.push({ pts: [p, lerp3(p, tip, 0.5), tip], radii: [r, r * 0.8, r * 0.55], bark: "dead" });
    stubTips.push({ p: tip, az });
  }

  // The vine winds up the pole: a helix whose axis is the pole (the pole is nearly vertical).
  const turns = spec.turns;
  const nHelix = Math.max(6, Math.round(turns * 5));
  const helix = [];
  const a0 = range(rng, 0, TAU);
  const t0 = 0.05;
  const t1 = 0.86;
  for (let i = 0; i <= nHelix; i++) {
    const u = i / nHelix;
    const t = t0 + (t1 - t0) * u;
    const { p } = along(pts, t);
    const rr = radii[Math.round(t * (radii.length - 1))] + 0.022 + (honey ? 0.012 : 0.03) * Math.sin(u * 9);
    const a = a0 + u * turns * TAU;
    helix.push([p[0] + Math.cos(a) * rr, p[1], p[2] + Math.sin(a) * rr]);
  }
  const vr = honey ? 0.0075 : 0.011;
  stems.push({ pts: helix, radii: helix.map((_, i) => vr * (1 - 0.35 * (i / helix.length))), bark: vineBark });
  // Leaf pairs along the helix, pointing away from the pole.
  for (let i = 1; i < helix.length; i += 2) {
    const p = helix[i];
    const { p: ax } = along(pts, t0 + ((t1 - t0) * i) / helix.length);
    const out = norm([p[0] - ax[0], 0, p[2] - ax[2]]);
    for (const sgn of [1, -1]) {
      const sd = [-out[2] * sgn * 0.5, 0, out[0] * sgn * 0.5];
      const d = norm(add(add(mul(out, 0.8), sd), [0, range(rng, -0.1, 0.45), 0]));
      const size = range(rng, spec.size[0], spec.size[1]) * (sgn > 0 ? 1 : 0.8);
      clusters.push(makeCluster(p, d, size, tex, hue, litValue(out, clamp01((p[1] - y0) / H), range(rng, -0.2, 0.2)), spec.sway));
    }
  }
  // Drapes: loops of vine that arch out from a stub (or the pole top) and hang, strung with leaves.
  const anchors = stubTips.length ? stubTips : [{ p: along(pts, 0.9).p, az }];
  for (let k = 0; k < spec.drapes; k++) {
    const an = anchors[k % anchors.length];
    const a = an.az + range(rng, -0.6, 0.6);
    const out = [Math.cos(a), 0, Math.sin(a)];
    const reach = range(rng, 0.7, 1.3);
    const fall = range(rng, 0.7, 1.5);
    const end = add(an.p, add(mul(out, reach), [0, -fall, 0]));
    const ctrl = add(an.p, add(mul(out, reach * 0.6), [0, 0.3, 0]));
    const dpts = bezier2(an.p, ctrl, end, 5);
    stems.push({ pts: dpts, radii: dpts.map((_, i) => vr * (1 - 0.4 * (i / dpts.length))), bark: vineBark });
    const nl = 3 + Math.floor(rng() * 3);
    for (let m = 0; m < nl; m++) {
      const u = 0.2 + (0.8 * (m + range(rng, 0, 0.7))) / nl;
      const { p } = along(dpts, u);
      const d = norm([out[0] * range(rng, 0.1, 0.6) + range(rng, -0.3, 0.3), -range(rng, 0.5, 1.0), out[2] * range(rng, 0.1, 0.6) + range(rng, -0.3, 0.3)]);
      const size = range(rng, spec.size[0], spec.size[1]) * 0.9;
      clusters.push(makeCluster(p, d, size, tex, hue, clamp01(0.35 + 0.35 * (1 - u) + range(rng, -0.2, 0.25)), spec.sway));
    }
  }
  return { stems, clusters };
}

// Dispatch on spec.kind. Returns { stems, clusters } with the spec attached as `spec`.
export function growPlant(spec) {
  let plant;
  switch (spec.kind) {
    case "hazel":
      plant = growHazel(spec);
      break;
    case "sapling":
      plant = growSapling(spec);
      break;
    case "holly":
      plant = growHolly(spec);
      break;
    case "snag":
      plant = growSnag(spec);
      break;
    default:
      throw new Error(`glimpsePlants: unknown kind ${spec.kind}`);
  }
  plant.spec = spec;
  return plant;
}

// ----- evaluator primitives ---------------------------------------------------------------------------
// Appends the plant's leaf clusters to `spheres` (flat [x, y, z, r, rho]) and its wood to `capsules`
// (flat [ax, ay, az, bx, by, bz, r]), the layout glimpseVisibility.js expects. Returns the two arrays.
export function plantPrimitives(plant, spheres = [], capsules = []) {
  for (const c of plant.clusters) {
    const r = c.size * CLUSTER_RADIUS;
    spheres.push(c.p[0] + c.d[0] * c.size * 0.5, c.p[1] + c.d[1] * c.size * 0.5, c.p[2] + c.d[2] * c.size * 0.5, r, c.rho);
  }
  for (const s of plant.stems) {
    for (let i = 0; i < s.pts.length - 1; i++) {
      const a = s.pts[i];
      const b = s.pts[i + 1];
      const r = Math.max(WOOD_MIN_RADIUS, 0.5 * (s.radii[i] + s.radii[i + 1]));
      capsules.push(a[0], a[1], a[2], b[0], b[1], b[2], r);
    }
  }
  return { spheres, capsules };
}

// Triangle cost helpers (kept next to the generator so the solver can count without THREE).
export function woodTriangles(plant, radialFor) {
  let t = 0;
  for (const s of plant.stems) {
    const radial = radialFor(s.radii[0]);
    t += (s.pts.length - 1) * radial * 2;
  }
  return t;
}
