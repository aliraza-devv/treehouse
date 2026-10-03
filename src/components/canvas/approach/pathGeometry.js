// Geometry builders for the path and the ground around it. Pure three.js BufferGeometry (no canvas,
// no React), so they can be tested in node. Triangle counts are noted on each builder; the whole
// path set is budgeted at about 3.5k triangles drawn at once.

import * as THREE from "three";
import { groundHeight } from "@/lib/sceneConfig";
import { PATH_LENGTH, pathAt } from "@/lib/sections/world";
import { createRng, range } from "@/lib/random";
import { createNoise, clamp, smoothstep } from "@/lib/noise";
import { RIBBON, groundSurface, pathBend, dirtEdge, locate } from "./pathMath";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// THE RIBBON
// A strip that follows pathAt(s), seated on the RENDERED hero ground a few millimetres up (see
// groundSurface). Triangles: along * across * 2 = 768 at the defaults.
//
// The strip is straight-edged on purpose: the dirt shape, its ragged edge and the litter fringe are
// painted (macro map) and cut with alpha, which is what makes the edge look trodden instead of
// ruled. Each vertex carries two uv sets:
//   uv      metric coordinates for the fine tiling texture (pebbles, cracks, pressed leaves)
//   aMacro  (across 0..1, along s 0..1) for the one-off macro maps (dirt, wear, puddles, edges)
// Normals come from the analytic height gradient, the same way the hero floor shades, so the lighting
// continues across the seam.
// ------------------------------------------------------------------------------------------------
export function buildRibbonGeometry() {
  const { along, across, halfWidth, lift, microTile } = RIBBON;
  const nI = along + 1;
  const nJ = across + 1;
  const pos = new Float32Array(nI * nJ * 3);
  const nor = new Float32Array(nI * nJ * 3);
  const uv = new Float32Array(nI * nJ * 2);
  const macro = new Float32Array(nI * nJ * 2);
  const e = 0.6;
  const n = new THREE.Vector3();
  for (let i = 0; i < nI; i++) {
    const s = i / along;
    const p = pathAt(s);
    // Trim the INSIDE of the two tight elbows so cross sections never cross each other (a folded
    // strip would overlap itself). The dirt and the alpha fade are trimmed to the same limit.
    const bend = pathBend(s);
    const lo = -(bend.inner < 0 ? Math.min(halfWidth, bend.limit) : halfWidth);
    const hi = bend.inner > 0 ? Math.min(halfWidth, bend.limit) : halfWidth;
    for (let j = 0; j < nJ; j++) {
      const lat = lo + ((hi - lo) * j) / across;
      const x = p.x + p.rx * lat;
      const z = p.z + p.rz * lat;
      const k = i * nJ + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = groundSurface(x, z) + lift;
      pos[k * 3 + 2] = z;
      n.set(groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)).normalize();
      nor[k * 3] = n.x;
      nor[k * 3 + 1] = n.y;
      nor[k * 3 + 2] = n.z;
      uv[k * 2] = (lat + 3.7) / microTile;
      uv[k * 2 + 1] = (s * PATH_LENGTH) / microTile;
      macro[k * 2] = (lat + halfWidth) / (2 * halfWidth);
      macro[k * 2 + 1] = s;
    }
  }
  const idx = [];
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * nJ + j;
      const b = a + 1;
      const c = a + nJ;
      const d = c + 1;
      // a -> b runs to the walker's right, a -> c runs along the walk: (a, b, c) faces up
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aMacro", new THREE.BufferAttribute(macro, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------
// STEPPING STONES: noise displaced, slab-like, rounded and chamfered, set INTO the dirt.
// Unit geometry: top of the dome at y = 1, a buried rim at y = 0.05. The instance matrix scales xz by
// the stone's radii and y by (top + sink), and the origin is placed `sink` below the dirt, so the
// ground plane cuts the rim at about unit y 0.55. The rim is therefore a short steep wall that
// disappears into the soil collar.
// Triangles: n + 3 * 2n = 7n, n in 10..13: 70 to 91 per stone.
// ------------------------------------------------------------------------------------------------
const STONE_SIDES = [10, 11, 12, 13];
const STONE_PROFILE = [
  { r: 0.5, y: 0.97 },
  { r: 0.86, y: 0.82 },
  { r: 0.975, y: 0.54 },
  { r: 1.0, y: 0.05 },
];

export function buildStoneGeometry(variant) {
  const n = STONE_SIDES[variant % STONE_SIDES.length];
  const rng = createRng(7000 + variant * 31);
  const noise = createNoise(7100 + variant * 3);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  const squareness = range(rng, 0.06, 0.16); // sandstone slabs are blocky rather than round
  const squareAngle = rng() * TAU;
  const outline = (th) =>
    1 + 0.13 * Math.sin(2 * th + ph[0]) + 0.08 * Math.sin(3 * th + ph[1]) + 0.04 * Math.sin(5 * th + ph[2]) + squareness * Math.cos(4 * (th - squareAngle));
  const norm = 1 / 1.24; // keep the largest radius near 1
  // uneven angular steps: no regular polygon
  const angles = [];
  for (let k = 0; k < n; k++) angles.push(((k + range(rng, -0.28, 0.28)) / n) * TAU);

  const pos = [];
  const col = [];
  const uv = [];
  const mossMul = [0.46, 0.7, 0.3]; // multiplies the grey stone albedo toward moss green
  const soilMul = [0.62, 0.5, 0.38];
  const push = (x, y, z, ring, rFrac) => {
    pos.push(x, y, z);
    uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    const tone = 0.9 + 0.2 * (0.5 + 0.5 * noise.simplex2(x * 3.1 + 5, z * 3.1));
    // moss gathers in the lower crevices near the rim, in noisy patches
    const patch = smoothstep(0.05, 0.6, noise.simplex2(x * 2.4 + 11, z * 2.4 - 3));
    const rimBias = smoothstep(0.35, 0.95, rFrac);
    const moss = clamp(patch * (0.25 + 0.75 * rimBias) * 0.85);
    // the rim is darker and wetter, the buried ring is soil coloured (the soil collar)
    const wet = ring >= 3 ? 0.4 : ring === 2 ? 0.22 : 0;
    const soil = ring >= 4 ? 0.85 : 0;
    let r = tone;
    let g = tone;
    let b = tone;
    r += (mossMul[0] * tone - r) * moss;
    g += (mossMul[1] * tone - g) * moss;
    b += (mossMul[2] * tone - b) * moss;
    r *= 1 - wet;
    g *= 1 - wet;
    b *= 1 - wet * 0.9;
    r += (soilMul[0] - r) * soil;
    g += (soilMul[1] - g) * soil;
    b += (soilMul[2] - b) * soil;
    col.push(r, g, b);
  };
  // centre
  push(0, 1 + 0.03 * noise.simplex2(3.3, variant), 0, 0, 0);
  for (let ri = 0; ri < STONE_PROFILE.length; ri++) {
    const { r: rf, y } = STONE_PROFILE[ri];
    for (let k = 0; k < n; k++) {
      const th = angles[k];
      const rad = rf * outline(th) * norm;
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      // low frequency undulation of the top, so no stone is a clean dome
      const yy = y + (ri < 3 ? 0.06 * noise.simplex2(x * 1.7 + variant * 9, z * 1.7) : 0);
      push(x, yy, z, ri + 1, rf);
    }
  }
  const idx = [];
  // centre fan. Angles increase clockwise seen from above, so (centre, k + 1, k) faces up.
  for (let k = 0; k < n; k++) idx.push(0, 1 + ((k + 1) % n), 1 + k);
  for (let ri = 0; ri < STONE_PROFILE.length - 1; ri++) {
    const a0 = 1 + ri * n;
    const b0 = 1 + (ri + 1) * n;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------
// ROOTS: half tubes (only the upper part is built, the rest is buried) with an elliptical section,
// following the ring lists from pathLayout. 4 segments across, so each band between two rings is 8
// triangles. A crossing root is 8 bands (64) plus two sub roots of 4 bands (32 each) = 128; a flare
// root is 3 bands = 24.
// ------------------------------------------------------------------------------------------------
const BARK_TILE = 2.2; // metres of root surface per bark texture tile (about the trunk circumference)
const ROOT_THETA = 1.75; // half angle of the built arc, radians (100 degrees: a little below the equator)
const ROOT_SEGMENTS = 4;

const _T = new THREE.Vector3();
const _S = new THREE.Vector3();
const _U = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();

// roots: [{ kind, rings: [{x, y, z, w, h, d}] }]. `polish` 0..1 pushes the colour toward bare,
// boot-worn wood where the root crosses the dirt (only for crossing roots). `seed` varies the moss.
export function buildRootGeometry(roots, { polishOnDirt = false, seed = 1 } = {}) {
  const noise = createNoise(8200 + seed);
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  roots.forEach((root, ri) => {
    const rings = root.rings;
    const uOff = ri * 0.37;
    const base = pos.length / 3;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const a = rings[Math.max(0, i - 1)];
      const b = rings[Math.min(rings.length - 1, i + 1)];
      _T.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const span = Math.max(_T.length(), 1e-6);
      _T.divideScalar(span);
      _S.crossVectors(_T, _up).normalize();
      _U.crossVectors(_S, _T).normalize();
      // how fast the section grows or shrinks along the root tilts the normals (swelling roots)
      const slope = (b.w - a.w) / span;
      let polish = 0;
      if (polishOnDirt) {
        const l = locate(r.x, r.z);
        polish = smoothstep(-0.25, 0.15, dirtEdge(l.s, l.lateral));
      }
      for (let k = 0; k <= ROOT_SEGMENTS; k++) {
        const th = -ROOT_THETA + (2 * ROOT_THETA * k) / ROOT_SEGMENTS;
        const st = Math.sin(th);
        const ct = Math.cos(th);
        const px = r.x + _S.x * r.w * st + _U.x * r.h * ct;
        const py = r.y + _S.y * r.w * st + _U.y * r.h * ct;
        const pz = r.z + _S.z * r.w * st + _U.z * r.h * ct;
        pos.push(px, py, pz);
        // ellipse normal (gradient of (s / w)^2 + (u / h)^2), plus the taper tilt
        _n.set(0, 0, 0)
          .addScaledVector(_S, st / r.w)
          .addScaledVector(_U, ct / r.h)
          .normalize()
          .addScaledVector(_T, -slope)
          .normalize();
        nor.push(_n.x, _n.y, _n.z);
        // bark uv in metres so the grain matches the trunks: u across, v along
        uv.push(uOff + (th * (r.w + r.h) * 0.5) / BARK_TILE, r.d / BARK_TILE);
        // ---- vertex colour (multiplies the bark map) ----
        const up = Math.max(0, ct);
        const nearTrunk = 1 - smoothstep(0.15, 1.3, r.d);
        const mossPatch = smoothstep(0.0, 0.7, 0.5 + 0.5 * noise.simplex2(px * 2.1 + seed * 3, pz * 2.1));
        // moss on the shaded upper side near the trunk and along the verge, none on worn wood
        const moss = clamp(up * mossPatch * (0.22 + 0.5 * nearTrunk) * (1 - polish) * (root.kind === "sub" ? 0.5 : 1));
        const side = Math.abs(st); // buried flanks are darker with contact shadow
        let cr = 1 - 0.34 * smoothstep(0.55, 1, side);
        let cg = cr;
        let cb = cr;
        // polished, boot-worn wood: lighter, warmer, almost buff
        // (the bark albedo is a dark brown, so the multiplier lifts and desaturates it toward buff)
        cr += (1.5 - cr) * polish * 0.7;
        cg += (1.56 - cg) * polish * 0.7;
        cb += (1.62 - cb) * polish * 0.7;
        // moss multiplier (shifts the brown bark toward a muted green)
        cr += (0.7 - cr) * moss * 0.65;
        cg += (1.3 - cg) * moss * 0.65;
        cb += (0.68 - cb) * moss * 0.65;
        // lichen speckle: a pale grey lift on the exposed flanks away from the dirt
        const lichen = smoothstep(0.55, 0.9, noise.simplex2(px * 6.5, pz * 6.5 + seed)) * 0.18 * (1 - polish);
        col.push(cr + lichen, cg + lichen, cb + lichen * 0.9);
      }
    }
    const rowLen = ROOT_SEGMENTS + 1;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < ROOT_SEGMENTS; k++) {
        const a = base + i * rowLen + k;
        const b = a + 1;
        const c = a + rowLen;
        const d = c + 1;
        // a -> b is +S, a -> c is +T, so (a, b, c) faces outward and up
        idx.push(a, b, c, b, d, c);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------
// LITTER PIECES (all instanced; scale, colour and orientation come from the instance matrices)
// ------------------------------------------------------------------------------------------------

// A flat leaf quad lying in the XZ plane, 1 x 1 m scaled per instance. UV 0..1 over one atlas cell
// (the material's vertex patch maps it into the cell chosen by the aCell attribute). 2 triangles.
export function buildLeafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.computeBoundingSphere();
  return g;
}

// A twig: a 3 sided bent prism along X, 1 unit long, tapering to 55 percent. 12 triangles.
export function buildTwigGeometry() {
  const rings = 3;
  const sides = 3;
  const pos = [];
  const idx = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const x = t - 0.5;
    const rad = 1 - 0.45 * t;
    // gentle S bend so no twig is a straight rod
    const by = 0.07 * Math.sin(t * Math.PI) + 0.03 * t;
    const bz = 0.05 * Math.sin(t * Math.PI * 1.7);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + 0.5;
      pos.push(x, by + Math.cos(a) * rad, bz + Math.sin(a) * rad);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const a = i * sides + k;
      const b = i * sides + k1;
      const c = (i + 1) * sides + k;
      const d = (i + 1) * sides + k1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// A lathe: an apex at the top (optional) and rings of n points listed TOP FIRST (rough and irregular). Used for
// pebbles, beech mast husks and acorn cups. Triangles: n (apex fan) + 2n per band.
function buildLathe({ n, rings, apex = null, bottom = null, jitter = 0.12, seed = 1, spike = 0 }) {
  const rng = createRng(seed);
  const pos = [];
  const idx = [];
  if (apex !== null) pos.push(0, apex, 0);
  const off = apex !== null ? 1 : 0;
  rings.forEach((rg) => {
    for (let k = 0; k < n; k++) {
      const a = ((k + range(rng, -0.12, 0.12)) / n) * TAU;
      // alternate long and short points when spiky (a beech husk has stiff prickles)
      const rr = rg.r * (1 + range(rng, -jitter, jitter)) * (1 + (k % 2 ? spike : -spike));
      pos.push(Math.cos(a) * rr, rg.y * (1 + range(rng, -jitter * 0.6, jitter * 0.6)), Math.sin(a) * rr);
    }
  });
  if (apex !== null) {
    for (let k = 0; k < n; k++) idx.push(0, off + ((k + 1) % n), off + k);
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = off + ri * n + k;
      const b = off + ri * n + k1;
      const c = off + (ri + 1) * n + k;
      const d = off + (ri + 1) * n + k1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // optional underside apex so a pebble is a closed lump (the lowest ring fans down to it)
  if (bottom !== null) {
    const bi = pos.length / 3;
    pos.push(0, bottom, 0);
    const last = off + (rings.length - 1) * n;
    for (let k = 0; k < n; k++) idx.push(bi, last + k, last + ((k + 1) % n));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Pebble: a 6 sided lump, apex above, equator ring, apex below (12 triangles), rounded by smooth
// normals. Scaled flat by the instance matrix (the stones are always wider than they are tall).
export function buildPebbleGeometry() {
  return buildLathe({ n: 6, rings: [{ r: 1, y: 0 }], apex: 0.7, bottom: -0.55, jitter: 0.16, seed: 31 });
}

// Beech mast husk: a prickly 5 pointed star shell, 15 triangles.
export function buildMastGeometry() {
  return buildLathe({
    n: 5,
    rings: [
      { r: 0.72, y: 0.4 },
      { r: 0.95, y: 0 },
    ],
    apex: 0.78,
    jitter: 0.1,
    seed: 53,
    spike: 0.22,
  });
}

// Acorn cup (the cupule), a shallow dome. 15 triangles.
export function buildAcornCapGeometry() {
  return buildLathe({
    n: 5,
    rings: [
      { r: 0.86, y: 0.3 },
      { r: 1, y: 0 },
    ],
    apex: 0.55,
    jitter: 0.08,
    seed: 71,
  });
}

// Triangle count of a (possibly instanced) mesh, for the budget report.
export function triangleCount(geometry, instances = 1) {
  const per = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  return per * instances;
}
