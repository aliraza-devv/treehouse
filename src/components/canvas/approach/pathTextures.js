// Runtime-painted PBR textures for the path and the ground around it. BROWSER ONLY (canvas 2D); call
// the generators from inside useFrame / effects under <Canvas>, never during render or SSR.
//
// Every painter is a GENERATOR: each `yield` marks a point where about 10 to 30 ms of work has been
// done, so the build scheduler (pathBuild.js) can spread painting across several frames and no frame
// stalls. `gen.next()` returns { done, value } and the final value is the texture set.
//
// What is painted
//   MICRO  512 x 512, tiles every RIBBON.microTile (2.4 m, about 4.7 mm per texel): compacted damp
//          earth and clay, pebbles pressed in, flattened leaf fragments, fine drying cracks. Albedo,
//          normal, roughness + ambient occlusion (R = AO, G = roughness, like the hero toolkit). The
//          albedo ALPHA holds a fine noise that roughens the alpha-cut edge of the ribbon.
//   MACRO  128 x 512 (x2), covers the whole path ONCE (2.5 cm across, 2.8 cm along) in
//          (across, along) space, so nothing repeats: where the dirt is, its two ragged edges, the
//          buff boot-polished centre, two wear lines, peaty edges, moss patches, puddles, damp halos
//          round stones and roots, and the alpha cut that dissolves the strip into the forest floor.
//          Map A = colour multiplier / 4 (RGB) + alpha. Map B = puddle, damp, polish, flatten.
//   STONE  256 x 256: sandstone and flint with strata, grains, pits and lichen flecks.
//   LEAVES 512 x 256 atlas of 4 x 2 painted leaves (beech, oak, hornbeam, hazel; fresh row and a
//          decayed, holed row), painted in a neutral light tan and tinted per instance.

import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { createNoise, createWorley, resampleBilinear, blurField, clamp, smoothstep, hash2 } from "@/lib/noise";
import { PATH_LENGTH } from "@/lib/sections/world";
import { RIBBON, pathProfile, pathBend, locate, PUDDLES } from "./pathMath";
import { TONES, MICRO_MEAN, LEAF_BASE, mixBytes, scaleBytes } from "./pathTones";

const TAU = Math.PI * 2;
const ANISOTROPY = 8;

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const PATH_TEX = {
  micro: 512,
  macroW: 128,
  macroH: 512,
  stone: 256,
  pebbles: 120, // painted pebbles in one micro tile (about 60 percent of them gathered in gravel patches)
  leafFragments: 56, // pressed leaf fragments in one micro tile
  crackCells: 15, // drying crack polygons per micro tile (about 16 cm each)
  rutOffset: 0.36, // metres of the two boot-wear lines either side of the wear centre
};

// ------------------------------------------------------------------------------------------------
// plumbing
// ------------------------------------------------------------------------------------------------
const ch = (v) => Math.max(0, Math.min(255, Math.round(v) || 0));
const css = (c, a = 1) => `rgba(${ch(c[0])},${ch(c[1])},${ch(c[2])},${Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1))})`;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// sRGB byte -> linear (0..1) lookup, for converting painted tones into multipliers
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function makeDataTexture(bytes, w, h, { srgb = false, tile = true, aniso = ANISOTROPY } = {}) {
  const tex = new THREE.DataTexture(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}

// Draw a primitive up to four times so it wraps across the tile borders (tileable painting).
function wrapDraw(size, x, y, r, fn) {
  fn(0, 0);
  const nx = x < r ? size : x > size - r ? -size : 0;
  const ny = y < r ? size : y > size - r ? -size : 0;
  if (nx) fn(nx, 0);
  if (ny) fn(0, ny);
  if (nx && ny) fn(nx, ny);
}

// Sobel height -> tangent space normal for rows y0..y1 (OpenGL convention, +Y = increasing v).
// `strength`: 4 means a height change of 1 over one texel of a 1024 map tilts the normal 63 degrees.
function normalRows(hgt, w, h, strength, y0, y1, out) {
  const k = (strength * (w / 1024)) / 2;
  for (let y = y0; y < y1; y++) {
    const ym = ((y + h - 1) % h) * w;
    const yc = y * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const l = (x + w - 1) % w;
      const r = (x + 1) % w;
      const a = hgt[ym + l];
      const b = hgt[ym + x];
      const c = hgt[ym + r];
      const d = hgt[yc + l];
      const f = hgt[yc + r];
      const g = hgt[yp + l];
      const hh = hgt[yp + x];
      const i2 = hgt[yp + r];
      const nx = -(c + 2 * f + i2 - (a + 2 * d + g)) * k;
      const ny = -(g + 2 * hh + i2 - (a + 2 * b + c)) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
}

// Canvas pixels (row 0 = top) -> RGBA bytes with row 0 = bottom (texture order).
function readFlipped(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const dst = new Uint8ClampedArray(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) dst.set(src.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
  return dst;
}
function heightFromCanvas(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) out[y * w + x] = src[(sy + x) * 4] / 255;
  }
  return out;
}

// 256 x 256 table of random values: a cheap per-pixel speckle source
function speckleTable(seed) {
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) t[i] = hash2(i & 255, i >> 8, seed + 4242);
  return t;
}

// ================================================================================================
// MICRO: compacted damp earth with pebbles, pressed leaves and drying cracks
// ================================================================================================
export function* paintPathMicro(S = PATH_TEX.micro) {
  const rng = createRng(8801);
  const noise = createNoise(8802);
  const SP = speckleTable(8803);
  const { canvas: baseCanvas, ctx: g } = makeCanvas(S, S);
  const { ctx: hc } = makeCanvas(S, S);

  // ---- 1. coarse tileable fields (128 x 128), upsampled ------------------------------------
  const K = 128;
  const A = new Float32Array(K * K); // large patches: clay buff against brown
  const Bf = new Float32Array(K * K); // mid scale mottling and damp pockets
  const C = new Float32Array(K * K); // compaction ridges (the tamped surface is never flat)
  const D = new Float32Array(K * K); // fine noise for the ragged alpha cut of the ribbon edge
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const i = y * K + x;
      A[i] = noise.fbm2(u * 4, v * 4, 4, 4, 4) * 0.5 + 0.5;
      Bf[i] = noise.fbm2(u * 18 + 3, v * 18 + 1, 3, 18, 18) * 0.5 + 0.5;
      C[i] = noise.ridged2(u * 12 + 7, v * 12 + 2, 3, 12, 12);
      D[i] = noise.fbm2(u * 24 + 9, v * 24 + 4, 3, 24, 24) * 0.5 + 0.5;
    }
  }
  const Af = resampleBilinear(A, K, K, S, S, true);
  const Bff = resampleBilinear(Bf, K, K, S, S, true);
  const Cf = resampleBilinear(C, K, K, S, S, true);
  const Df = resampleBilinear(D, K, K, S, S, true);
  yield;

  // ---- 2. base earth, painted straight into canvas orientation in row chunks ----------------
  const baseImg = g.createImageData(S, S);
  const hImg = hc.createImageData(S, S);
  const earth = TONES.earthMid;
  const buff = TONES.clayBuff;
  const peat = TONES.peat;
  const CH = 128;
  for (let y0 = 0; y0 < S; y0 += CH) {
    for (let y = y0; y < y0 + CH; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const o = i * 4;
        const sp = SP[((y & 255) << 8) | (x & 255)];
        const t1 = smoothstep(0.38, 0.62, Af[i]) * 0.75; // clay buff patches
        const t2 = smoothstep(0.62, 0.85, Bff[i]) * 0.5; // dark damp pockets
        const k = (0.8 + 0.3 * sp) * (0.92 + 0.16 * Cf[i]);
        let r = earth[0] + (buff[0] - earth[0]) * t1;
        let gg = earth[1] + (buff[1] - earth[1]) * t1;
        let b = earth[2] + (buff[2] - earth[2]) * t1;
        r += (peat[0] - r) * t2;
        gg += (peat[1] - gg) * t2;
        b += (peat[2] - b) * t2;
        baseImg.data[o] = r * k;
        baseImg.data[o + 1] = gg * k;
        baseImg.data[o + 2] = b * k;
        baseImg.data[o + 3] = 255;
        const hv = (0.28 + 0.26 * Bff[i] + 0.14 * Cf[i] + 0.05 * sp) * 255;
        hImg.data[o] = hImg.data[o + 1] = hImg.data[o + 2] = hv;
        hImg.data[o + 3] = 255;
      }
    }
    yield;
  }
  g.putImageData(baseImg, 0, 0);
  hc.putImageData(hImg, 0, 0);

  // ---- 3. pressed leaf fragments: flattened, mud coloured pieces trodden into the earth ----------
  const fragTones = [
    mixBytes(TONES.barkDark, TONES.earthMid, 0.35),
    mixBytes(TONES.earthMid, TONES.peat, 0.5),
    scaleBytes(mixBytes(TONES.earthMid, TONES.fringeMoss, 0.35), 0.85),
    scaleBytes(TONES.earthMid, 0.7),
  ];
  for (let n = 0; n < PATH_TEX.leafFragments; n++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = range(rng, 6, 21);
    const col = fragTones[Math.floor(rng() * fragTones.length)];
    const rot = rng() * TAU;
    const pts = [];
    const m = 11;
    for (let k = 0; k < m; k++) {
      const a = (k / m) * TAU;
      // a leaf-like long oval with a ragged, broken margin
      const rr = r * (0.55 + 0.45 * rng()) * (1 + 0.45 * Math.cos(2 * a));
      pts.push([Math.cos(a) * rr * 1.5, Math.sin(a) * rr * 0.75]);
    }
    wrapDraw(S, x, y, r * 2, (dx, dy) => {
      g.save();
      g.translate(x + dx, y + dy);
      g.rotate(rot);
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = css(col, 0.45);
      g.fill();
      // midrib scratch
      g.strokeStyle = css(scaleBytes(col, 1.45), 0.4);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-r * 1.2, 0);
      g.lineTo(r * 1.2, 0);
      g.stroke();
      g.restore();
      hc.save();
      hc.translate(x + dx, y + dy);
      hc.rotate(rot);
      hc.beginPath();
      pts.forEach((p, k) => (k ? hc.lineTo(p[0], p[1]) : hc.moveTo(p[0], p[1])));
      hc.closePath();
      hc.fillStyle = "rgba(150,150,150,0.3)";
      hc.fill();
      hc.restore();
    });
  }
  yield;

  // ---- 4. pebbles, mostly small, a few large, pressed in with a soil collar --------------------
  const pebbleCols = [
    { w: 0.34, c: TONES.stoneFlint },
    { w: 0.3, c: TONES.stoneSand },
    { w: 0.16, c: mixBytes(TONES.stoneFlint, TONES.clayBuff, 0.6) },
    { w: 0.12, c: scaleBytes(TONES.stoneFlint, 0.55) },
    { w: 0.08, c: mixBytes(TONES.stoneSand, TONES.stoneFlint, 0.5) },
  ];
  const pickPebble = () => {
    let r = rng();
    for (const p of pebbleCols) {
      r -= p.w;
      if (r <= 0) return p.c;
    }
    return pebbleCols[0].c;
  };
  // washed gravel collects in patches: a handful of centres hold most of the pebbles
  const gravel = [];
  for (let i = 0; i < 7; i++) gravel.push([rng() * S, rng() * S, range(rng, 22, 46)]);
  for (let n = 0; n < PATH_TEX.pebbles; n++) {
    let x = rng() * S;
    let y = rng() * S;
    if (rng() < 0.6) {
      const c = gravel[Math.floor(rng() * gravel.length)];
      const a = rng() * TAU;
      const rr = c[2] * Math.sqrt(-Math.log(1 - rng() * 0.98)) * 0.6; // gaussian-ish falloff
      x = (c[0] + Math.cos(a) * rr + S) % S;
      y = (c[1] + Math.sin(a) * rr + S) % S;
    }
    // many small, few large: r in px, 1.2 to 8 (about 0.6 to 4 cm radius)
    const r = 1.2 + 6.8 * Math.pow(rng(), 2.6);
    // pebbles are never clean: dusted with the local earth so they sit in the ground, not on it
    const col = scaleBytes(mixBytes(pickPebble(), TONES.earthMid, 0.34), range(rng, 0.7, 1.05));
    const rot = rng() * TAU;
    const asp = range(rng, 0.62, 1);
    wrapDraw(S, x, y, r * 2, (dx, dy) => {
      const cx = x + dx;
      const cy = y + dy;
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.scale(1, asp);
      // soil collar: darker, damp earth just around the stone
      g.beginPath();
      g.arc(r * 0.12, r * 0.2, r * 1.25, 0, TAU);
      g.fillStyle = "rgba(24,16,9,0.5)";
      g.fill();
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r);
      gr.addColorStop(0, css(scaleBytes(col, 1.14)));
      gr.addColorStop(0.65, css(col));
      gr.addColorStop(1, css(scaleBytes(col, 0.7)));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.restore();
      hc.save();
      hc.translate(cx, cy);
      hc.rotate(rot);
      hc.scale(1, asp);
      const hg = hc.createRadialGradient(0, 0, 0, 0, 0, r);
      hg.addColorStop(0, "rgb(235,235,235)");
      hg.addColorStop(0.8, "rgb(185,185,185)");
      hg.addColorStop(1, "rgb(120,120,120)");
      hc.fillStyle = hg;
      hc.beginPath();
      hc.arc(0, 0, r, 0, TAU);
      hc.fill();
      hc.restore();
    });
  }
  yield;

  // ---- 5. drying cracks: thin polygon network, only in the dry clay patches -------------------
  const CR = S >> 1;
  const wor = createWorley(8804, PATH_TEX.crackCells, PATH_TEX.crackCells, 0.9);
  const crack = new Float32Array(CR * CR);
  for (let y = 0; y < CR; y++) {
    const v = (y + 0.5) / CR;
    for (let x = 0; x < CR; x++) {
      const u = (x + 0.5) / CR;
      const wx = noise.perlin2(u * 6, v * 6, 6, 6) * 0.35;
      const wy = noise.perlin2(u * 6 + 4.4, v * 6 + 1.3, 6, 6) * 0.35;
      wor.sample(u * PATH_TEX.crackCells + wx, v * PATH_TEX.crackCells + wy);
      crack[y * CR + x] = 1 - smoothstep(0.0, 0.07, wor.f2 - wor.f1);
    }
  }
  const Ck = resampleBilinear(crack, CR, CR, S, S, true);
  yield;

  // ---- 6. read back, cavity (ambient occlusion) --------------------------------------------
  const rgba = readFlipped(g, S, S);
  const hgt = heightFromCanvas(hc, S, S);
  const cav = blurField(hgt, S, S, 5, true);
  yield;

  // ---- 7. final pass: cracks, damp hollows, roughness, AO, alpha cut noise ---------------------
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  for (let y0 = 0; y0 < S; y0 += CH) {
    for (let y = y0; y < y0 + CH; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const o = i * 4;
        const h = hgt[i];
        const cavity = h - cav[i];
        const sp = SP[(((y + 97) & 255) << 8) | ((x + 31) & 255)];
        const gate = smoothstep(0.35, 0.65, Af[i]); // cracks open in the dry clay, not the peaty patches
        const crk = Ck[i] * gate * 0.6;
        const damp = 1 - 0.28 * smoothstep(0.2, 0.0, cavity + 0.04);
        const k = (1 - 0.5 * crk) * damp;
        rgba[o] *= k;
        rgba[o + 1] *= k;
        rgba[o + 2] *= k;
        // alpha carries the cut noise (0.5 is neutral): lumpy at 5 to 10 cm with a little grit
        rgba[o + 3] = clamp(0.5 + (Df[i] - 0.5) * 1.4 + (sp - 0.5) * 0.1) * 255;
        hgt[i] = h - 0.3 * crk;
        // pebbles and polished lumps are smoother, cracks and hollows rougher
        rough[i] = clamp(0.86 - 0.09 * smoothstep(0.55, 0.9, h) + 0.1 * crk - 0.06 * smoothstep(0.1, -0.08, cavity) + 0.04 * (sp - 0.5));
        ao[i] = clamp(0.62 + cavity * 4.2 - 0.3 * crk, 0.2, 1);
      }
    }
    yield;
  }

  // ---- 8. normal map, then the textures ---------------------------------------------------------
  const nrm = new Uint8ClampedArray(S * S * 4);
  for (let y0 = 0; y0 < S; y0 += 256) {
    normalRows(hgt, S, S, 4.2, y0, Math.min(S, y0 + 256), nrm);
    yield;
  }
  const rg = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    rg[i * 4] = ao[i] * 255;
    rg[i * 4 + 1] = rough[i] * 255;
    rg[i * 4 + 3] = 255;
  }
  baseCanvas.width = baseCanvas.height = 1; // release the canvas memory
  return {
    map: makeDataTexture(rgba, S, S, { srgb: true }),
    normalMap: makeDataTexture(nrm, S, S),
    roughnessMap: makeDataTexture(rg, S, S),
  };
}

// ================================================================================================
// MACRO: the one-off map of where the dirt, the wear, the puddles and the edges are
// ================================================================================================
// The macro map stores, per pixel, the COLOUR MULTIPLIER that turns the micro texture into the wanted
// ground colour. Stored as M / MULT_RANGE * 255 (linear space, MULT_RANGE = 4, the shader multiplies it
// back). M is relative to the MEASURED mean linear albedo of the micro texture, so retuning the micro
// painter never shifts the colours of the path.
export const MACRO_MULT_RANGE = 4;

// Mean linear albedo (r, g, b, each 0..1) of the micro texture (call once after painting it).
export function measureMicroMean(map) {
  const d = map.image.data;
  const n = d.length / 4;
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    sum[0] += LIN[d[i * 4]];
    sum[1] += LIN[d[i * 4 + 1]];
    sum[2] += LIN[d[i * 4 + 2]];
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export function* paintPathMacro(layout, microMeanLin = MICRO_MEAN.map((c) => LIN[ch(c)]), W = PATH_TEX.macroW, H = PATH_TEX.macroH) {
  const noise = createNoise(8301);
  const multByte = (c, i) => Math.min(255, (LIN[ch(c)] / microMeanLin[i]) * (255 / MACRO_MULT_RANGE));
  const LM = RIBBON.halfWidth;
  const total = PATH_LENGTH;
  const A = new Uint8ClampedArray(W * H * 4);
  const Bm = new Uint8ClampedArray(W * H * 4);
  const damp = new Float32Array(W * H); // damp, darker soil from stones and roots

  // metre coordinates -> pixel coordinates
  const px = (lat) => ((lat + LM) / (2 * LM)) * W - 0.5;
  const py = (along) => (along / total) * H - 0.5;
  const mPerPxX = (2 * LM) / W;
  const mPerPxY = total / H;
  const stamp = (along, lat, radius, value) => {
    const cx = px(lat);
    const cy = py(along);
    const rx = Math.ceil(radius / mPerPxX) + 1;
    const ry = Math.ceil(radius / mPerPxY) + 1;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x - cx) * mPerPxX, (y - cy) * mPerPxY);
        const v = value * (1 - smoothstep(radius * 0.55, radius, d));
        const i = y * W + x;
        if (v > damp[i]) damp[i] = v;
      }
    }
  };
  // stones: a damp, dark soil collar a hand's width round each one
  for (const st of layout.stones) {
    const l = locate(st.x, st.z);
    stamp(l.along, l.lateral, st.rMax + 0.2, 0.8);
  }
  // roots: soil in their shadow is darker and wetter
  for (const root of layout.roots.all) {
    for (let i = 0; i < root.rings.length - 1; i++) {
      const a = root.rings[i];
      const b = root.rings[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const l = locate(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (Math.abs(l.lateral) < LM) stamp(l.along, l.lateral, a.w + (b.w - a.w) * t + 0.1, 0.55);
      }
    }
  }
  yield;

  // per row profile (the dirt edges, the bend limit, the wear lines): 512 rows
  const rows = [];
  for (let y = 0; y < H; y++) {
    const s = (y + 0.5) / H;
    const along = s * total;
    const p = pathProfile(s);
    const bend = pathBend(s);
    const rutGate = 0.45 + 0.55 * smoothstep(-0.2, 0.5, noise.perlin2(along * 0.55, 61.7));
    rows.push({
      s,
      along,
      centre: p.centre,
      left: p.left,
      right: p.right,
      innerSide: bend.inner,
      limit: bend.limit,
      // the wear lines wander a little and are broken (people do not walk a perfect rail)
      rutL: p.centre - PATH_TEX.rutOffset * (1 + 0.18 * noise.perlin2(along * 0.4, 5.5)),
      rutR: p.centre + PATH_TEX.rutOffset * (1 + 0.18 * noise.perlin2(along * 0.4, 9.1)),
      rutGate,
      dry: noise.perlin2(along * 0.28, 71.3),
    });
  }

  const earth = TONES.earthMid;
  const buff = TONES.clayBuff;
  const peat = TONES.peat;
  const moss = TONES.fringeMoss;
  const rutCol = scaleBytes(mixBytes(buff, earth, 0.45), 0.9);
  const FR = RIBBON.fringe;
  const paintRows = (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      const R = rows[y];
      for (let x = 0; x < W; x++) {
        const lat = -LM + ((x + 0.5) / W) * 2 * LM;
        const i = y * W + x;
        const o = i * 4;
        // signed distance inside the dirt edge, with a ragged, two scale edge
        const dl = lat - R.centre;
        let ed = dl >= 0 ? R.right - dl : R.left + dl;
        ed += noise.perlin2(lat * 4.2 + 3.3, R.along * 0.9) * 0.11 + noise.perlin2(lat * 13 + 8, R.along * 3.1) * 0.045;

        const inDirt = smoothstep(-0.02, 0.28, ed);
        const centreK = Math.exp(-(dl * dl) / (2 * 0.3 * 0.3)) * inDirt; // buff, boot polished centre
        // wear lines
        const dRutL = lat - R.rutL;
        const dRutR = lat - R.rutR;
        const rut = Math.max(Math.exp(-(dRutL * dRutL) / (2 * 0.075 * 0.075)), Math.exp(-(dRutR * dRutR) / (2 * 0.075 * 0.075))) * R.rutGate * inDirt;
        // moss patches in the fringe and the outer dirt
        const mossN = noise.fbm2(lat * 3.1 + 5, R.along * 0.7 + 2, 3) * 0.5 + 0.5;
        const mossK = smoothstep(0.52, 0.8, mossN) * (1 - smoothstep(-0.05, 0.4, ed));
        const patch = noise.perlin2(lat * 1.3 + 9, R.along * 0.25) * 0.5 + 0.5;
        const dmp = damp[i];

        // colour: peat at the outer edge -> moss patches -> compacted earth -> buff centre
        let c = peat;
        c = lerp3(c, moss, mossK * 0.85);
        c = lerp3(c, earth, smoothstep(-0.28, 0.3, ed));
        c = lerp3(c, buff, centreK * (0.78 + 0.22 * R.dry));
        c = lerp3(c, rutCol, rut * 0.55);
        const lum = (0.9 + 0.2 * patch) * (1 - 0.34 * dmp);
        A[o] = multByte(c[0] * lum, 0);
        A[o + 1] = multByte(c[1] * lum, 1);
        A[o + 2] = multByte(c[2] * lum, 2);

        // alpha: opaque on the dirt and its fringe, ragged cut beyond (the micro noise adds grit),
        // fade at the trodden foot of the trunk, and a soft trim on the INSIDE of the tight elbows
        let a = smoothstep(-FR - 0.1, -FR + 0.22, ed);
        const onInner = (R.innerSide > 0 && lat > 0) || (R.innerSide < 0 && lat < 0);
        if (onInner) a *= 1 - smoothstep(R.limit - 0.3, R.limit - 0.02, Math.abs(lat));
        a *= smoothstep(1.0, 0.955, R.s + 0.014 * noise.perlin2(lat * 6, 77));
        A[o + 3] = a * 255;

        // map B: puddle, damp, polish, flatten
        let pud = 0;
        let halo = 0;
        for (const pd of PUDDLES) {
          const da = (R.along - pd.s * total) / pd.ra;
          const dlat = (lat - pd.lateral) / pd.rl;
          if (da * da + dlat * dlat > 6) continue;
          // ragged outline: warp the radius by two scales of noise
          const wob = 1 + 0.22 * noise.perlin2(lat * 3.3 + pd.seed * 9, R.along * 1.6) + 0.1 * noise.perlin2(lat * 9, R.along * 4 + pd.seed);
          const q = Math.hypot(da, dlat) / wob;
          pud = Math.max(pud, 1 - smoothstep(0.78, 1.0, q));
          halo = Math.max(halo, 1 - smoothstep(0.85, 1.9, q));
        }
        // the dirt edge is always a little damper than the centre (shade, run-off, leaf mould)
        const edgeDamp = 0.3 * (1 - smoothstep(-0.1, 0.5, ed));
        Bm[o] = pud * 255;
        Bm[o + 1] = clamp(halo * 0.85 + dmp * 0.7 + edgeDamp * (1 - pud)) * 255;
        Bm[o + 2] = clamp(centreK * 0.55 + rut * 0.7) * 255;
        Bm[o + 3] = pud * 255;
      }
    }
  };
  for (let y0 = 0; y0 < H; y0 += 128) {
    paintRows(y0, Math.min(H, y0 + 128));
    yield;
  }
  return {
    macroA: makeDataTexture(A, W, H, { tile: false, aniso: 4 }),
    macroB: makeDataTexture(Bm, W, H, { tile: false, aniso: 4 }),
  };
}

// ================================================================================================
// STONE: sandstone and flint (one texture, tinted per stone)
// ================================================================================================
export function* paintStoneTexture(S = PATH_TEX.stone) {
  const noise = createNoise(8501);
  const SP = speckleTable(8502);
  const sand = TONES.stoneSand;
  const flint = TONES.stoneFlint;
  const mossC = TONES.stoneMoss;
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const K = 64;
  const F1 = new Float32Array(K * K);
  const F2 = new Float32Array(K * K);
  const F3 = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const v = (y + 0.5) / K;
      F1[y * K + x] = noise.fbm2(u * 3, v * 3, 4, 3, 3) * 0.5 + 0.5; // sand against flint
      F2[y * K + x] = noise.fbm2(u * 9 + 3, v * 9, 3, 9, 9) * 0.5 + 0.5; // pits and weathering
      F3[y * K + x] = noise.fbm2(u * 6 + 1, v * 6 + 8, 3, 6, 6) * 0.5 + 0.5; // lichen
    }
  }
  const f1 = resampleBilinear(F1, K, K, S, S, true);
  const f2 = resampleBilinear(F2, K, K, S, S, true);
  const f3 = resampleBilinear(F3, K, K, S, S, true);
  yield;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const o = i * 4;
      const sp = SP[((y & 255) << 8) | (x & 255)];
      const sp2 = SP[(((y * 3 + 11) & 255) << 8) | ((x * 5 + 7) & 255)];
      // strata: wavy bands, the signature of sandstone
      const band = 0.5 + 0.5 * Math.sin((v * 5 + (f2[i] - 0.5) * 1.4) * TAU);
      const t = smoothstep(0.35, 0.65, f1[i]);
      let c = lerp3(sand, flint, t * 0.85);
      const k = (0.88 + 0.12 * band + 0.18 * sp) * (0.9 + 0.2 * f2[i]);
      let r = c[0] * k;
      let gg = c[1] * k;
      let b = c[2] * k;
      // pits: small dark dimples where the soft grains weathered out
      const pit = smoothstep(0.7, 0.9, f2[i] * 0.6 + sp2 * 0.5);
      r *= 1 - 0.38 * pit;
      gg *= 1 - 0.38 * pit;
      b *= 1 - 0.38 * pit;
      // pale, crusty lichen flecks
      const lich = smoothstep(0.62, 0.8, f3[i]) * smoothstep(0.55, 0.95, sp2) * 0.75;
      r += (178 - r) * lich;
      gg += (182 - gg) * lich;
      b += (150 - b) * lich;
      // faint green-grey damp on the lower strata
      const dampG = smoothstep(0.6, 0.9, f3[i] * 0.7 + (1 - band) * 0.3) * 0.2;
      r += (mossC[0] - r) * dampG;
      gg += (mossC[1] - gg) * dampG;
      b += (mossC[2] - b) * dampG;
      rgba[o] = r;
      rgba[o + 1] = gg;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      hgt[i] = 0.5 + 0.18 * band + 0.1 * (f2[i] - 0.5) + 0.05 * sp - 0.18 * pit + 0.05 * lich;
      rough[i] = clamp(0.82 + 0.08 * (sp - 0.5) + 0.08 * pit + 0.05 * lich - 0.06 * (1 - band));
      ao[i] = clamp(1 - 0.5 * pit);
    }
  }
  yield;
  const nrm = new Uint8ClampedArray(S * S * 4);
  normalRows(hgt, S, S, 3.2, 0, S, nrm);
  const rg = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    rg[i * 4] = ao[i] * 255;
    rg[i * 4 + 1] = rough[i] * 255;
    rg[i * 4 + 3] = 255;
  }
  return {
    map: makeDataTexture(rgba, S, S, { srgb: true, tile: false }),
    normalMap: makeDataTexture(nrm, S, S, { tile: false }),
    roughnessMap: makeDataTexture(rg, S, S, { tile: false }),
  };
}

// ================================================================================================
// LEAF ATLAS: 4 columns (beech, oak, hornbeam, hazel) x 2 rows (fresh, decayed with holes)
// ================================================================================================
export const LEAF_ATLAS = { cols: 4, rows: 2, cell: 128 };

// Replace the colour of transparent pixels by the mean colour of the opaque ones so mip filtering
// never mixes leaf colour with black (the same fix the hero card textures use).
function bleedRegion(ctx, x0, y0, w, h) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  if (!n) return;
  r /= n;
  g /= n;
  b /= n;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, x0, y0);
}

// Half width of each species' leaf at t (0 = base, 1 = tip), as a fraction of the leaf length.
const LEAF_PROFILE = [
  // beech: oval, pointed tip, gently wavy margin
  (t) => 0.38 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.9) * (1 + 0.035 * Math.sin(t * TAU * 9)),
  // oak: lobes
  (t) => 0.3 * (0.52 + 0.48 * Math.pow(Math.abs(Math.sin(t * Math.PI * 4.5 + 0.4)), 0.6)) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.7),
  // hornbeam: narrower, finely toothed
  (t) => 0.28 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.85) * (1 + 0.06 * Math.sin(t * TAU * 20)),
  // hazel: round, broad
  (t) => 0.44 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) * (1 + 0.05 * Math.sin(t * TAU * 7)),
];
const LEAF_VEINS = [8, 5, 11, 7]; // pairs of side veins

export function* paintLeafAtlas() {
  const { cols, rows, cell } = LEAF_ATLAS;
  const { canvas, ctx: g } = makeCanvas(cols * cell, rows * cell);
  const rng = createRng(8601);
  const base = LEAF_BASE;
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < cols; k++) {
      const ox = k * cell;
      const oy = row * cell;
      const cx = ox + cell / 2;
      const baseY = oy + cell - 9;
      const L = cell * 0.84;
      const bend = (rng() - 0.5) * 0.12 * L;
      const asym = [range(rng, 0.92, 1.08), range(rng, 0.92, 1.08)];
      const decayed = row === 1;
      const hw = (t, side) => LEAF_PROFILE[k](t) * L * asym[side];
      const outline = () => {
        g.beginPath();
        const steps = 56;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = cx - hw(t, 0) + bend * Math.sin(Math.PI * t);
          const y = baseY - t * L;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        for (let i = steps; i >= 0; i--) {
          const t = i / steps;
          g.lineTo(cx + hw(t, 1) + bend * Math.sin(Math.PI * t), baseY - t * L);
        }
        g.closePath();
      };
      g.save();
      outline();
      g.clip();
      // base fill: light neutral tan, a little lighter toward the tip, darker toward the base
      const grad = g.createLinearGradient(cx, baseY, cx, baseY - L);
      grad.addColorStop(0, css(scaleBytes(base, 0.88)));
      grad.addColorStop(1, css(scaleBytes(base, 1.04)));
      g.fillStyle = grad;
      g.fillRect(ox, oy, cell, cell);
      // mottling: damp dark patches and bleached flecks; heavier on a decayed leaf
      const blots = decayed ? 120 : 60;
      for (let i = 0; i < blots; i++) {
        const dark = rng() < (decayed ? 0.72 : 0.6);
        g.fillStyle = dark ? css(scaleBytes(base, 0.42), decayed ? 0.3 : 0.2) : css(scaleBytes(base, 1.15), 0.14);
        g.beginPath();
        g.arc(ox + rng() * cell, oy + rng() * cell, range(rng, 1.5, decayed ? 9 : 6), 0, TAU);
        g.fill();
      }
      // veins: midrib and side veins (lighter than the blade, more visible on the decayed leaf)
      const veinCol = css(scaleBytes(base, 1.16), decayed ? 0.7 : 0.5);
      g.strokeStyle = veinCol;
      g.lineWidth = decayed ? 2.2 : 1.8;
      g.beginPath();
      g.moveTo(cx, baseY + 4);
      for (let i = 1; i <= 24; i++) {
        const t = (i / 24) * 0.96;
        g.lineTo(cx + bend * Math.sin(Math.PI * t), baseY - t * L);
      }
      g.stroke();
      g.lineWidth = decayed ? 1.3 : 1;
      g.strokeStyle = css(scaleBytes(base, 1.14), decayed ? 0.55 : 0.34);
      const pairs = LEAF_VEINS[k];
      for (let i = 1; i <= pairs; i++) {
        const t = (i / (pairs + 1.2)) * 0.95;
        const mx = cx + bend * Math.sin(Math.PI * t);
        const my = baseY - t * L;
        for (const side of [0, 1]) {
          const sgn = side ? 1 : -1;
          const reach = hw(Math.min(t + 0.1, 1), side) * 0.86;
          g.beginPath();
          g.moveTo(mx, my);
          g.quadraticCurveTo(mx + sgn * reach * 0.55, my - reach * 0.1, mx + sgn * reach, my - reach * (k === 2 ? 0.75 : 0.5));
          g.stroke();
        }
      }
      // holes, tears and a missing tip on the decayed row
      if (decayed) {
        g.globalCompositeOperation = "destination-out";
        const holes = 4 + Math.floor(rng() * 5);
        for (let i = 0; i < holes; i++) {
          const t = range(rng, 0.2, 0.85);
          g.beginPath();
          g.ellipse(cx + range(rng, -1, 1) * LEAF_PROFILE[k](t) * L * 0.6, baseY - t * L, range(rng, 2, 8), range(rng, 2, 6), rng() * 3, 0, TAU);
          g.fill();
        }
        // torn tip: cut off a ragged wedge
        const cut = range(rng, 0.8, 0.94);
        g.beginPath();
        g.moveTo(cx - cell, baseY - cut * L);
        for (let i = 0; i <= 8; i++) g.lineTo(cx - cell * 0.5 + i * (cell / 8) + range(rng, -3, 3), baseY - cut * L - range(rng, 0, 7));
        g.lineTo(cx + cell, baseY - cut * L);
        g.lineTo(cx + cell, oy - 5);
        g.lineTo(cx - cell, oy - 5);
        g.closePath();
        if (rng() < 0.7) g.fill();
        g.globalCompositeOperation = "source-over";
      }
      g.restore();
      // darker rim so the silhouette reads against the ground
      g.strokeStyle = css(scaleBytes(base, 0.5), 0.6);
      g.lineWidth = 1.4;
      outline();
      g.stroke();
      bleedRegion(g, ox, oy, cell, cell);
    }
    yield;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { atlas: tex };
}

// Dispose every texture in a set returned by one of the painters.
export function disposeTextureSet(set) {
  if (!set) return;
  for (const k of Object.keys(set)) if (set[k] && set[k].isTexture) set[k].dispose();
}
