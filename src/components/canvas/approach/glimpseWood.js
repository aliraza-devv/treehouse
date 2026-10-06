import * as THREE from "three";
import { BARK_TILE, BARK_TONES, radialFor } from "./glimpseTuning";

// ===========================================================================================
// TREEHOUSE GLIMPSE: wood. Sweeps the plants' stems (polylines with radii, see glimpsePlants.js)
// into one tapered, bark textured tube geometry per plant.
//
//   * Rings follow a parallel transport frame, so a tube never twists however the stem curves.
//   * The shared bark texture is seamless in U (one tile per circumference), but a 3 cm twig cannot
//     carry a whole tile round its girth without the fissures turning into noise. So U runs over a
//     fraction of the tile (circumference / BARK_TILE) and is MIRRORED round the tube (a triangle
//     wave), which has no seam: the texture is continuous all the way round for any radius.
//   * Vertex colour carries the per species tone (BARK_TONES), a slow lightness drift along the stem
//     and a damp, greener foot (the lowest half metre sits in leaf litter).
//   * The outward normal tilts forward by the taper slope, so a thinning twig shades like a cone.
// Every random draw is seeded from the plant spec: the wood is identical on every load.
// ===========================================================================================

const TAU = Math.PI * 2;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bi = new THREE.Vector3();

// Radius jitter and shade drift, from a tiny hash so a stem is reproducible without an rng object.
function hash(i, j, seed) {
  const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Appends one stem to the accumulator { pos, nor, uv, col, idx, vertexCount }.
export function addStem(acc, stem, y0, seed) {
  const { pts, radii } = stem;
  const n = pts.length;
  if (n < 2) return;
  const radial = radialFor(radii[0]);
  const tone = BARK_TONES[stem.bark] || BARK_TONES.hazel;
  const rowStride = radial + 1; // the seam vertex is duplicated (its U differs)
  const base = acc.vertexCount;

  // tangents: central differences, one sided at the ends
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    _t.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    tangents.push(_t.clone());
  }
  // parallel transport frame: start from any normal perpendicular to the first tangent
  _n.set(0, 1, 0);
  if (Math.abs(tangents[0].y) > 0.9) _n.set(1, 0, 0);
  _n.addScaledVector(tangents[0], -_n.dot(tangents[0])).normalize();

  let along = 0;
  const uOff = hash(seed, 3, 5) * 8; // each stem samples a different part of the tile
  for (let i = 0; i < n; i++) {
    const tg = tangents[i];
    if (i > 0) {
      _n.addScaledVector(tg, -_n.dot(tg)).normalize();
      along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    }
    _bi.crossVectors(tg, _n);
    const r = Math.max(0.004, radii[i]);
    // taper slope dr/ds across the neighbouring segments
    const iA = Math.max(0, i - 1);
    const iB = Math.min(n - 1, i + 1);
    const segLen = Math.hypot(pts[iB][0] - pts[iA][0], pts[iB][1] - pts[iA][1], pts[iB][2] - pts[iA][2]) || 1;
    const slope = (radii[iB] - radii[iA]) / segLen; // negative: the stem thins toward its tip
    const span = (TAU * r) / BARK_TILE; // fraction of one tile round this ring
    const height = pts[i][1] - y0;
    const damp = Math.max(0, 1 - height / 0.55); // 1 at the ground, 0 above half a metre
    const drift = 0.92 + 0.16 * hash(i, 1, seed);
    for (let k = 0; k <= radial; k++) {
      const ang = (TAU * k) / radial;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const dx = _n.x * c + _bi.x * s;
      const dy = _n.y * c + _bi.y * s;
      const dz = _n.z * c + _bi.z * s;
      // gnarl: a few percent of radius jitter per vertex, so the section is never a perfect polygon
      const rr = r * (1 + 0.07 * (hash(i, k % radial, seed) - 0.5) * 2);
      acc.pos.push(pts[i][0] + dx * rr, pts[i][1] + dy * rr, pts[i][2] + dz * rr);
      _a.set(dx - slope * tg.x, dy - slope * tg.y, dz - slope * tg.z).normalize();
      acc.nor.push(_a.x, _a.y, _a.z);
      const tri = 1 - Math.abs((2 * k) / radial - 1); // 0 at the seam, 1 opposite: mirrored U
      acc.uv.push(uOff + (span / 2) * tri, along / BARK_TILE + uOff * 0.37);
      // damp foot: darker, a little greener. Lightness drifts slowly along the wood.
      const dark = 1 - 0.32 * damp;
      acc.col.push(tone[0] * drift * dark * (1 - 0.06 * damp), tone[1] * drift * dark * (1 + 0.1 * damp), tone[2] * drift * dark * (1 - 0.14 * damp));
    }
  }
  // Winding is checked in node (see the verification notes): rows run along the stem, columns round it.
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = base + i * rowStride + k;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;
      acc.idx.push(a, b, c, b, d, c);
    }
  }
  acc.vertexCount += n * rowStride;
}

export function createWoodAcc() {
  return { pos: [], nor: [], uv: [], col: [], idx: [], vertexCount: 0 };
}

export function woodToGeometry(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
  g.setIndex(acc.idx);
  g.computeBoundingSphere();
  return g;
}
