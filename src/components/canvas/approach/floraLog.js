// THE FALLEN LOG (FALLEN_LOG in src/lib/sections/world.js): a mature beech trunk lying left of the
// path, 4.4 m long. This file builds everything about it:
//
//   createLogFrame()      where it lies, its radius profile, the rotted cavity, the moss mask
//   makeLogTiles()        small periodic noise tiles the painter and the moss placement share
//   paintLog()            generator: bark, peeled bark showing grey wood, moss, lichen, rot -> map + normal
//   buildLogWood()        tube with splintered crown end, upturned root plate roots, broken stubs, bark flaps
//   buildLogSoil()        the earth still clinging to the root plate, soil lumps
//   createLogDetails()    where the moss tufts, ivy, brackets, small ferns and honey fungus sit on it
//
// Frame conventions. The log is straight in plan. `d` is the unit horizontal direction pointing along the
// trunk toward its BUTT (root) end, which is the end nearest the oncoming walker, so the upturned root plate
// is the first strong silhouette seen. x is the distance in metres from the butt toward the broken
// crown end (0 .. L). The cross section angle `a` is measured from straight up (a = 0) toward the side
// that faces the path (a = 90 degrees), so a < 0 is the shaded far flank (north, moss heavy).
// Texture mapping: u = a / 2 pi (wraps round the trunk), v = along, with v 0.035..0.965 the bark body,
// below it the rotted butt strip, above it the fresh splintered wood strip.

import * as THREE from "three";
import { atPath, FALLEN_LOG, MUSHROOM_CLUSTERS } from "@/lib/sections/world";
import { groundHeight } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { createNoise, createWorley, clamp, smoothstep, hash2 } from "@/lib/noise";
import { GeoBuilder, buildClump } from "./floraGeometry";
import { TONE, mixRgb } from "./floraColor";
import { LOG, FLORA_SEED } from "./floraTuning";
import { mossColour, makeTexture, heightToNormal } from "./floraTextures";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const BARK_V = [0.035, 0.965]; // v range of the bark body in the texture

// ------------------------------------------------------------------------------------------------
// Frame
// ------------------------------------------------------------------------------------------------
export function createLogFrame() {
  const rng = createRng(FLORA_SEED + 17);
  const { s, lateral, length: L, r: R0, yawDeg } = FALLEN_LOG;
  const c = atPath(s, lateral);
  const yaw = yawDeg * DEG;
  // d: toward the butt end. The walker comes from +Z, so the +Z end (the one with the larger z) is the butt.
  let dx = Math.cos(yaw);
  let dz = Math.sin(yaw);
  if (dz < 0) {
    dx = -dx;
    dz = -dz;
  }
  const P = atPath(s, 0);
  let sx = -dz;
  let sz = dx;
  if ((P.x - c.x) * sx + (P.z - c.z) * sz < 0) {
    sx = -sx;
    sz = -sz;
  }
  const butt = { x: c.x + (dx * L) / 2, z: c.z + (dz * L) / 2 };
  const ph = [0, 1, 2, 3, 4, 5, 6].map(() => rng() * TAU);
  const cav = LOG.cavity;

  // Ground the trunk rests on: the highest ground within +-0.6 m (a log bridges small dips), sampled
  // every 10 cm and lightly smoothed.
  const gAt = (x) => groundHeight(butt.x - dx * x, butt.z - dz * x);
  const NS = Math.ceil(L / 0.1) + 1;
  const gRaw = [];
  for (let i = 0; i < NS; i++) gRaw.push(gAt(i * 0.1));
  const win = 6;
  const gHi = gRaw.map((_, i) => {
    let m = -Infinity;
    for (let k = Math.max(0, i - win); k <= Math.min(NS - 1, i + win); k++) m = Math.max(m, gRaw[k]);
    return m;
  });
  const gSm = gHi.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(NS - 1, i + 3); k++) {
      sum += gHi[k];
      n++;
    }
    return sum / n;
  });
  const restY = (x) => {
    const f = clamp(x / 0.1, 0, NS - 1.001);
    const i = Math.floor(f);
    return gSm[i] + (gSm[i + 1] - gSm[i]) * (f - i);
  };

  // Rotted hollow: a bowl in the upper flank that faces the path (centre at v along, angle alpha).
  const cavity = (x, a) => {
    let da = (a - cav.alpha * DEG) % TAU;
    if (da > Math.PI) da -= TAU;
    if (da < -Math.PI) da += TAU;
    const dxn = (x - cav.v * L) / (cav.length / 2);
    const dan = da / (42 * DEG);
    return smoothstep(1.0, 0.5, dxn * dxn + dan * dan);
  };

  // Splinter length of the broken crown end at angle a: mostly short stubs, a few long spikes.
  const splinter = (a) =>
    0.05 + 0.4 * Math.pow(clamp(0.5 + 0.55 * Math.sin(4.3 * a + ph[5]) + 0.35 * Math.sin(9.1 * a + ph[6]) - 0.15, 0, 1), 1.6);

  // Mean radius at x ignoring the angle (axis height and the flare).
  const meanRadius = (x) => {
    const t = clamp(x / L, 0, 1);
    return R0 * (1 - 0.17 * Math.pow(t, 1.2)) * (1 + LOG.buttFlare * Math.exp(-x / 0.32) * 0.75);
  };

  const radius = (x, a) => {
    const t = clamp(x / L, 0, 1);
    let r = R0 * (1 - 0.17 * Math.pow(t, 1.2));
    r *= 1 + 0.05 * Math.sin(3 * a + ph[0] + 1.1 * x) + 0.035 * Math.sin(2 * a + ph[1] - 0.7 * x) + 0.02 * Math.sin(7 * a + ph[2] + 3.1 * x);
    // buttress lobes: the root end flares into five ridges
    r *= 1 + LOG.buttFlare * Math.exp(-x / 0.32) * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * a + ph[3])));
    r *= 1 - cav.depth * cavity(x, a);
    return r;
  };

  const axisY = (x) => restY(x) + meanRadius(x) * (1 - LOG.sink);
  const centre = (x) => [butt.x - dx * x, axisY(x), butt.z - dz * x];
  // Point on the surface at distance x along and angle a, pushed out by `lift` metres.
  const point = (x, a, lift = 0) => {
    const r = radius(x, a) + lift;
    const c0 = centre(x);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return [c0[0] + sx * sa * r, c0[1] + ca * r, c0[2] + sz * sa * r];
  };
  const normalAt = (a) => [sx * Math.sin(a), Math.cos(a), sz * Math.sin(a)];

  return {
    L,
    R0,
    d: [dx, 0, dz],
    side: [sx, 0, sz],
    butt: [butt.x, restY(0), butt.z],
    ph,
    cavity,
    splinter,
    radius,
    meanRadius,
    centre,
    point,
    normalAt,
    restY,
    ground: gAt,
    seed: FLORA_SEED,
  };
}

// ------------------------------------------------------------------------------------------------
// Periodic noise tiles (shared by the painter and the moss placement)
// ------------------------------------------------------------------------------------------------
function makeTile(seed, cu, cv, w, h, octaves, mode = "fbm") {
  const noise = createNoise(seed);
  const data = new Float32Array(w * h);
  return { noise, data, w, h, cu, cv, octaves, mode, row: 0 };
}

// Fill a few rows of a tile (generator step).
function* fillTile(t) {
  const { noise, data, w, h, cu, cv, octaves, mode } = t;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let n;
      if (mode === "ridged") n = noise.ridged2(u * cu, v * cv, octaves, cu, cv);
      else n = noise.fbm2(u * cu, v * cv, octaves, cu, cv) * 0.5 + 0.5;
      data[y * w + x] = n;
    }
    if ((y & 15) === 15) yield;
  }
}

function* fillDomeTile(t, seed) {
  const { data, w, h, cu } = t;
  const wor = createWorley(seed, cu, cu, 0.95);
  const noise = createNoise(seed + 5);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const nz = noise.fbm2(u * 6, v * 6, 2, 6, 6);
      wor.sample(u * cu + nz * 0.9, v * cu + noise.fbm2(u * 6 + 4, v * 6 + 4, 2, 6, 6) * 0.9);
      data[y * w + x] = clamp(1 - wor.f1 * 1.2) * (0.6 + 0.4 * wor.id);
    }
    if ((y & 15) === 15) yield;
  }
}

// Bilinear periodic sample. (u, v) are in tile units: the tile repeats every 1.0.
function ts(t, u, v) {
  const { data, w, h } = t;
  let fx = (u - Math.floor(u)) * w - 0.5;
  let fy = (v - Math.floor(v)) * h - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  fx -= ix;
  fy -= iy;
  const x0 = (ix + w) % w;
  const x1 = (x0 + 1) % w;
  const y0 = (iy + h) % h;
  const y1 = (y0 + 1) % h;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function* makeLogTiles() {
  const s = FLORA_SEED;
  const tiles = {
    macro: makeTile(s + 1, 3, 6, 96, 192, 3), // blotches about 0.7 m across
    mid: makeTile(s + 2, 9, 18, 144, 288, 2), // about 25 cm
    fine: makeTile(s + 3, 16, 16, 128, 128, 3), // repeated 1.75 times: about 8 cm
    wr: makeTile(s + 4, 6, 25, 64, 128, 2), // bark wrinkles, stretched around the trunk
    grain: makeTile(s + 5, 14, 2, 128, 64, 2), // streaks along the grain of bare wood
    crack: makeTile(s + 6, 8, 2, 128, 64, 3, "ridged"),
    cush: makeTile(s + 7, 16, 16, 64, 64, 1), // moss cushions, filled from Worley domes
  };
  yield* fillTile(tiles.macro);
  yield* fillTile(tiles.mid);
  yield* fillTile(tiles.fine);
  yield* fillTile(tiles.wr);
  yield* fillTile(tiles.grain);
  yield* fillTile(tiles.crack);
  yield* fillDomeTile(tiles.cush, s + 8);
  return tiles;
}

const ASPECT = FALLEN_LOG.length / (TAU * FALLEN_LOG.r); // length / circumference: about 1.95

// Moss cover 0..1 at angle a (0 = top) and fraction vv along the trunk (0 butt .. 1 crown). Top and the
// shaded far flank are heavily mossed, the near flank patchy, the underside nearly bare.
export function logMossMask(tiles, a, vv, cavityValue = 0) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const top = smoothstep(-0.1, 0.7, ca);
  const far = smoothstep(0.0, 0.8, -sa) * (1 - top);
  const near = smoothstep(0.0, 0.8, sa) * (1 - top);
  const cover = 0.95 * top + 0.8 * far + 0.4 * near + 0.04 * smoothstep(0.2, -0.9, ca);
  const n = ts(tiles.macro, a / TAU + 0.21, vv + 0.37) * 0.65 + ts(tiles.mid, a / TAU, vv) * 0.35;
  return smoothstep(0.42, 0.62, cover + 0.9 * (n - 0.5) - 0.1) * (1 - cavityValue);
}

// ------------------------------------------------------------------------------------------------
// Painter: albedo + normal map, bark body plus a butt strip and a fresh wood strip.
// ------------------------------------------------------------------------------------------------
export function* paintLog(frame, tiles) {
  const [W, H] = LOG.texture;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  const bark0 = mixRgb(TONE.barkDark, TONE.stone, 0.34);
  const bark1 = mixRgb(TONE.bark, TONE.stone, 0.5);
  const wood0 = mixRgb(TONE.greyWood, TONE.stone, 0.12);
  const wood1 = mixRgb(TONE.stone, TONE.cream, 0.12);
  const rot0 = mixRgb(TONE.forest, TONE.timberDark, 0.6);
  const rotLit = mixRgb(TONE.timber, TONE.warm, 0.22);
  const lichen = mixRgb(TONE.stone, TONE.leafLight, 0.3);
  const fresh0 = mixRgb(TONE.wood, TONE.stone, 0.3);
  const fresh1 = mixRgb(TONE.wood, TONE.cream, 0.4);
  const cosA = new Float32Array(W);
  const sinA = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const a = ((x + 0.5) / W) * TAU;
    cosA[x] = Math.cos(a);
    sinA[x] = Math.sin(a);
  }
  const L = frame.L;
  const mc = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const a = u * TAU;
      const o = (y * W + x) * 4;
      let r;
      let g;
      let b;
      let h;
      if (v < BARK_V[0]) {
        // butt strip: dark, wet, rotted end grain
        const n = ts(tiles.fine, u * 1.75, v * 8);
        const m = n * 0.7 + ts(tiles.grain, u * 3, v * 6) * 0.3;
        r = rot0[0] + (TONE.timberDark[0] - rot0[0]) * m;
        g = rot0[1] + (TONE.timberDark[1] - rot0[1]) * m;
        b = rot0[2] + (TONE.timberDark[2] - rot0[2]) * m;
        h = 0.3 + 0.3 * n;
      } else if (v > BARK_V[1]) {
        // splintered crown end: pale fresh wood with fibres running along the trunk
        const gr = ts(tiles.grain, u * 5, v * 2);
        const m = clamp(gr * 0.9 + 0.1 * ts(tiles.fine, u * 1.75, v * 4));
        r = fresh0[0] + (fresh1[0] - fresh0[0]) * m;
        g = fresh0[1] + (fresh1[1] - fresh0[1]) * m;
        b = fresh0[2] + (fresh1[2] - fresh0[2]) * m;
        h = 0.5 + 0.35 * gr;
      } else {
        const vv = (v - BARK_V[0]) / (BARK_V[1] - BARK_V[0]);
        const ca = cosA[x];
        const top = smoothstep(-0.25, 0.8, ca);
        const m1 = ts(tiles.macro, u, vv);
        const m2 = ts(tiles.mid, u, vv);
        const f1 = ts(tiles.fine, u * 1.75, vv * 1.75 * ASPECT);
        const wr = ts(tiles.wr, u, vv * 4);
        const grain = ts(tiles.grain, u * 5, vv * 2);
        const cr = ts(tiles.crack, u * 2, vv * 2);
        // ---- peeled bark: patches where the bark has fallen away to grey wood
        const pb = m1 * 0.7 + m2 * 0.3 + 0.16 * (1 - top) - 0.08;
        const peeled = smoothstep(0.6, 0.635, pb);
        const lip = smoothstep(0.575, 0.6, pb) * (1 - smoothstep(0.62, 0.65, pb));
        const shadowBand = smoothstep(0.635, 0.66, pb) * (1 - smoothstep(0.66, 0.72, pb));
        // ---- bark colour: grey brown with horizontal wrinkles, pale lichen flecks
        const kb = clamp(0.2 + 0.7 * f1 + 0.35 * (wr - 0.5));
        let br = bark0[0] + (bark1[0] - bark0[0]) * kb;
        let bg = bark0[1] + (bark1[1] - bark0[1]) * kb;
        let bb = bark0[2] + (bark1[2] - bark0[2]) * kb;
        const lich = smoothstep(0.62, 0.74, f1 * 0.55 + m2 * 0.55) * 0.4;
        br += (lichen[0] - br) * lich;
        bg += (lichen[1] - bg) * lich;
        bb += (lichen[2] - bb) * lich;
        // ---- bare wood: silver grey with grain and dark cracks, shadowed under the bark edge
        const kw = clamp(grain * 0.85 + 0.1);
        const crack = smoothstep(0.76, 0.86, cr);
        const wk = (1 - 0.5 * crack) * (1 - 0.32 * shadowBand);
        const wr0 = (wood0[0] + (wood1[0] - wood0[0]) * kw) * wk;
        const wg0 = (wood0[1] + (wood1[1] - wood0[1]) * kw) * wk;
        const wb0 = (wood0[2] + (wood1[2] - wood0[2]) * kw) * wk;
        r = br + (wr0 - br) * peeled;
        g = bg + (wg0 - bg) * peeled;
        b = bb + (wb0 - bb) * peeled;
        // pale curled lip along the bark edge
        r += lip * 26;
        g += lip * 24;
        b += lip * 20;
        // ---- damp staining on the shaded underside
        const dm = smoothstep(0.58, 0.8, ts(tiles.macro, u + 0.31, vv + 0.57)) * (1 - 0.6 * top) * (1 - peeled * 0.5);
        r *= 1 - 0.42 * dm;
        g *= 1 - 0.4 * dm;
        b *= 1 - 0.36 * dm;
        h = 0.52 + 0.16 * (wr - 0.5) + 0.1 * (f1 - 0.5);
        h = h + (0.3 + 0.06 * grain - h) * peeled + 0.14 * lip - 0.1 * crack * peeled;
        // ---- the rotted cavity and its punky rim
        const cvv = frame.cavity(vv * L, a);
        if (cvv > 0) {
          const rim = smoothstep(0.0, 0.25, cvv) * (1 - smoothstep(0.25, 0.6, cvv));
          const rt = ts(tiles.mid, u * 2, vv * 2);
          let cr0 = rot0[0] + (rotLit[0] - rot0[0]) * (0.25 * rt + 0.7 * rim);
          let cg0 = rot0[1] + (rotLit[1] - rot0[1]) * (0.25 * rt + 0.7 * rim);
          let cb0 = rot0[2] + (rotLit[2] - rot0[2]) * (0.25 * rt + 0.7 * rim);
          const k = smoothstep(0.0, 0.35, cvv);
          r += (cr0 - r) * k;
          g += (cg0 - g) * k;
          b += (cb0 - b) * k;
          h = h * (1 - k) + (0.3 + 0.25 * rt) * k;
        }
        // ---- moss: cushions in brand greens over the top and the shaded flank
        const M = logMossMask(tiles, a, vv, cvv);
        if (M > 0.01) {
          const cush = ts(tiles.cush, u * 2.75, vv * 2.75 * ASPECT);
          mossColour(cush, ts(tiles.macro, u * 2 + 0.6, vv * 2 + 0.2), mc);
          const kk = 0.55 + 0.6 * cush;
          const mm = smoothstep(0.0, 1.0, M);
          r += (mc[0] * kk - r) * mm;
          g += (mc[1] * kk - g) * mm;
          b += (mc[2] * kk - b) * mm;
          h += mm * (0.18 + 0.42 * cush);
        }
        const dn = 0.94 + 0.12 * ts(tiles.fine, u * 3.5 + 0.1, vv * 3.5 * ASPECT);
        r *= dn;
        g *= dn;
        b *= dn;
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      hgt[y * W + x] = h;
    }
    if ((y & 7) === 7) yield;
  }
  yield;
  const normal = heightToNormal(hgt, W, H, 3.4, true, false);
  yield;
  // opaque colour: let the GPU build the mip chain
  return {
    map: makeTexture(rgba, W, H, { srgb: true, tile: false }),
    normalMap: makeTexture(normal, W, H, { tile: false }),
  };
}

// ------------------------------------------------------------------------------------------------
// Geometry
// ------------------------------------------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

// Replace a builder's normals by area weighted face normals (for closed smooth meshes without UV seams).
function smoothNormals(b, from = 0) {
  const acc = new Float32Array(b.vertexCount * 3);
  for (let i = 0; i < b.idx.length; i += 3) {
    const ia = b.idx[i];
    const ib = b.idx[i + 1];
    const ic = b.idx[i + 2];
    if (ia < from) continue;
    _a.set(b.pos[ib * 3] - b.pos[ia * 3], b.pos[ib * 3 + 1] - b.pos[ia * 3 + 1], b.pos[ib * 3 + 2] - b.pos[ia * 3 + 2]);
    _b.set(b.pos[ic * 3] - b.pos[ia * 3], b.pos[ic * 3 + 1] - b.pos[ia * 3 + 1], b.pos[ic * 3 + 2] - b.pos[ia * 3 + 2]);
    _n.crossVectors(_a, _b);
    for (const v of [ia, ib, ic]) {
      acc[v * 3] += _n.x;
      acc[v * 3 + 1] += _n.y;
      acc[v * 3 + 2] += _n.z;
    }
  }
  for (let v = from; v < b.vertexCount; v++) {
    const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1;
    b.nor[v * 3] = acc[v * 3] / l;
    b.nor[v * 3 + 1] = acc[v * 3 + 1] / l;
    b.nor[v * 3 + 2] = acc[v * 3 + 2] / l;
  }
}

// A tapered tube along a polyline (parallel transport frames). Used for stubs and roots. The far end is
// either capped flat or broken (jagged). UV maps into the log texture's bark body.
function addTube(b, pts, radii, sides, uvRect, colour, { broken = false, rng = null } = {}) {
  const first = b.vertexCount;
  const T = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(pts.length - 1, i + 1)];
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    T.push(_a.clone());
  }
  // initial normal: any perpendicular to the first tangent
  let nrm = new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].y) > 0.9) nrm.set(1, 0, 0);
  nrm.sub(T[0].clone().multiplyScalar(nrm.dot(T[0]))).normalize();
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    // parallel transport: remove the component along the new tangent
    nrm.sub(T[i].clone().multiplyScalar(nrm.dot(T[i]))).normalize();
    const bin = new THREE.Vector3().crossVectors(T[i], nrm);
    const ring = [];
    const last = i === pts.length - 1;
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      let rr = radii[i];
      let along = 0;
      if (last && broken && rng) {
        rr *= range(rng, 0.45, 0.95);
        along = range(rng, -0.01, 0.07) * (1 + radii[0] * 6);
      }
      const dirx = nrm.x * ca + bin.x * sa;
      const diry = nrm.y * ca + bin.y * sa;
      const dirz = nrm.z * ca + bin.z * sa;
      ring.push(
        b.vertex(
          pts[i][0] + dirx * rr + T[i].x * along,
          pts[i][1] + diry * rr + T[i].y * along,
          pts[i][2] + dirz * rr + T[i].z * along,
          dirx,
          diry,
          dirz,
          uvRect[0] + (uvRect[2] - uvRect[0]) * (j / sides),
          uvRect[1] + (uvRect[3] - uvRect[1]) * (i / (pts.length - 1)),
          colour[0],
          colour[1],
          colour[2],
        ),
      );
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) b.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]);
  }
  // end cap (fan to a centre vertex) so a broken stub is not hollow
  const end = pts[pts.length - 1];
  const cap = b.vertex(end[0] + T[T.length - 1].x * 0.01, end[1] + T[T.length - 1].y * 0.01, end[2] + T[T.length - 1].z * 0.01, T[T.length - 1].x, T[T.length - 1].y, T[T.length - 1].z, (uvRect[0] + uvRect[2]) / 2, uvRect[3], colour[0] * 0.8, colour[1] * 0.8, colour[2] * 0.8);
  const lastRing = rings[rings.length - 1];
  for (let j = 0; j < sides; j++) b.tri(cap, lastRing[j], lastRing[j + 1]);
  return first;
}

export function buildLogWood(frame) {
  const rng = createRng(FLORA_SEED + 313);
  const b = new GeoBuilder();
  const { L } = frame;
  const sides = LOG.sides;
  const nS = LOG.stations;
  // ---- ring stations: denser toward the ends where the flare and the splinters are
  const xs = [];
  for (let i = 0; i < nS; i++) {
    const u = i / (nS - 1);
    xs.push(L * (u - 0.045 * Math.sin(TAU * u)));
  }
  const gridP = []; // [ring][side] -> [x, y, z]
  const gridV = []; // v coordinate of each ring
  const gridAO = [];
  const addRing = (xFn, rFn, v) => {
    const ring = [];
    const ao = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const x = xFn(a);
      const p = frame.point(x, a);
      const c = frame.centre(x);
      const rr = rFn(a);
      // scale the offset from the axis by rr relative to the true surface (used by the splinter rings)
      ring.push([c[0] + (p[0] - c[0]) * rr, c[1] + (p[1] - c[1]) * rr, c[2] + (p[2] - c[2]) * rr]);
      const cvv = frame.cavity(Math.min(x, L), a);
      const bottom = smoothstep(-0.95, 0.15, Math.cos(a));
      ao.push((0.42 + 0.58 * bottom) * (1 - 0.6 * cvv));
    }
    gridP.push(ring);
    gridV.push(v);
    gridAO.push(ao);
  };
  for (const x of xs) addRing(() => x, () => 1, BARK_V[0] + (BARK_V[1] - BARK_V[0]) * (x / L));
  // two splinter rings beyond the broken crown end: tips reach out by frame.splinter(a)
  const sp1 = [];
  for (let j = 0; j < sides; j++) sp1.push(range(rng, 0.8, 1.15));
  addRing((a) => L + 0.5 * frame.splinter(a), (a) => 0.9 * sp1[Math.round((a / TAU) * sides) % sides] * 0.95, 0.985);
  addRing((a) => L + 1.0 * frame.splinter(a), (a) => 0.58 * sp1[Math.round((a / TAU) * sides) % sides], 0.985);
  const nR = gridP.length;
  // ---- vertices with finite difference normals (consistent across the UV seam)
  const idx = [];
  for (let i = 0; i < nR; i++) {
    const row = [];
    for (let j = 0; j <= sides; j++) {
      const jj = j % sides;
      const p = gridP[i][jj];
      const pa = gridP[i][(jj + 1) % sides];
      const pb = gridP[i][(jj - 1 + sides) % sides];
      const pn = gridP[Math.min(nR - 1, i + 1)][jj];
      const pp = gridP[Math.max(0, i - 1)][jj];
      _a.set(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      _b.set(pn[0] - pp[0], pn[1] - pp[1], pn[2] - pp[2]);
      // around x along gives the outward normal (with the ring order used here)
      _n.crossVectors(_a, _b).normalize();
      // make sure it points away from the axis
      const c = frame.centre(Math.min(L, xs[Math.min(i, nS - 1)]));
      if ((p[0] - c[0]) * _n.x + (p[1] - c[1]) * _n.y + (p[2] - c[2]) * _n.z < 0) _n.negate();
      const ao = gridAO[i][jj];
      row.push(b.vertex(p[0], p[1], p[2], _n.x, _n.y, _n.z, j / sides, gridV[i], ao, ao, ao));
    }
    idx.push(row);
  }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < sides; j++) b.quad(idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]);
  // ---- end caps: a rotted dark core pulled inside the broken end, and the butt closed against the root plate
  {
    const last = nR - 1;
    const core = frame.centre(L - 0.1);
    const cv = b.vertex(core[0], core[1], core[2], -frame.d[0], 0, -frame.d[2], 0.5, 0.985, 0.45, 0.4, 0.38);
    for (let j = 0; j < sides; j++) b.tri(cv, idx[last][j + 1], idx[last][j]);
    const bc = frame.centre(-0.05);
    const bv = b.vertex(bc[0], bc[1], bc[2], frame.d[0], 0, frame.d[2], 0.5, 0.0, 0.5, 0.45, 0.4);
    for (let j = 0; j < sides; j++) b.tri(bv, idx[0][j], idx[0][j + 1]);
  }
  const bodyTriangles = b.triangles;

  // ---- broken branch stubs on the upper flanks, angled toward the crown
  for (let k = 0; k < LOG.stubs; k++) {
    const x = L * range(rng, 0.3 + 0.15 * k, 0.42 + 0.2 * k);
    const a = (k % 2 === 0 ? -1 : 1) * range(rng, 25, 70) * DEG;
    const base = frame.point(x, a, -0.04);
    const n = frame.normalAt(a);
    // direction: out of the surface, tipped up and toward the crown
    const dir = new THREE.Vector3(n[0] * 0.7 - frame.d[0] * 0.55, n[1] * 0.7 + 0.45, n[2] * 0.7 - frame.d[2] * 0.55).normalize();
    const len = range(rng, 0.2, 0.42);
    const r0 = range(rng, 0.055, 0.085);
    const pts = [];
    const radii = [];
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push([base[0] + dir.x * len * t, base[1] + dir.y * len * t - 0.02 * t * t, base[2] + dir.z * len * t]);
      radii.push(r0 * (1 - 0.35 * t));
    }
    const v0 = range(rng, 0.2, 0.75);
    const u0 = range(rng, 0.0, 0.8);
    addTube(b, pts, radii, 6, [u0, v0, u0 + 0.17, v0 + 0.06], [1, 0.95, 0.9], { broken: true, rng });
  }

  // ---- peeled bark flaps lying on the ground beside the trunk
  for (let k = 0; k < LOG.flaps; k++) {
    const x = L * range(rng, 0.08, 0.95);
    const side = rng() < 0.6 ? 1 : -1; // more on the path side where they are seen
    const off = frame.radius(x, side > 0 ? 1.57 : -1.57) + range(rng, 0.04, 0.5);
    const c = frame.centre(x);
    const px = c[0] + frame.side[0] * side * off;
    const pz = c[2] + frame.side[2] * side * off;
    const py = groundHeightSafe(px, pz) + 0.012;
    const yaw = rng() * TAU;
    const w = range(rng, 0.07, 0.12);
    const l = range(rng, 0.12, 0.24);
    const curl = range(rng, 0.015, 0.035);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const u0 = range(rng, 0.0, 0.75);
    const v0 = range(rng, 0.2, 0.85);
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const sx = (i / 2 - 0.5) * w;
      const lift = curl * Math.pow(Math.abs(i - 1), 1) * 1.0; // edges curl up
      const pair = [];
      for (const z of [-l / 2, l / 2]) {
        const wx = px + sx * cy - z * sy;
        const wz = pz + sx * sy + z * cy;
        const ao = 0.85 + 0.15 * rng();
        pair.push(b.vertex(wx, py + lift, wz, 0, 1, 0, u0 + (i / 2) * 0.08, v0 + (z > 0 ? 0.06 : 0), ao * 0.95, ao * 0.9, ao * 0.85));
      }
      rows.push(pair);
    }
    for (let i = 0; i < 2; i++) b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
  }
  {
    // the rotting stub beside the path, leaning a little, its top broken and jagged
    const st = rottenStub();
    const lean = [range(rng, -0.05, 0.05), range(rng, -0.05, 0.05)];
    const pts = [];
    const radii = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      pts.push([st.x + lean[0] * t, st.y - 0.05 + (st.h + 0.05) * t, st.z + lean[1] * t]);
      radii.push(st.r * (1.2 - 0.3 * t));
    }
    addTube(b, pts, radii, 7, [0.1, 0.4, 0.4, 0.47], [0.9, 0.85, 0.8], { broken: true, rng });
  }
  const stubFlapTriangles = b.triangles - bodyTriangles;

  // ---- roots of the upturned root plate (the soil mass itself is buildLogSoil)
  const plate = rootPlateFrame(frame);
  const rootsStart = b.triangles;
  for (let k = 0; k < LOG.roots; k++) {
    const beta = (k / LOG.roots) * TAU + range(rng, -0.25, 0.25);
    const ex = Math.cos(beta);
    const ey = Math.sin(beta);
    const reach = plate.R * range(rng, 0.95, 1.3);
    const pts = [];
    const radii = [];
    const segs = 3;
    const wob = range(rng, 0.0, TAU);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const rr = plate.R * 0.14 + (reach - plate.R * 0.14) * t;
      // sweeps out across the soil face, lifts clear of it, then droops under its own weight past the rim
      const out = 0.04 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 0.95)) + 0.06 * t;
      const sag = 0.34 * Math.pow(Math.max(0, t - 0.55) / 0.45, 2);
      const bend = Math.sin(t * 5 + wob) * 0.05;
      const px = plate.c[0] + plate.e1[0] * (ex * rr + bend * ey) + plate.e2[0] * (ey * rr - bend * ex) + plate.n[0] * out;
      const py = plate.c[1] + plate.e1[1] * (ex * rr + bend * ey) + plate.e2[1] * (ey * rr - bend * ex) + plate.n[1] * out - sag;
      const pz = plate.c[2] + plate.e1[2] * (ex * rr + bend * ey) + plate.e2[2] * (ey * rr - bend * ex) + plate.n[2] * out;
      pts.push([px, Math.max(py, groundHeightSafe(px, pz) + 0.03), pz]);
      radii.push(range(rng, 0.065, 0.085) * (1 - 0.72 * t));
    }
    const u0 = range(rng, 0.0, 0.8);
    const v0 = range(rng, 0.15, 0.85);
    // dark wet roots: tinted brown through the vertex colour
    addTube(b, pts, radii, 5, [u0, v0, u0 + 0.12, v0 + 0.1], [0.62, 0.5, 0.42], { broken: true, rng });
  }
  const rootTriangles = b.triangles - rootsStart;
  const geometry = b.build({ colours: true });
  geometry.name = "logWood";
  return { geometry, triangles: b.triangles, parts: { body: bodyTriangles, stubsFlaps: stubFlapTriangles, roots: rootTriangles } };
}

function groundHeightSafe(x, z) {
  return groundHeight(x, z);
}

// A short rotting stub (the broken base of a long dead sapling) at the third mushroom cluster: honey
// fungus grows from it. It is the same wood material as the log.
export function rottenStub() {
  const m = MUSHROOM_CLUSTERS[2];
  const p = atPath(m.s, m.lateral);
  return { x: p.x, y: groundHeight(p.x, p.z), z: p.z, r: 0.14, h: 0.34 };
}

// The root plate: an upturned disc of soil and roots standing at the butt end, plane normal toward the
// walker, leaning back a little. e1 is the plate's "up", e2 its horizontal axis.
function rootPlateFrame(frame) {
  const n = new THREE.Vector3(frame.d[0], 0.16, frame.d[2]).normalize();
  const e1 = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const R = 0.88;
  const c = new THREE.Vector3(frame.butt[0] + frame.d[0] * 0.16, frame.butt[1] + R * 0.8, frame.butt[2] + frame.d[2] * 0.16);
  return { n: n.toArray(), e1: e1.toArray(), e2: e2.toArray(), R, c: c.toArray() };
}

export function buildLogSoil(frame) {
  const rng = createRng(FLORA_SEED + 421);
  const b = new GeoBuilder();
  const p = rootPlateFrame(frame);
  const seg = 14;
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  const radiusAt = (th) => p.R * (1 + 0.1 * Math.sin(3 * th + ph[0]) + 0.07 * Math.sin(5 * th + ph[1]) + 0.05 * Math.sin(8 * th + ph[2]));
  const at = (th, f, depth) => {
    const rr = radiusAt(th) * f;
    const ce = Math.cos(th);
    const se = Math.sin(th);
    const lump = 0.07 * Math.sin(2.3 * th + ph[3] + f * 4) * f;
    const px = p.c[0] + p.e1[0] * ce * rr + p.e2[0] * se * rr + p.n[0] * (depth + lump);
    const py = p.c[1] + p.e1[1] * ce * rr + p.e2[1] * se * rr + p.n[1] * (depth + lump);
    const pz = p.c[2] + p.e1[2] * ce * rr + p.e2[2] * se * rr + p.n[2] * (depth + lump);
    return [px, Math.max(py, groundHeightSafe(px, pz) - 0.04), pz];
  };
  const uvOf = (pos) => {
    // planar projection onto the plate: 1.2 m per soil tile
    const dx = pos[0] - p.c[0];
    const dy = pos[1] - p.c[1];
    const dz = pos[2] - p.c[2];
    return [(dx * p.e2[0] + dy * p.e2[1] + dz * p.e2[2]) / 1.2, (dx * p.e1[0] + dy * p.e1[1] + dz * p.e1[2]) / 1.2];
  };
  const vert = (pos, tint) => {
    const [u, v] = uvOf(pos);
    return b.vertex(pos[0], pos[1], pos[2], 0, 1, 0, u, v, tint[0], tint[1], tint[2]);
  };
  const front0 = vert(at(0, 0, 0.1), [0.8, 0.75, 0.7]);
  const ringA = [];
  const ringB = [];
  const backB = [];
  for (let j = 0; j < seg; j++) {
    const th = (j / seg) * TAU;
    const topness = 0.5 + 0.5 * Math.cos(th); // e1 is "up" in the plate: moss and fibres on the top rim
    const mossy = 0.78 + 0.0 * topness;
    ringA.push(vert(at(th, 0.52, 0.17 + 0.03 * Math.sin(th * 3)), [0.95, 0.9, 0.85]));
    ringB.push(vert(at(th, 1.0, 0.03), [1, 0.95, 0.9].map((q, i) => q * (i === 1 ? mossy + 0.12 * topness : 1))));
    backB.push(vert(at(th, 0.94, -0.3), [0.55, 0.5, 0.45]));
  }
  const back0 = vert(at(0, 0, -0.32), [0.45, 0.42, 0.4]);
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg;
    b.tri(front0, ringA[j], ringA[k]);
    b.quad(ringA[j], ringB[j], ringB[k], ringA[k]);
    b.quad(ringB[j], backB[j], backB[k], ringB[k]);
    b.tri(back0, backB[k], backB[j]);
  }
  smoothNormals(b);
  // face the normals outward from the plate centre where the weighted sum came out inverted
  for (let v = 0; v < b.vertexCount; v++) {
    const dx = b.pos[v * 3] - p.c[0];
    const dy = b.pos[v * 3 + 1] - p.c[1];
    const dz = b.pos[v * 3 + 2] - p.c[2];
    if (dx * b.nor[v * 3] + dy * b.nor[v * 3 + 1] + dz * b.nor[v * 3 + 2] < -0.05 && v !== back0) {
      b.nor[v * 3] *= -1;
      b.nor[v * 3 + 1] *= -1;
      b.nor[v * 3 + 2] *= -1;
    }
  }
  // a few clods of earth fallen from the plate
  let clumps = 0;
  for (let k = 0; k < 4; k++) {
    const { geometry } = buildClump(k + 3, range(rng, 0.07, 0.16));
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const gi = geometry.index;
    const cx = frame.butt[0] + frame.d[0] * range(rng, 0.3, 1.1) + frame.side[0] * range(rng, -1.0, 1.0);
    const cz = frame.butt[2] + frame.d[2] * range(rng, 0.3, 1.1) + frame.side[2] * range(rng, -1.0, 1.0);
    const cy = groundHeightSafe(cx, cz) - 0.01;
    const base = b.vertexCount;
    for (let i = 0; i < pos.count; i++) b.vertex(cx + pos.getX(i), cy + pos.getY(i), cz + pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), uv.getX(i), uv.getY(i), 0.8, 0.75, 0.7);
    for (let i = 0; i < gi.count; i += 3) b.tri(base + gi.getX(i), base + gi.getX(i + 1), base + gi.getX(i + 2));
    geometry.dispose();
    clumps++;
  }
  const geometry = b.build({ colours: true });
  geometry.name = "logSoil";
  return { geometry, triangles: b.triangles };
}

// ------------------------------------------------------------------------------------------------
// Things that sit on the trunk
// ------------------------------------------------------------------------------------------------
// Returns spots as plain data; floraPlacement and floraAssemble turn them into instances.
export function createLogDetails(frame, tiles) {
  const rng = createRng(FLORA_SEED + 523);
  const { L } = frame;
  const out = { moss: [], ivy: [], shelves: [], ferns: [], mushrooms: [] };

  // ---- moss tufts: rejection sampled on the mask, never in the cavity or on the buried underside
  let guard = 0;
  while (out.moss.length < LOG.mossCards && guard++ < 3000) {
    const x = L * range(rng, 0.03, 0.97);
    const a = rng() * TAU;
    if (Math.cos(a) < -0.45) continue;
    const cv = frame.cavity(x, a);
    const m = logMossMask(tiles, a, x / L, cv);
    if (rng() > m * m + 0.02) continue;
    const standing = rng() < 0.3; // a few tufts stand up from the surface like a shaggy fringe
    out.moss.push({ x, a, size: range(rng, 0.18, 0.36), yaw: rng() * TAU, standing, tint: range(rng, 0.78, 1.08) });
  }

  // ---- ivy runners draped over the near flank and top, running mostly around the trunk
  for (let k = 0; k < LOG.ivy; k++) {
    const x = L * range(rng, 0.1, 0.95);
    const a = range(rng, -20, 100) * DEG;
    out.ivy.push({ x, a, size: range(rng, 0.55, 1.0), yaw: rng() < 0.6 ? Math.PI / 2 + range(rng, -0.5, 0.5) : range(rng, -0.4, 0.4) });
  }

  // ---- bracket fungus shelves on the near flank, away from the cavity
  for (let k = 0; k < LOG.brackets; k++) {
    const x = L * (0.2 + 0.27 * k + range(rng, -0.05, 0.05));
    const a = range(rng, 62, 98) * DEG;
    out.shelves.push({ x, a, size: range(rng, 0.09, 0.17) });
  }

  // ---- small ferns rooted in the moss on top
  for (let k = 0; k < LOG.ferns; k++) {
    const x = L * range(rng, 0.22, 0.9);
    const a = range(rng, -30, 45) * DEG;
    out.ferns.push({ x, a, species: k % 3 === 2 ? "harts" : "male", size: range(rng, 0.34, 0.55) });
  }

  // ---- honey fungus: a tight clump of caps on the flank near the butt
  const cx = L * 0.2;
  for (let k = 0; k < 5; k++) {
    out.mushrooms.push({
      x: cx + range(rng, -0.14, 0.14),
      a: (68 + range(rng, -18, 18)) * DEG,
      radius: range(rng, 0.022, 0.05),
      stem: range(rng, 0.85, 1.5),
    });
  }
  return out;
}
