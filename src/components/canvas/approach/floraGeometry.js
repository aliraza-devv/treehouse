// Geometry for the understorey flora: fern clusters, plant cards, mushrooms and bracket fungus.
// Pure three.js geometry (no canvas), seeded, so it can be unit tested and is identical on every load.
//
// Conventions
//   * Every cluster is authored at scale 1 with its base at the origin and +Y up. Instancing scales,
//     leans and yaws it.
//   * Foliage UV: u across the card, v from 0 at the BASE to 1 at the TIP. FOLIAGE_WIND (foliageMaterial)
//     flexes by v squared, so tips sway more than bases.
//   * Normals are the card normal blended toward world up (UP_BLEND), so a clump of cards shades like a
//     soft tuft instead of a pile of flat plates. Pair with makeFoliageMaterial (both faces same normal).

import * as THREE from "three";
import { createRng, range } from "@/lib/random";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------
// GeoBuilder: tiny indexed-geometry accumulator (positions, normals, uvs, optional colours)
// ------------------------------------------------------------------------------------------------
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.coloured = false;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  get triangles() {
    return this.idx.length / 3;
  }

  vertex(px, py, pz, nx, ny, nz, u, v, r = 1, g = 1, b = 1) {
    this.pos.push(px, py, pz);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(r, g, b);
    if (r !== 1 || g !== 1 || b !== 1) this.coloured = true;
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  // Quad given in ring order (a, b, c, d).
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  // Append another builder's content (already in the same space).
  append(other) {
    const base = this.vertexCount;
    for (let i = 0; i < other.pos.length; i++) this.pos.push(other.pos[i]);
    for (let i = 0; i < other.nor.length; i++) this.nor.push(other.nor[i]);
    for (let i = 0; i < other.uv.length; i++) this.uv.push(other.uv[i]);
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
    this.coloured = this.coloured || other.coloured;
  }

  build({ colours = this.coloured } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (colours) g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx.length / 3 > 0 && this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Measures what the placement code needs from a built cluster: how far the fronds reach sideways
// and how tall it is (both at scale 1).
export function measure(geometry) {
  const p = geometry.attributes.position;
  let reach = 0;
  let height = 0;
  for (let i = 0; i < p.count; i++) {
    reach = Math.max(reach, Math.hypot(p.getX(i), p.getZ(i)));
    height = Math.max(height, p.getY(i));
  }
  return { reach, height };
}

export function triangleCount(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

// ------------------------------------------------------------------------------------------------
// Frond ribbons
// ------------------------------------------------------------------------------------------------
// A frond is a ribbon that follows an arching space curve. The curve lives in a vertical plane at
// azimuth `az` (radians from +X toward +Z). Its elevation angle above the horizontal falls from
// `elev0` by `bend` radians following   bend * clamp((t - hold) / (1 - hold), 0, 1) ^ power
// (t = fraction of the length), so `hold` keeps a stalk straight before the blade bends over.
// The blade is flat across (width direction horizontal and perpendicular to the plane), rolled about
// the curve by roll0 + twist * t, which turns each frond's face a little differently.
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _k = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function curveSamples(f) {
  const M = 28;
  const P = [];
  const T = [];
  let x = 0;
  let y = 0;
  let z = 0;
  const ca = Math.cos(f.az);
  const sa = Math.sin(f.az);
  const dl = f.L / M;
  const elevAt = (t) => f.elev0 - f.bend * Math.pow(Math.max(0, Math.min(1, (t - f.hold) / (1 - f.hold))), f.power);
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    const e = elevAt(t);
    T.push([Math.cos(e) * ca, Math.sin(e), Math.cos(e) * sa]);
    P.push([x, y, z]);
    // midpoint step so the integration error stays below a millimetre
    const em = elevAt(Math.min(1, t + 0.5 / M));
    x += Math.cos(em) * ca * dl;
    y += Math.sin(em) * dl;
    z += Math.cos(em) * sa * dl;
  }
  const at = (t) => {
    const f0 = Math.max(0, Math.min(1, t)) * M;
    const k = Math.min(M - 1, Math.floor(f0));
    const a = f0 - k;
    return {
      p: [P[k][0] + (P[k + 1][0] - P[k][0]) * a, P[k][1] + (P[k + 1][1] - P[k][1]) * a, P[k][2] + (P[k + 1][2] - P[k][2]) * a],
      t: [T[k][0] + (T[k + 1][0] - T[k][0]) * a, T[k][1] + (T[k + 1][1] - T[k][1]) * a, T[k][2] + (T[k + 1][2] - T[k][2]) * a],
    };
  };
  return at;
}

// f: { az, elev0, bend, hold, power, L, W, roll0, twist, ts[], u0, u1, origin[3], upBlend }
export function addFrond(b, f) {
  const at = curveSamples(f);
  const rows = [];
  const sa = Math.sin(f.az);
  const ca = Math.cos(f.az);
  for (const t of f.ts) {
    const s = at(t);
    _t.set(s.t[0], s.t[1], s.t[2]).normalize();
    _w.set(-sa, 0, ca); // horizontal, perpendicular to the curve's plane (so also perpendicular to _t)
    const roll = f.roll0 + f.twist * t;
    // Rodrigues rotation of the width vector about the tangent (w is already perpendicular to it)
    _k.copy(_t).cross(_w);
    _w.multiplyScalar(Math.cos(roll)).addScaledVector(_k, Math.sin(roll));
    _n.copy(_w).cross(_t).normalize(); // face normal: the upper side of an arching frond
    _n.multiplyScalar(1 - f.upBlend).addScaledVector(_up, f.upBlend).normalize();
    const px = s.p[0] + f.origin[0];
    const py = s.p[1] + f.origin[1];
    const pz = s.p[2] + f.origin[2];
    const hw = f.W / 2;
    const l = b.vertex(px - _w.x * hw, py - _w.y * hw, pz - _w.z * hw, _n.x, _n.y, _n.z, f.u0, t);
    const r = b.vertex(px + _w.x * hw, py + _w.y * hw, pz + _w.z * hw, _n.x, _n.y, _n.z, f.u1, t);
    rows.push([l, r]);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const [l0, r0] = rows[i];
    const [l1, r1] = rows[i + 1];
    b.quad(l0, r0, r1, l1);
  }
}

// ------------------------------------------------------------------------------------------------
// Fern species recipes. Each returns a merged cluster geometry plus its measured reach and height.
// Texture layouts (floraTextures): male fern atlas has 2 cells (fronds), hart's tongue 2 cells
// (sterile, fertile), bracken 2 cells.
// ------------------------------------------------------------------------------------------------
function cellUV(cell, cells, pad = 0.004) {
  return [cell / cells + pad, (cell + 1) / cells - pad];
}

function finishCluster(b, name) {
  const geometry = b.build({ colours: false });
  geometry.name = name;
  return { geometry, ...measure(geometry), triangles: b.triangles };
}

// (a) Male fern, the shuttlecock: 6 to 8 tall fronds rising from a crown, the older outer ones
// arching over. Frond card aspect matches the painted frond (192 x 512 per cell).
export function buildMaleFern(seed) {
  const rng = createRng(seed * 977 + 13);
  const b = new GeoBuilder();
  const n = 6 + Math.floor(rng() * 3);
  const az0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const outer = Math.pow(rng(), 0.8); // 0 = young upright, 1 = old arching
    const L = range(rng, 0.58, 0.86) * (1 - 0.1 * outer);
    const jitter = range(rng, -0.4, 0.4);
    const r0 = range(rng, 0.0, 0.05);
    const az = az0 + (i / n) * TAU + jitter;
    const longFrond = L > 0.68;
    const [u0, u1] = cellUV(Math.floor(rng() * 2), 2);
    addFrond(b, {
      az,
      elev0: (range(rng, 74, 84) - 24 * outer) * DEG,
      bend: (range(rng, 30, 48) + 44 * outer) * DEG,
      hold: 0.12,
      power: 1.25,
      L,
      W: L * (192 / 512) * range(rng, 0.9, 1.08),
      roll0: range(rng, -0.35, 0.35),
      twist: range(rng, -0.7, 0.7),
      ts: longFrond ? [0, 0.28, 0.56, 0.8, 1] : [0, 0.4, 0.74, 1],
      u0,
      u1,
      origin: [Math.cos(az) * r0, 0, Math.sin(az) * r0],
      upBlend: 0.5,
    });
  }
  return finishCluster(b, "maleFern");
}

// (b) Hart's tongue: a low rosette of 7 to 9 strap shaped, undivided fronds that arch outward and
// curl, glossy and leathery. Aspect of the painted strap is 64 x 512 per cell (widened 25 percent).
export function buildHartsTongue(seed) {
  const rng = createRng(seed * 1319 + 29);
  const b = new GeoBuilder();
  const n = 7 + Math.floor(rng() * 3);
  const az0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const L = range(rng, 0.24, 0.46);
    const az = az0 + (i / n) * TAU + range(rng, -0.45, 0.45);
    const cell = rng() < 0.4 ? 1 : 0; // 1 = fertile (sori lines)
    const [u0, u1] = cellUV(cell, 2);
    const r0 = range(rng, 0.0, 0.04);
    addFrond(b, {
      az,
      elev0: range(rng, 38, 66) * DEG,
      bend: range(rng, 42, 86) * DEG,
      hold: 0.05,
      power: 1.05,
      L,
      W: L * (64 / 512) * 1.25,
      roll0: range(rng, -0.7, 0.7),
      twist: range(rng, -0.9, 0.9),
      ts: [0, 0.34, 0.68, 1],
      u0,
      u1,
      origin: [Math.cos(az) * r0, 0, Math.sin(az) * r0],
      upBlend: 0.45,
    });
  }
  return finishCluster(b, "hartsTongue");
}

// (c) Bracken / broad buckler: 3 to 4 large triangular compound fronds on tall stalks. The stalk
// stays upright (hold 0.34) then the blade bends over and spreads, tilted about 20 to 40 degrees
// off horizontal. Painted frond is 288 x 512 per cell, stalk in the lower 42 percent.
export function buildBracken(seed) {
  const rng = createRng(seed * 2113 + 71);
  const b = new GeoBuilder();
  const n = 3 + Math.floor(rng() * 2);
  const az0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const L = range(rng, 0.9, 1.15);
    const az = az0 + (i / n) * TAU + range(rng, -0.5, 0.5);
    const cell = Math.floor(rng() * 2);
    const [u0, u1] = cellUV(cell, 2);
    const r0 = range(rng, 0.02, 0.1);
    addFrond(b, {
      az,
      elev0: range(rng, 78, 86) * DEG,
      bend: range(rng, 56, 76) * DEG,
      hold: 0.34,
      power: 1.1,
      L,
      W: L * (288 / 512) * range(rng, 0.92, 1.05),
      roll0: range(rng, -0.28, 0.28),
      twist: range(rng, -0.4, 0.4),
      ts: [0, 0.3, 0.46, 0.62, 0.8, 1],
      u0,
      u1,
      origin: [Math.cos(az) * r0, 0, Math.sin(az) * r0],
      upBlend: 0.4,
    });
  }
  return finishCluster(b, "bracken");
}

// ------------------------------------------------------------------------------------------------
// Upright and flat plant cards (ground cover)
// ------------------------------------------------------------------------------------------------
// `tuft`: `cards` crossed cards standing on the ground, base at the origin. Each card arches forward
// by `bend` (fraction of its height), `segV` segments tall. Normals lean toward up by `upBlend`.
export function buildTuft({ cards = 3, w = 0.3, h = 0.4, segV = 1, bend = 0.2, upBlend = 0.55, seed = 1, spread = 0 }) {
  const rng = createRng(seed * 4421 + 5);
  const b = new GeoBuilder();
  const yaw0 = rng() * TAU;
  for (let c = 0; c < cards; c++) {
    const yaw = yaw0 + (c * Math.PI) / cards + range(rng, -0.25, 0.25);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const lean = range(rng, -0.1, 0.1) + spread;
    const ox = range(rng, -0.03, 0.03);
    const oz = range(rng, -0.03, 0.03);
    const rows = [];
    for (let j = 0; j <= segV; j++) {
      const t = j / segV;
      // forward bow (z in card space) and the matching slope for the normal
      const z = bend * h * t * t + lean * h * t;
      const dz = 2 * bend * t + lean; // dz / dy
      const y = t * h;
      // card normal in card space is (0, -dz, 1) normalised
      const nl = Math.hypot(dz, 1);
      let nx = 0;
      let ny = -dz / nl;
      let nz = 1 / nl;
      // blend toward world up (card space y is up)
      ny = ny * (1 - upBlend) + upBlend;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il;
      ny *= il;
      nz *= il;
      const hw = w / 2;
      // card space x right, z forward; rotate by yaw about Y
      const mk = (x) => [ox + x * cy + z * sy, y, oz - x * sy + z * cy];
      const a = mk(-hw);
      const bpos = mk(hw);
      const nrm = [nx * cy + nz * sy, ny, -nx * sy + nz * cy];
      const l = b.vertex(a[0], a[1], a[2], nrm[0], nrm[1], nrm[2], 0, t);
      const r = b.vertex(bpos[0], bpos[1], bpos[2], nrm[0], nrm[1], nrm[2], 1, t);
      rows.push([l, r]);
    }
    for (let j = 0; j < segV; j++) b.quad(rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]);
  }
  const geometry = b.build({ colours: false });
  return { geometry, triangles: b.triangles, ...measure(geometry) };
}

// `flatCard`: a card lying on the ground in the XZ plane (normal +Y), centred on the origin, running
// `l` long along -Z (v 0 at +Z end ... v 1 at -Z end) and `w` wide. `segV` rows; `arch` lifts the middle
// of the long axis a little (ivy runners and bramble lie over uneven ground). uv sub rectangle optional.
export function buildFlatCard({ w = 0.3, l = 0.5, segV = 1, arch = 0, uv = [0, 0, 1, 1], pivot = "centre", upBlend = 0.8 }) {
  const b = new GeoBuilder();
  const rows = [];
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;
    const z = pivot === "base" ? -t * l : (0.5 - t) * l;
    const y = arch * Math.sin(Math.PI * t);
    const slope = arch * Math.PI * Math.cos(Math.PI * t) / l;
    const nl = Math.hypot(slope, 1);
    // tilt of the normal along z, blended to up
    const nz0 = slope / nl;
    let ny = 1 / nl;
    let nz = nz0 * (1 - upBlend);
    const il = 1 / Math.hypot(ny, nz);
    ny *= il;
    nz *= il;
    const l0 = b.vertex(-w / 2, y, z, 0, ny, nz, uv[0], uv[1] + (uv[3] - uv[1]) * t);
    const r0 = b.vertex(w / 2, y, z, 0, ny, nz, uv[2], uv[1] + (uv[3] - uv[1]) * t);
    rows.push([l0, r0]);
  }
  for (let j = 0; j < segV; j++) b.quad(rows[j][0], rows[j + 1][0], rows[j + 1][1], rows[j][1]);
  const geometry = b.build({ colours: false });
  return { geometry, triangles: b.triangles };
}

// A card that stands up from the ground and then arches over (bramble cane, drooping sedge): like a
// tuft with one card but `segV` tall and a strong forward bend that ends nearly horizontal.
export function buildArch({ w = 0.4, h = 0.6, segV = 4, bendDeg = 80, seed = 1 }) {
  const rng = createRng(seed * 811 + 3);
  const b = new GeoBuilder();
  const rows = [];
  let y = 0;
  let z = 0;
  const dl = h / segV;
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;
    const ang = (86 - bendDeg * Math.pow(t, 1.3)) * DEG; // elevation along the cane
    const nx = 0;
    // face normal: perpendicular to the tangent (cos a along z, sin a along y) in the (y, z) plane,
    // pointing up at the tip, then blended toward world up so the whole cane shades as one soft form
    const upBlend = 0.45;
    let fy = Math.cos(ang) * (1 - upBlend) + upBlend;
    let fz = -Math.sin(ang) * (1 - upBlend);
    const fl = 1 / Math.hypot(fy, fz);
    fy *= fl;
    fz *= fl;
    const jx = range(rng, -0.01, 0.01);
    const l0 = b.vertex(-w / 2 + jx, y, z, nx, fy, fz, 0, t);
    const r0 = b.vertex(w / 2 + jx, y, z, nx, fy, fz, 1, t);
    rows.push([l0, r0]);
    y += Math.sin(ang) * dl;
    z += Math.cos(ang) * dl;
  }
  for (let j = 0; j < segV; j++) b.quad(rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]);
  const geometry = b.build({ colours: false });
  return { geometry, triangles: b.triangles, ...measure(geometry) };
}

// A small tuft that sits ON a curved surface (moss on a log): a card 2 segments across (so it cups
// around the trunk) and 1 along, centred at the origin, normal +Y, long axis along X.
export function buildCupCard({ w = 0.3, l = 0.3, cup = 0.04, uv = [0, 0, 1, 1] }) {
  const b = new GeoBuilder();
  const rows = [];
  for (let i = 0; i <= 2; i++) {
    const s = i / 2;
    const x = (s - 0.5) * w;
    const y = -cup * (1 - Math.pow(2 * s - 1, 2)) * -1; // 0 at the edges, `cup` in the middle: a low dome
    const slope = (-2 * cup * (2 * s - 1) * 2) / w;
    const nl = Math.hypot(slope, 1);
    const a = b.vertex(x, y, l / 2, slope / nl, 1 / nl, 0, uv[0] + (uv[2] - uv[0]) * s, uv[1]);
    const c = b.vertex(x, y, -l / 2, slope / nl, 1 / nl, 0, uv[0] + (uv[2] - uv[0]) * s, uv[3]);
    rows.push([a, c]);
  }
  for (let i = 0; i < 2; i++) b.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
  const geometry = b.build({ colours: false });
  return { geometry, triangles: b.triangles };
}

// ------------------------------------------------------------------------------------------------
// Mushrooms: lathe geometry (cap radius 1, stem base at y 0), 8 radial segments.
// Texture atlas rows (v): gills 0.01 to 0.21, stem 0.23 to 0.49, cap top 0.51 to 0.99.
// ------------------------------------------------------------------------------------------------
const V_GILL = [0.01, 0.21];
const V_STEM = [0.23, 0.49];
const V_CAP = [0.51, 0.99];

// Each kind: stem (height, radius at base, radius at top), cap top rings from the apex out to the rim
// as [r, y] (y measured from the stem base), and the underside centre height.
const MUSHROOM_KINDS = {
  // young, domed button cap on a tall stem
  bun: { stemH: 1.9, stemR0: 0.27, stemR1: 0.2, cap: [[0, 2.62], [0.62, 2.5], [1.0, 2.02]], under: 1.96 },
  // mature honey fungus cap: flat with a low umbo and a slightly drooping rim
  open: { stemH: 1.5, stemR0: 0.19, stemR1: 0.13, cap: [[0, 1.92], [0.55, 1.88], [1.0, 1.56]], under: 1.5 },
  // large funnel shaped cap, centre lower than the up-turned rim, stout stem
  funnel: { stemH: 1.2, stemR0: 0.34, stemR1: 0.25, cap: [[0, 1.22], [0.5, 1.3], [1.0, 1.46]], under: 1.24 },
};
export const MUSHROOM_KIND_NAMES = Object.keys(MUSHROOM_KINDS);

// Outward normal (nr, ny) of a lathe profile segment (r0, y0) -> (r1, y1). dir = 1 for a profile walked
// from the bottom up (a stem), -1 for one walked from the centre out (a cap top, normal faces up).
function profileNormal(r0, y0, r1, y1, dir = 1) {
  const dr = r1 - r0;
  const dy = y1 - y0;
  const l = Math.hypot(dr, dy) || 1;
  return [(dir * dy) / l, (-dir * dr) / l];
}

export function buildMushroom(kind = "open", radial = 8) {
  const k = MUSHROOM_KINDS[kind];
  const b = new GeoBuilder();
  const ringVerts = (r, y, nr, ny, v) => {
    const out = [];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      out.push(b.vertex(ca * r, y, sa * r, ca * nr, ny, sa * nr, i / radial, v));
    }
    return out;
  };
  const strip = (ra, rb) => {
    for (let i = 0; i < radial; i++) b.quad(ra[i], ra[i + 1], rb[i + 1], rb[i]);
  };
  // stem: bottom ring to top ring, normals follow the taper
  {
    const [nr, ny] = profileNormal(k.stemR0, 0, k.stemR1, k.stemH);
    strip(ringVerts(k.stemR0, 0, nr, ny, V_STEM[0]), ringVerts(k.stemR1, k.stemH, nr, ny, V_STEM[1]));
  }
  // cap top: apex fan, then one band per remaining ring. Smooth normals from the profile.
  const cap = k.cap;
  const nApex = [0, 1];
  const n1 = profileNormal(cap[0][0], cap[0][1], cap[1][0], cap[1][1], -1);
  const n2 = profileNormal(cap[1][0], cap[1][1], cap[2][0], cap[2][1], -1);
  // v along the cap top: apex at the high end, rim at the low end
  const vApex = V_CAP[1];
  const vMid = V_CAP[0] + (V_CAP[1] - V_CAP[0]) * 0.55;
  const vRim = V_CAP[0];
  const mid = ringVerts(cap[1][0], cap[1][1], (n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2, vMid);
  const rim = ringVerts(cap[2][0], cap[2][1], n2[0] * 0.9 + 0.1, n2[1] * 0.9, vRim);
  for (let i = 0; i < radial; i++) {
    const apex = b.vertex(0, cap[0][1], 0, 0, 1, 0, (i + 0.5) / radial, vApex);
    b.tri(apex, mid[i + 1], mid[i]);
  }
  strip(mid, rim);
  // underside: rim (facing down) to the centre of the gills, a fan
  {
    const under = [];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * TAU;
      under.push(b.vertex(Math.cos(a) * cap[2][0], cap[2][1] - 0.02, Math.sin(a) * cap[2][0], 0, -1, 0, i / radial, V_GILL[0]));
    }
    for (let i = 0; i < radial; i++) {
      const c = b.vertex(0, k.under, 0, 0, -1, 0, (i + 0.5) / radial, V_GILL[1]);
      b.tri(c, under[i], under[i + 1]);
    }
  }
  const geometry = b.build({ colours: false });
  geometry.name = `mushroom-${kind}`;
  return { geometry, triangles: b.triangles, kind };
}

// Bracket fungus shelf: a half disc (cap radius 1) growing out of a trunk. Local +Z points away from
// the trunk, +Y is the top of the shelf. 6 radial segments over 180 degrees.
export function buildShelf() {
  const b = new GeoBuilder();
  const seg = 6;
  const profile = [[0, 0.26], [0.55, 0.22], [1.0, 0.0]];
  const ring = (r, y, nr, ny, v) => {
    const out = [];
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 + (i / seg) * Math.PI; // from -90 to +90 degrees around +Z
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      out.push(b.vertex(sx * r, y, cz * r, sx * nr, ny, cz * nr, i / seg, v));
    }
    return out;
  };
  const n1 = profileNormal(profile[0][0], profile[0][1], profile[1][0], profile[1][1], -1);
  const n2 = profileNormal(profile[1][0], profile[1][1], profile[2][0], profile[2][1], -1);
  const mid = ring(profile[1][0], profile[1][1], (n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2, 0.75);
  const rim = ring(profile[2][0], profile[2][1], n2[0], n2[1], 0.52);
  for (let i = 0; i < seg; i++) {
    const apex = b.vertex(0, profile[0][1], 0, 0, 1, 0, (i + 0.5) / seg, 0.99);
    b.tri(apex, mid[i + 1], mid[i]);
  }
  for (let i = 0; i < seg; i++) b.quad(mid[i], mid[i + 1], rim[i + 1], rim[i]);
  // underside: pale pored surface
  const under = [];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI;
    under.push(b.vertex(Math.sin(a), -0.01, Math.cos(a), 0, -1, 0, i / seg, 0.1));
  }
  for (let i = 0; i < seg; i++) {
    const c = b.vertex(0, -0.01, 0, 0, -1, 0, (i + 0.5) / seg, 0.18);
    b.tri(c, under[i], under[i + 1]);
  }
  // flat back against the trunk
  const back = b.vertex(0, 0.26, 0, 0, 0, -1, 0.5, 0.5);
  const bl = b.vertex(-1, 0, 0, 0, 0, -1, 0, 0.5);
  const br = b.vertex(1, 0, 0, 0, 0, -1, 1, 0.5);
  b.tri(back, bl, br);
  const geometry = b.build({ colours: false });
  geometry.name = "shelf";
  return { geometry, triangles: b.triangles };
}

// A cheap lumpy blob (earth clump, soil lump): a 12 triangle octahedron-ish shape pushed around by
// the rng so no two are the same. Origin at the base, radius about `r`.
export function buildClump(seed, r = 0.1) {
  const rng = createRng(seed * 331 + 9);
  const b = new GeoBuilder();
  const ring = 5;
  const top = b.vertex(0, r * range(rng, 0.7, 1.0), 0, 0, 1, 0, 0.5, 1);
  const mid = [];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * TAU + range(rng, -0.25, 0.25);
    const rr = r * range(rng, 0.8, 1.2);
    const y = r * range(rng, 0.25, 0.45);
    mid.push(b.vertex(Math.cos(a) * rr, y, Math.sin(a) * rr, Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8, i / ring, 0.5));
  }
  const bot = [];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * TAU + range(rng, -0.25, 0.25);
    const rr = r * range(rng, 0.7, 1.1);
    bot.push(b.vertex(Math.cos(a) * rr, -0.02, Math.sin(a) * rr, Math.cos(a), 0, Math.sin(a), i / ring, 0));
  }
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring;
    b.tri(top, mid[j], mid[i]);
    b.quad(mid[i], mid[j], bot[j], bot[i]);
  }
  const geometry = b.build({ colours: false });
  return { geometry, triangles: b.triangles };
}
