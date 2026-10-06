// ===========================================================================================
// TREEHOUSE GLIMPSE: line of sight evaluator (pure JavaScript, no imports, runs in node).
//
// Question it answers: from the walker's eye, how much of the cabin silhouette can be seen through
// the foliage, the extra trunks and the hero crown?
//
//   1. The cabin silhouette is sampled with about 40 points on a plane through the cabin centre
//      that faces the eye (a house shape: a wall block with a gable roof, 3.6 m wide, 3.2 m tall).
//   2. One ray is cast from the eye to every sample point.
//   3. Every occluder adds an OPTICAL DEPTH tau to the ray. Transmittance is T = exp(-sum tau), and
//      the visible fraction is the mean T over the samples (T = 1 clear, 0 blocked).
//        leaf cluster  a sphere with density rho (per metre of chord). A ray through the middle of a
//                      cluster of three crossed alpha cut cards crosses about three leaf layers, a
//                      grazing ray about one, which rho = 2.4 per metre of chord reproduces
//                      (T about 0.12 through the centre of a 0.9 m cluster, about 0.55 near its rim).
//        wood          a capsule (branch, stem, trunk) that is opaque inside its own radius with a
//                      soft rim. Thin stems are given a minimum visual radius, because depth of field
//                      and the 40 sample spacing make a 1 cm twig read as about 3 cm.
//        hero crown    a soft sphere (see HERO_CROWN) with a low density, applied only along the part
//                      of the ray before it reaches the sample.
//   Soft T (instead of a hard hit or miss) keeps the objective smooth for the offline optimiser and is
//   the area average of what the real alpha cut cards would let through.
//
// Layout of the primitive arrays (flat Float64Array, so the optimiser can reuse them):
//   spheres   [x, y, z, radius, rho] per sphere
//   capsules  [ax, ay, az, bx, by, bz, radius] per capsule
// ===========================================================================================

export const BIG_TAU = 8; // optical depth of a ray that goes through solid wood (T = 0.0003)

// The silhouette of the cabin as seen by the walker: width x height of the bounding box (metres) and
// the spacing of the sample grid. The grid is staggered every other row, and clipped to a house
// outline (wall block below, gable roof above), which leaves about 40 points.
export const SILHOUETTE = {
  width: 3.6,
  height: 3.2,
  spacing: 0.47,
  wallFraction: 0.58, // the wall block (and deck edge) is this fraction of the height, the rest is the roof
};

// The hero crown, from the brief: a soft sphere of radius 5 m around (TREE.x, 14.5, 0). It is only a
// guess (the real canopy leaves the cabin envelope clear), so it is thin: a 3 m chord lets 0.5 through.
export const HERO_CROWN = { radius: 5, rho: 0.22 };

// Sample points for a ray bundle from `eye` toward `centre`. Returns a Float64Array of 3 * N.
// The plane is perpendicular to the view direction; its "up" is the projection of world up, so the
// silhouette keeps the cabin's vertical axis vertical on screen.
export function buildSilhouetteSamples(eye, centre, opts = SILHOUETTE) {
  const dx = centre[0] - eye[0];
  const dy = centre[1] - eye[1];
  const dz = centre[2] - eye[2];
  const len = Math.hypot(dx, dy, dz);
  const fx = dx / len;
  const fy = dy / len;
  const fz = dz / len;
  // right = forward x up (up = +Y), normalised; screen up = right x forward
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const out = [];
  const half = opts.width / 2;
  const hh = opts.height / 2;
  const wallTop = -hh + opts.height * opts.wallFraction;
  const rows = Math.round(opts.height / opts.spacing);
  for (let j = 0; j < rows; j++) {
    const v = -hh + (j + 0.5) * (opts.height / rows);
    // house outline: full width up to the eaves, then a gable narrowing to the ridge
    const w = v <= wallTop ? half : half * Math.max(0, 1 - (v - wallTop) / (hh - wallTop));
    const stagger = (j % 2) * 0.5;
    const cols = Math.max(1, Math.round((2 * w) / opts.spacing));
    for (let i = 0; i < cols; i++) {
      const u = -w + ((i + 0.5 + stagger * 0.0) / cols) * 2 * w;
      out.push(centre[0] + rx * u + ux * v, centre[1] + ry * u + uy * v, centre[2] + rz * u + uz * v);
    }
  }
  return Float64Array.from(out);
}

// Optical depth of one ray (origin o, unit direction d, length len) through one sphere.
export function sphereTau(ox, oy, oz, dx, dy, dz, len, cx, cy, cz, r, rho) {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  const disc = b * b - c;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, -b - sq);
  const t1 = Math.min(len, -b + sq);
  return t1 > t0 ? rho * (t1 - t0) : 0;
}

// Closest distance between the ray segment (o, o + d len) and the segment (a, b) (Ericson, Real-Time
// Collision Detection 5.1.9). Used for wood, which is thin enough to treat as a line with a radius.
function segSegDistance(ox, oy, oz, dx, dy, dz, len, ax, ay, az, bx, by, bz) {
  const d1x = dx * len;
  const d1y = dy * len;
  const d1z = dz * len;
  const d2x = bx - ax;
  const d2y = by - ay;
  const d2z = bz - az;
  const rx = ox - ax;
  const ry = oy - ay;
  const rz = oz - az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s;
  let t;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const denom = a * e - b * b;
  s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  t = (b * s + f) / (e || 1e-12);
  if (t < 0) {
    t = 0;
    s = Math.min(1, Math.max(0, -c / (a || 1e-12)));
  } else if (t > 1) {
    t = 1;
    s = Math.min(1, Math.max(0, (b - c) / (a || 1e-12)));
  }
  const qx = ox + d1x * s - (ax + d2x * t);
  const qy = oy + d1y * s - (ay + d2y * t);
  const qz = oz + d1z * s - (az + d2z * t);
  return Math.hypot(qx, qy, qz);
}

// Optical depth of one ray through one capsule: opaque inside 0.85 r, clear outside 1.15 r.
export function capsuleTau(ox, oy, oz, dx, dy, dz, len, ax, ay, az, bx, by, bz, r) {
  const d = segSegDistance(ox, oy, oz, dx, dy, dz, len, ax, ay, az, bx, by, bz);
  if (d >= 1.15 * r) return 0;
  if (d <= 0.85 * r) return BIG_TAU;
  const k = (1.15 * r - d) / (0.3 * r);
  return BIG_TAU * k * k * (3 - 2 * k);
}

// Total optical depth of one ray through a set of spheres and capsules.
export function rayTau(ox, oy, oz, dx, dy, dz, len, spheres, capsules) {
  let tau = 0;
  if (spheres) {
    for (let i = 0; i < spheres.length; i += 5) {
      tau += sphereTau(ox, oy, oz, dx, dy, dz, len, spheres[i], spheres[i + 1], spheres[i + 2], spheres[i + 3], spheres[i + 4]);
    }
  }
  if (capsules) {
    for (let i = 0; i < capsules.length; i += 7) {
      tau += capsuleTau(ox, oy, oz, dx, dy, dz, len, capsules[i], capsules[i + 1], capsules[i + 2], capsules[i + 3], capsules[i + 4], capsules[i + 5], capsules[i + 6]);
    }
  }
  return tau;
}

// Optical depth of every ray of a bundle (eye -> each sample) through the given primitives. `out`
// (optional, length N) is overwritten. Returns it.
export function bundleTau(eye, samples, spheres, capsules, out) {
  const n = samples.length / 3;
  const res = out || new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const tx = samples[3 * k] - eye[0];
    const ty = samples[3 * k + 1] - eye[1];
    const tz = samples[3 * k + 2] - eye[2];
    const len = Math.hypot(tx, ty, tz);
    res[k] = rayTau(eye[0], eye[1], eye[2], tx / len, ty / len, tz / len, len, spheres, capsules);
  }
  return res;
}

// The hero crown's optical depth along one ray: a soft sphere, counted only up to the sample point.
export function heroCrownTau(eye, samples, crown, out) {
  const n = samples.length / 3;
  const res = out || new Float64Array(n);
  const [cx, cy, cz] = crown.centre;
  for (let k = 0; k < n; k++) {
    const tx = samples[3 * k] - eye[0];
    const ty = samples[3 * k + 1] - eye[1];
    const tz = samples[3 * k + 2] - eye[2];
    const len = Math.hypot(tx, ty, tz);
    res[k] = sphereTau(eye[0], eye[1], eye[2], tx / len, ty / len, tz / len, len, cx, cy, cz, crown.radius, crown.rho);
  }
  return res;
}

// Visible fraction from per-ray optical depths: the mean transmittance.
export function visibleFraction(tau, extra) {
  let sum = 0;
  const n = tau.length;
  for (let k = 0; k < n; k++) sum += Math.exp(-(tau[k] + (extra ? extra[k] : 0)));
  return sum / n;
}
