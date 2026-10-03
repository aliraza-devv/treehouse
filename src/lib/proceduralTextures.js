// Procedural PBR texture toolkit for the hero scene.
//
// BROWSER ONLY (canvas 2D for the painted textures). Call these inside useMemo in components that
// live under <Canvas> (they never run during SSR there). Every function is seeded and
// deterministic, and every result is CACHED by its parameters, so repeated calls are free and
// return the SAME texture objects. Because of that, never mutate repeat / offset / rotation of a
// returned texture directly (it would change every other user); use withRepeat() which returns
// cheap clones that share the GPU upload.
//
// Conventions
//   - albedo (map)               SRGBColorSpace
//   - normalMap                  NoColorSpace, OpenGL / three.js convention (+Y up in UV space)
//   - roughnessMap               NoColorSpace, RGBA. G = roughness, R = ambient occlusion (cavity)
//                                so the same texture can be used as roughnessMap AND aoMap.
//   - anisotropy 8, trilinear mipmaps, RepeatWrapping where the texture tiles.
//   - alpha cards (leaf, fern) are clamped, RGBA, with colour BLED into transparent pixels and an
//     alpha-coverage-preserving mip chain, so they neither halo nor thin out with distance.
//
// Internally every scalar field uses row 0 = v 0 (bottom of the texture), see noise.js.

import * as THREE from "three";
import { createRng } from "./random.js";
import { PALETTE } from "./sceneConfig.js";
import {
  createNoise,
  createWorley,
  fillFbm,
  resampleBilinear,
  blurField,
  clamp,
  mix,
  smoothstep,
  hash2,
} from "./noise.js";

const ANISOTROPY = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Generation time per texture set in ms, keyed by call signature (read by the temporary lab page
// and handy in dev tools: import { textureTimings }).
export const textureTimings = {};

const cache = new Map();

function cached(name, opts, build) {
  const key = `${name}:${JSON.stringify(opts)}`;
  let hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") {
    throw new Error("proceduralTextures: browser only (needs canvas). Call inside useMemo under <Canvas>.");
  }
  const t0 = performance.now();
  hit = build();
  textureTimings[key] = performance.now() - t0;
  cache.set(key, hit);
  return hit;
}

// Free every cached texture (call on hot reload or when leaving the scene for good).
export function disposeTextureCache() {
  for (const set of cache.values()) {
    for (const k of Object.keys(set)) if (set[k] && set[k].isTexture) set[k].dispose();
  }
  cache.clear();
}

// ------------------------------------------------------------------------------------------------
// Small colour helpers (values are sRGB bytes 0..255, blended as authored)
// ------------------------------------------------------------------------------------------------
function rgbOf(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Clamps and coerces every channel: one NaN reaching a canvas gradient colour stop throws, and the
// whole page then falls back to the static image. Bad input becomes black instead.
const ch = (v) => Math.max(0, Math.min(255, Math.round(v) || 0));
const css = (c, a = 1) => `rgba(${ch(c[0])},${ch(c[1])},${ch(c[2])},${Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1))})`;
const scale3 = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ------------------------------------------------------------------------------------------------
// Texture / data plumbing
// ------------------------------------------------------------------------------------------------
function makeTexture(bytes, w, h, { srgb = false, tile = true, mipmaps = null } = {}) {
  const tex = new THREE.DataTexture(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length),
    w,
    h,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = ANISOTROPY;
  tex.generateMipmaps = !mipmaps;
  if (mipmaps) tex.mipmaps = mipmaps;
  tex.needsUpdate = true;
  return tex;
}

// Height field -> tangent space normal map (OpenGL convention, +Y = increasing v).
// Sobel kernel. `strength` is resolution independent: 4 means a height change of 1.0 across one
// texel of a 1024 texture tilts the normal 63 degrees (a texture of another size is rescaled). wrapX / wrapY make tileable textures
// sample across the border so no seam appears in the lighting.
function heightToNormal(hgt, w, h, strength, wrapX = true, wrapY = true) {
  const out = new Uint8ClampedArray(w * h * 4);
  const k = (strength * (w / 1024)) / 2;
  const xm = new Int32Array(w);
  const xp = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    xm[x] = x > 0 ? x - 1 : wrapX ? w - 1 : 0;
    xp[x] = x < w - 1 ? x + 1 : wrapX ? 0 : w - 1;
  }
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : wrapY ? h - 1 : 0) * w;
    const yc = y * w;
    const yp = (y < h - 1 ? y + 1 : wrapY ? 0 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const l = xm[x];
      const r = xp[x];
      const a = hgt[ym + l];
      const b = hgt[ym + x];
      const c = hgt[ym + r];
      const d = hgt[yc + l];
      const f = hgt[yc + r];
      const g = hgt[yp + l];
      const hh = hgt[yp + x];
      const i2 = hgt[yp + r];
      const dx = c + 2 * f + i2 - (a + 2 * d + g);
      const dy = g + 2 * hh + i2 - (a + 2 * b + c);
      const nx = -dx * k;
      const ny = -dy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Pack roughness + ambient occlusion into one RGBA texture (R = AO, G = roughness).
function packRoughAO(rough, ao, n) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = ao[i] * 255;
    out[o + 1] = rough[i] * 255;
    out[o + 2] = 0;
    out[o + 3] = 255;
  }
  return out;
}

// Standard opaque PBR set from float planes.
function pbrSet(rgba, hgt, rough, ao, w, h, normalStrength, { wrapX = true, wrapY = true } = {}) {
  const normal = heightToNormal(hgt, w, h, normalStrength, wrapX, wrapY);
  return {
    map: makeTexture(rgba, w, h, { srgb: true }),
    normalMap: makeTexture(normal, w, h),
    roughnessMap: makeTexture(packRoughAO(rough, ao, w * h), w, h),
  };
}

// Draw a primitive up to four times so it wraps across the tile borders (tileable painting).
// fn(dx, dy) draws the primitive translated by (dx, dy). r = bounding radius in pixels.
function wrapDraw(size, x, y, r, fn) {
  fn(0, 0);
  const nx = x < r ? size : x > size - r ? -size : 0;
  const ny = y < r ? size : y > size - r ? -size : 0;
  if (nx) fn(nx, 0);
  if (ny) fn(0, ny);
  if (nx && ny) fn(nx, ny);
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  return { canvas: c, ctx };
}

// Canvas pixels (row 0 = top) -> RGBA bytes with row 0 = bottom (texture order).
function readCanvasFlipped(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const dst = new Uint8ClampedArray(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    dst.set(src.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
  }
  return dst;
}

// Gray height canvas -> Float32 field (0..1, row 0 = bottom).
function canvasToHeight(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (h - 1 - y) * w;
    const dy = y * w;
    for (let x = 0; x < w; x++) out[dy + x] = src[(sy + x) * 4] / 255;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Alpha cards: colour bleed + coverage preserving mip chain
// ------------------------------------------------------------------------------------------------

// Replace the RGB of (nearly) transparent pixels by the local mean colour of the opaque pixels, so
// bilinear / mip filtering never mixes leaf colour with black. Edge pixels keep their own colour.
function bleedColour(rgba, w, h) {
  const B = 8;
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const sr = new Float32Array(gw * gh);
  const sg = new Float32Array(gw * gh);
  const sb = new Float32Array(gw * gh);
  const sa = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = rgba[o + 3];
      if (a === 0) continue;
      const g = gy * gw + ((x / B) | 0);
      sr[g] += rgba[o] * a;
      sg[g] += rgba[o + 1] * a;
      sb[g] += rgba[o + 2] * a;
      sa[g] += a;
    }
  }
  const cr = new Float32Array(gw * gh);
  const cg = new Float32Array(gw * gh);
  const cb = new Float32Array(gw * gh);
  const filled = new Uint8Array(gw * gh);
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mw = 0;
  for (let g = 0; g < gw * gh; g++) {
    if (sa[g] > 0) {
      cr[g] = sr[g] / sa[g];
      cg[g] = sg[g] / sa[g];
      cb[g] = sb[g] / sa[g];
      filled[g] = 1;
      mr += sr[g];
      mg += sg[g];
      mb += sb[g];
      mw += sa[g];
    }
  }
  if (mw === 0) return;
  mr /= mw;
  mg /= mw;
  mb /= mw;
  // Propagate into empty blocks (a few 8-neighbour passes), then fall back to the global mean.
  for (let pass = 0; pass < 8; pass++) {
    const nf = filled.slice();
    let any = false;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (filled[g]) continue;
        let n = 0;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x2 = gx + dx;
            const y2 = gy + dy;
            if (x2 < 0 || y2 < 0 || x2 >= gw || y2 >= gh) continue;
            const g2 = y2 * gw + x2;
            if (!filled[g2]) continue;
            n++;
            r += cr[g2];
            gg += cg[g2];
            b += cb[g2];
          }
        }
        if (n) {
          cr[g] = r / n;
          cg[g] = gg / n;
          cb[g] = b / n;
          nf[g] = 1;
          any = true;
        }
      }
    }
    filled.set(nf);
    if (!any) break;
  }
  for (let g = 0; g < gw * gh; g++) {
    if (!filled[g]) {
      cr[g] = mr;
      cg[g] = mg;
      cb[g] = mb;
    }
  }
  for (let y = 0; y < h; y++) {
    const gy = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = rgba[o + 3];
      if (a >= 200) continue;
      const g = gy * gw + ((x / B) | 0);
      const wgt = a < 8 ? 0 : smoothstep(8, 160, a);
      rgba[o] = cr[g] + (rgba[o] - cr[g]) * wgt;
      rgba[o + 1] = cg[g] + (rgba[o + 1] - cg[g]) * wgt;
      rgba[o + 2] = cb[g] + (rgba[o + 2] - cb[g]) * wgt;
    }
  }
}

// Box-filter mip chain. When `coverage` is true, the alpha of each level is rescaled so the
// fraction of pixels passing alphaTest (>= 128) stays what it was at level 0. Without this,
// alpha-cut leaves visibly thin out and vanish with distance.
function buildMipChain(base, w, h, coverage) {
  const levels = [{ data: new Uint8Array(base.buffer, base.byteOffset, base.length), width: w, height: h }];
  let target = 0;
  if (coverage) {
    let n = 0;
    for (let i = 3; i < base.length; i += 4) if (base[i] >= 128) n++;
    target = n / (w * h);
  }
  let src = base;
  let sw = w;
  let sh = h;
  while (sw > 1 || sh > 1) {
    const dw = Math.max(1, sw >> 1);
    const dh = Math.max(1, sh >> 1);
    const dst = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      const y0 = Math.min(sh - 1, y * 2);
      const y1 = Math.min(sh - 1, y * 2 + 1);
      for (let x = 0; x < dw; x++) {
        const x0 = Math.min(sw - 1, x * 2);
        const x1 = Math.min(sw - 1, x * 2 + 1);
        const a = (y0 * sw + x0) * 4;
        const b = (y0 * sw + x1) * 4;
        const c = (y1 * sw + x0) * 4;
        const d = (y1 * sw + x1) * 4;
        const o = (y * dw + x) * 4;
        dst[o] = (src[a] + src[b] + src[c] + src[d]) * 0.25;
        dst[o + 1] = (src[a + 1] + src[b + 1] + src[c + 1] + src[d + 1]) * 0.25;
        dst[o + 2] = (src[a + 2] + src[b + 2] + src[c + 2] + src[d + 2]) * 0.25;
        dst[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3]) * 0.25;
      }
    }
    if (coverage && dw * dh > 4) {
      // Find the alpha threshold T such that target fraction of pixels have alpha >= T, then scale
      // alpha by 128 / T so that exactly those pixels pass the 0.5 alpha test.
      const hist = new Uint32Array(256);
      for (let i = 3; i < dst.length; i += 4) hist[dst[i]]++;
      const need = target * dw * dh;
      let acc = 0;
      let T = 255;
      for (let v = 255; v >= 1; v--) {
        acc += hist[v];
        if (acc >= need) {
          T = v;
          break;
        }
      }
      const k = T > 0 ? 128 / T : 1;
      if (k !== 1) for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, dst[i] * k);
    }
    levels.push({ data: new Uint8Array(dst.buffer), width: dw, height: dh });
    src = dst;
    sw = dw;
    sh = dh;
  }
  return levels;
}

// RGBA card set: albedo with alpha cut-out + normal map. Clamped, mip chain with coverage fix.
function cardSet(rgba, normalRgba, w, h) {
  bleedColour(rgba, w, h);
  return {
    map: makeTexture(rgba, w, h, { srgb: true, tile: false, mipmaps: buildMipChain(rgba, w, h, true) }),
    normalMap: makeTexture(normalRgba, w, h, { tile: false }),
  };
}

// ------------------------------------------------------------------------------------------------
// Clone helper. Textures are cached and shared, so per-use repeat / rotation / offset lives on
// CLONES (they share the same GPU upload).
//   const bark = withRepeat(createBarkTextures({ seed: 3 }), 1, 3);
//   withRepeat(set, 2, 6, { rotation: Math.PI / 2 })      // rotate grain to run horizontally
// Returns a new object with the same keys as `set` (map, normalMap, roughnessMap, ...).
// Clones are memoised per (set, repeat, rotation, offset) so calling it every render is fine.
// ------------------------------------------------------------------------------------------------
const cloneCache = new WeakMap();
export function withRepeat(set, rx = 1, ry = rx, { rotation = 0, offset = [0, 0] } = {}) {
  let inner = cloneCache.get(set);
  if (!inner) {
    inner = new Map();
    cloneCache.set(set, inner);
  }
  const key = `${rx}|${ry}|${rotation}|${offset[0]}|${offset[1]}`;
  let hit = inner.get(key);
  if (hit) return hit;
  hit = {};
  for (const k of Object.keys(set)) {
    const t = set[k];
    if (t && t.isTexture) {
      const c = t.clone();
      c.repeat.set(rx, ry);
      c.offset.set(offset[0], offset[1]);
      c.center.set(0.5, 0.5);
      c.rotation = rotation;
      c.needsUpdate = true;
      hit[k] = c;
    } else hit[k] = t;
  }
  inner.set(key, hit);
  return hit;
}

// ================================================================================================
// BARK
// ================================================================================================
// Deep vertical fissures between flaking plates (anisotropic periodic Worley cells, warped, plus
// ridged creases and cross checks), mottled warm brown, grey-green lichen on the ridge tops and
// optional moss. SEAMLESS in U (wraps round a trunk) and tileable in V.
//
// World mapping hint: the U axis covers one circumference. A tile is roughly square in world
// space when repeat = (1, trunkHeight / circumference), e.g. (1, 3) for the hero trunk.
//   tone   optional hex string overriding the base bark colour (default PALETTE bark mix)
//   moss   0..1 amount of moss in the crevices (default 0.25)
//   lichen 0..1 amount of grey-green lichen speckle (default 0.5)
export function createBarkTextures({ seed = 7, size = 768, tone = null, moss = 0.25, lichen = 0.5 } = {}) {
  return cached("bark", { seed, size, tone, moss, lichen }, () => buildBark(seed, size, tone, moss, lichen));
}


// 256x256 table of random values: a cheap per-pixel speckle source (hash2 per pixel is too slow).
function speckleTable(seed) {
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) t[i] = hash2(i & 255, i >> 8, seed + 4242);
  return t;
}

// Tileable fibre noise (128x128, periodic): many cells across, few along, i.e. vertical fibres.
function fibreTable(noise, fx, fy) {
  const t = new Float32Array(128 * 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      t[y * 128 + x] = noise.perlin2((x / 128) * fx, (y / 128) * fy, fx, fy) * 0.7 + noise.perlin2((x / 128) * fx * 2.3, (y / 128) * fy * 2, Math.round(fx * 2.3), fy * 2) * 0.3;
    }
  }
  return t;
}

// Periodic bilinear lookup into a coarse N*N field, u and v in [0, 1).
function bil(arr, N, u, v) {
  const fx = u * N - 0.5;
  const fy = v * N - 0.5;
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  x0 = (x0 + N) % N;
  y0 = (y0 + N) % N;
  x1 %= N;
  y1 %= N;
  const a = arr[y0 * N + x0];
  const b = arr[y0 * N + x1];
  const c = arr[y1 * N + x0];
  const d = arr[y1 * N + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function buildBark(seed, S, tone, mossAmt, lichenAmt) {
  const K = Math.max(128, S >> 1); // the fissure network is computed at half resolution then upsampled
  const noise = createNoise(seed);
  const NX = 15; // ridges around the circumference
  const NY = 1; // one cell along a tile: ridges run about 15x longer than wide, like oak furrows, not scales
  const wor = createWorley(seed + 11, NX, NY, 0.9);
  const SP = speckleTable(seed);
  const FIB = fibreTable(noise, 24, 3);

  // Coarse fields (128^2): warps, fissure width, tone, moss. All periodic.
  const N = 128;
  const fWX = new Float32Array(N * N);
  const fWY = new Float32Array(N * N);
  const fWN = new Float32Array(N * N);
  const fT = new Float32Array(N * N);
  const fL = new Float32Array(N * N);
  const fM = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const i = y * N + x;
      fWX[i] = noise.fbm2(u * 3, v * 3, 3, 3, 3);
      fWY[i] = noise.fbm2(u * 3 + 9.2, v * 3 + 4.1, 3, 3, 3);
      fWN[i] = noise.fbm2(u * 5 + 3, v * 5 + 8, 2, 5, 5) * 0.5 + 0.5;
      fT[i] = noise.fbm2(u * 6 + 1, v * 3 + 2, 3, 6, 3);
      fL[i] = noise.fbm2(u * 7 + 5, v * 7 + 1, 3, 7, 7);
      fM[i] = noise.fbm2(u * 4 + 2, v * 4 + 6, 3, 4, 4);
    }
  }

  const Hk = new Float32Array(K * K);
  const Tk = new Float32Array(K * K);
  const Ck = new Float32Array(K * K); // lichen crust discs
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const i = y * K + x;
      const wx = bil(fWX, N, u, v);
      const wy = bil(fWY, N, u, v);
      const wn = bil(fWN, N, u, v);
      // Domain warp: displaces the lookup so fissures wander, fork and rejoin.
      wor.sample(u * NX + wx * 0.5, v * NY + wy * 0.06);
      // Fissures. 1) Voronoi borders of tall plates, widened and made ragged with stretched noise.
      const wv = 0.1 + 0.3 * wn;
      const rag = noise.perlin2(u * 60 + wx, v * 14 + wy, 60, 14) * 0.5 + noise.perlin2(u * 120 + 3.3, v * 28 + 1.7, 120, 28) * 0.25;
      const d = (wor.f2 - wor.f1) / wv + rag * 0.45;
      const ridge = smoothstep(0, 1, d);
      // 2) Narrow creases inside plates: zero contours of stretched multi-octave |noise|.
      const B = noise.billow2(u * 11 + wx * 1.1, v * 2.5 + wy * 0.35, 5, 11, 2, 0.6);
      const crease = smoothstep(0.1, 0.2, B);
      const plate = 0.6 + 0.4 * wor.id; // each plate sits at its own height
      // 3) longitudinal furrows on the plate surfaces
      const fur = 1 - Math.abs(noise.perlin2(u * 40 + wx * 2, v * 3 + wy, 40, 3));
      const furrow = smoothstep(0.82, 0.97, fur);
      Hk[i] = clamp(ridge * (0.5 + 0.5 * crease) * plate * (1 - 0.4 * furrow));
      Tk[i] = clamp(0.5 + (wor.id - 0.5) * 0.7 + bil(fT, N, u, v) * 0.4);
      // lichen: discrete crusty discs from a mid frequency noise, only where the coarse mask allows
      Ck[i] = noise.perlin2(u * 90, v * 60, 90, 60);
    }
  }
  const up = (f, n) => (n === S ? f : resampleBilinear(f, n, n, S, S, true));
  const Hf = up(Hk, K);
  const Tf = up(Tk, K);
  const Cf = up(Ck, K);
  const Lf = up(fL, N);
  const Mf = up(fM, N);

  const c0 = tone ? scale3(rgbOf(tone), 0.88) : rgbOf(PALETTE.barkDark);
  const c1 = tone ? scale3(rgbOf(tone), 1.08) : rgbOf(PALETTE.bark);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const h0 = Hf[i];
      const fib = FIB[(y & 127) * 128 + (x & 127)];
      const speck = SP[((y & 255) << 8) | (x & 255)];
      const speck2 = SP[(((y + 97) & 255) << 8) | ((x + 31) & 255)];
      const body = smoothstep(0.08, 0.4, h0);
      let h = h0 + 0.07 * fib * body;
      // base colour: warm brown between the two palette tones, per plate variation
      const T = Tf[i];
      let r = c0[0] + (c1[0] - c0[0]) * T;
      let g = c0[1] + (c1[1] - c0[1]) * T;
      let b = c0[2] + (c1[2] - c0[2]) * T;
      // real bark is a little less saturated than the palette: pull 12% toward its luminance
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      r = lum + (r - lum) * 0.88;
      g = lum + (g - lum) * 0.88;
      b = lum + (b - lum) * 0.88;
      // weathered grey-tan on the ridge tops
      const top = smoothstep(0.45, 0.85, h0);
      r += (120 - r) * 0.16 * top;
      g += (102 - g) * 0.16 * top;
      b += (84 - b) * 0.16 * top;
      // fibre tint + depth shading
      const cre = 1 - smoothstep(0, 0.2, h0);
      const shade = (0.5 + 0.5 * smoothstep(0.08, 0.6, h0)) * (1 + 0.28 * fib * body) * (0.93 + 0.14 * speck);
      r *= shade;
      g *= shade;
      b *= shade;
      r += (22 - r) * cre * 0.8;
      g += (15 - g) * cre * 0.8;
      b += (9 - b) * cre * 0.8;
      // lichen: crusty grey-green discs on the ridge tops
      const lm = smoothstep(0.1, 0.4, Lf[i]) * lichenAmt * top * smoothstep(0.18, 0.4, Cf[i]);
      const lk = Math.min(1, lm * 1.4) * 0.6 * (0.7 + 0.3 * speck2);
      r += (144 - r) * lk;
      g += (150 - g) * lk;
      b += (118 - b) * lk;
      // moss: soft green cushions, mostly low on the plates and in the crevices
      const mw = smoothstep(0.25, 0.58, Mf[i]) * mossAmt * (0.4 + 0.6 * (1 - top));
      const mk = Math.min(1, mw * 2) * 0.75;
      const mv = 0.7 + 0.6 * speck2;
      r += (52 * mv - r) * mk;
      g += (78 * mv - g) * mk;
      b += (30 * mv - b) * mk;
      h += mk * 0.05 * speck + lk * 0.04;
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      hgt[i] = h;
      rough[i] = 0.86 + 0.12 * cre - 0.1 * lk * (1 - mk) - 0.03 * top + 0.1 * mk;
      ao[i] = 0.25 + 0.75 * smoothstep(0, 0.5, h0);
    }
  }
  return pbrSet(rgba, hgt, rough, ao, S, S, 5);
}

// ================================================================================================
// WOOD
// ================================================================================================
// Boards with grain (ring phase warped by noise and knots), pores, optional battens / gaps, nails,
// seasoning cracks and weathering. Grain runs along V. Tileable in U and V.
//   kind 'plank'     honey cedar board-and-batten cladding (4 boards, battens over the seams)
//        'weathered' silvered, cracked boards with open gaps
//        'beam'      one wide aged oak timber with checks
//        'trim'      fine, oiled hardwood for frames, rails and handrails
// To run the grain horizontally use withRepeat(set, rx, ry, { rotation: Math.PI / 2 }).
const WOOD_KINDS = {
  plank: { boards: 4, batten: true, gap: 0, rings: 20, early: [178, 136, 78], late: [112, 78, 38], silver: 0.1, rough: 0.74, knots: 3, cracks: 0, nails: true, relief: 0.05, normal: 3.4, off: 1 },
  weathered: { boards: 4, batten: false, gap: 8, rings: 16, early: [152, 132, 102], late: [96, 80, 60], silver: 0.62, rough: 0.92, knots: 4, cracks: 3, nails: false, relief: 0.1, normal: 4, off: 2 },
  beam: { boards: 1, batten: false, gap: 0, rings: 14, early: [154, 112, 66], late: [98, 68, 36], silver: 0.22, rough: 0.82, knots: 2, cracks: 3, nails: false, relief: 0.1, normal: 4, off: 3 },
  trim: { boards: 1, batten: false, gap: 0, rings: 30, early: [186, 142, 82], late: [130, 92, 46], silver: 0, rough: 0.5, knots: 1, cracks: 0, nails: false, relief: 0.03, normal: 1.6, off: 4 },
};

export function createWoodTextures({ kind = "plank", seed = 3, size = 512 } = {}) {
  if (!WOOD_KINDS[kind]) throw new Error(`createWoodTextures: unknown kind "${kind}"`);
  return cached("wood", { kind, seed, size }, () => buildWood(kind, seed, size));
}

function buildWood(kind, seed, S) {
  const cfg = WOOD_KINDS[kind];
  const rng = createRng(seed * 131 + cfg.off * 17);
  const noise = createNoise(seed * 5 + cfg.off);
  const nb = cfg.boards;
  const bw = S / nb;
  const battenW = cfg.batten ? Math.round(S * 0.055) : 0;
  const rr = (a, b) => a + (b - a) * rng();

  // Per board parameters.
  const tone = [];
  const phaseOff = [];
  const ringsB = [];
  const nSeams = cfg.batten ? nb : 0;
  for (let b = 0; b < nb + nSeams; b++) {
    tone.push(0.86 + rng() * 0.28);
    phaseOff.push(rng() * 10);
    ringsB.push(cfg.rings * (0.85 + 0.3 * rng()));
  }
  // Knots: centre in px, radii in px (taller than wide because they are cut along the grain).
  const knots = [];
  for (let k = 0; k < cfg.knots; k++) {
    const b = Math.floor(rng() * nb);
    const r0 = Math.min(34, Math.max(9, bw * rr(0.04, 0.085)));
    const inset = nb > 1 ? 0.32 : 0.15;
    knots.push({ x: (b + rr(inset, 1 - inset)) * bw, y: rng() * S, rx: r0, ry: r0 * rr(1.4, 1.9), b });
  }

  // Low resolution fields (smooth): ring phase warp, knot grain deflection, streaks, mottling.
  const K = Math.max(64, S >> 2);
  const Wk = new Float32Array(K * K);
  const Kw = new Float32Array(K * K);
  const Sk = new Float32Array(K * K);
  const Dk = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const i = y * K + x;
      Wk[i] = noise.fbm2(u * 3, v * 2, 3, 3, 2);
      Sk[i] = noise.fbm2(u * nb * 3 + 2, v * 2, 3, nb * 3, 2) * 0.5 + 0.5;
      Dk[i] = noise.fbm2(u * 4 + 6, v * 4 + 1, 3, 4, 4);
      // Knot deflection: push ring phase away from each knot (rings flow around it).
      let kw = 0;
      const px = u * S;
      const py = v * S;
      for (let n = 0; n < knots.length; n++) {
        const kn = knots[n];
        let dx = px - kn.x;
        let dy = py - kn.y;
        dx -= S * Math.round(dx / S);
        dy -= S * Math.round(dy / S);
        const ex = dx / (kn.rx * 2.4);
        const ey = dy / (kn.ry * 2.4);
        const gsn = Math.exp(-(ex * ex + ey * ey));
        kw -= (dx / bw) * cfg.rings * 1.1 * gsn;
      }
      Kw[i] = kw;
    }
  }
  const Wf = resampleBilinear(Wk, K, K, S, S, true);
  const Kf = resampleBilinear(Kw, K, K, S, S, true);
  const Sf = resampleBilinear(Sk, K, K, S, S, true);
  const Df = resampleBilinear(Dk, K, K, S, S, true);

  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const FIB = fibreTable(noise, 40, 4); // pores and fibres, tiled every 128 px
  const silverCol = [160, 152, 138];
  const algaeCol = [92, 104, 70];
  const early = cfg.early;
  const late = cfg.late;
  const half = battenW / 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let b = nb > 1 ? Math.min(nb - 1, (x / bw) | 0) : 0;
      let bx = (x - b * bw) / bw; // 0..1 across the current board
      let ringCount = ringsB[b];
      let edge = Math.min(x - b * bw, (b + 1) * bw - x); // px to nearest board edge
      let baseH = 0.5;
      let isBatten = false;
      let battenEdge = 0;
      let boardShadow = 0;
      if (cfg.batten) {
        const sx = Math.round(x / bw) * bw;
        const dist = x - sx;
        const ad = Math.abs(dist);
        if (ad < half) {
          isBatten = true;
          const si = nb + (Math.round(x / bw) % nb);
          b = si;
          bx = (dist + half) / battenW;
          ringCount = 2.6;
          battenEdge = half - ad; // px inside the batten edge
          baseH = 0.62 + 0.3 * smoothstep(0, 5, battenEdge);
          edge = 99;
        } else {
          // contact shadow of the batten on the board next to it
          boardShadow = 1 - smoothstep(0, 9, ad - half);
        }
      }
      const phase = bx * ringCount + phaseOff[b] + Wf[i] * 1.4 + Kf[i];
      const rf = phase - Math.floor(phase);
      const lateW0 = rf * rf * rf; // slow ramp to dark late wood, then an abrupt reset: real ring profile
      // a second, finer ring set at an irrational ratio breaks the regular banding
      const p2 = phase * 3.71 + Df[i] * 2.5;
      const r2 = p2 - Math.floor(p2);
      const lateW = lateW0 * 0.75 + r2 * r2 * 0.25;
      const fib = FIB[(y & 127) * 128 + (x & 127)];
      const pores = fib * 0.5 + 0.5;
      const tl = clamp(lateW * 0.7 + 0.24 * pores + 0.03);
      let r = early[0] + (late[0] - early[0]) * tl;
      let g = early[1] + (late[1] - early[1]) * tl;
      let bl = early[2] + (late[2] - early[2]) * tl;
      const tn = tone[b] * (1 + 0.12 * Df[i]) * (1 + 0.14 * fib);
      r *= tn;
      g *= tn;
      bl *= tn;
      // weathering: silvering concentrated in streaks, damp dark streaks, algae in hollows
      const s = Sf[i];
      if (cfg.silver > 0) {
        const wv = clamp(cfg.silver * (0.45 + 1.1 * s) * (0.8 + 0.4 * Df[i]));
        r += (silverCol[0] * (0.78 + 0.3 * pores) - r) * wv;
        g += (silverCol[1] * (0.78 + 0.3 * pores) - g) * wv;
        bl += (silverCol[2] * (0.78 + 0.3 * pores) - bl) * wv;
        const damp = smoothstep(0.7, 0.95, s) * 0.35;
        r *= 1 - damp;
        g *= 1 - damp;
        bl *= 1 - damp;
        if (kind === "weathered") {
          const alg = smoothstep(0.35, 0.7, Df[i]) * 0.38;
          r += (algaeCol[0] - r) * alg;
          g += (algaeCol[1] - g) * alg;
          bl += (algaeCol[2] - bl) * alg;
        }
      }
      // height: grain relief (soft early wood erodes on weathered boards) + pores
      let h = baseH + cfg.relief * (lateW - 0.4) * (kind === "weathered" ? 1.6 : 1) + 0.02 * fib;
      let aoV = 1;
      let rg = cfg.rough * (0.92 + 0.1 * (1 - lateW) + 0.05 * fib);
      if (cfg.gap > 0) {
        // open gaps between boards: dark, deep, rounded board edges
        const gapHalf = cfg.gap * 0.5;
        const e2 = edge - gapHalf;
        const gm = 1 - smoothstep(-1.5, 1.5, e2);
        h = h * smoothstep(-1.5, 5, e2) + 0.02;
        const k = 1 - gm * 0.8;
        r *= k;
        g *= k;
        bl *= k;
        aoV *= 1 - 0.75 * gm;
        aoV *= 0.6 + 0.4 * smoothstep(0, 8, e2);
        rg += gm * 0.08;
      }
      if (boardShadow > 0) {
        aoV *= 1 - 0.5 * boardShadow;
        const k = 1 - 0.28 * boardShadow;
        r *= k;
        g *= k;
        bl *= k;
      }
      if (isBatten) {
        const k = 0.82 + 0.18 * smoothstep(0, 4, battenEdge);
        r *= k;
        g *= k;
        bl *= k;
        // slightly lighter, less weathered top face of the batten
        r += 6;
        g += 5;
        bl += 3;
      }
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = bl;
      rgba[o + 3] = 255;
      hgt[i] = h;
      rough[i] = rg;
      ao[i] = aoV;
    }
  }

  // ---- details painted over the pass (all wrap across the tile borders) ----------------------
  const px = (xi, yi) => ((yi % S) + S) % S * S + (((xi % S) + S) % S);

  // Knots: dark oval core with concentric rings, a faint dark halo and a slight dimple.
  for (const kn of knots) {
    const bx0 = Math.floor(kn.x - kn.rx * 2);
    const by0 = Math.floor(kn.y - kn.ry * 2);
    const bx1 = Math.ceil(kn.x + kn.rx * 2);
    const by1 = Math.ceil(kn.y + kn.ry * 2);
    for (let yy = by0; yy <= by1; yy++) {
      for (let xx = bx0; xx <= bx1; xx++) {
        const dx = (xx - kn.x) / kn.rx;
        const dy = (yy - kn.y) / kn.ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 2) continue;
        const idx = px(xx, yy);
        const o = idx * 4;
        const core = 1 - smoothstep(0.75, 1.0, d);
        const halo = (1 - smoothstep(1.0, 1.9, d)) * (1 - core);
        const ringsK = 0.5 + 0.5 * Math.sin(d * TAU * 2.6 + noise.perlin2(xx * 0.05, yy * 0.05) * 2);
        if (core > 0) {
          const kk = (0.42 + 0.18 * ringsK) * 0.8;
          rgba[o] += (92 * (0.7 + ringsK * 0.5) - rgba[o]) * core * 0.7;
          rgba[o + 1] += (58 * (0.7 + ringsK * 0.5) - rgba[o + 1]) * core * 0.7;
          rgba[o + 2] += (30 * (0.7 + ringsK * 0.5) - rgba[o + 2]) * core * 0.7;
          hgt[idx] += (-0.1 + 0.05 * ringsK) * core;
          ao[idx] *= 1 - 0.3 * core * kk;
          rough[idx] = Math.min(1, rough[idx] + 0.05 * core);
        }
        if (halo > 0) {
          rgba[o] *= 1 - 0.28 * halo;
          rgba[o + 1] *= 1 - 0.28 * halo;
          rgba[o + 2] *= 1 - 0.28 * halo;
        }
      }
    }
  }

  // Seasoning cracks / checks: thin dark splits running with the grain.
  for (let c = 0; c < cfg.cracks; c++) {
    const b = Math.floor(rng() * nb);
    let cx = (b + rr(0.2, 0.8)) * bw;
    const y0 = rng() * S;
    const len = rr(S * 0.25, S * 0.6);
    const wdt = rr(1.0, 2.2);
    const cs = rng() * 100;
    for (let t = 0; t < len; t++) {
      const tt = t / len;
      const wt = wdt * Math.pow(Math.sin(Math.PI * tt), 0.6);
      const xc = cx + noise.perlin2(t * 0.012 + cs, cs * 0.7) * 16;
      const yy = Math.floor(y0 + t);
      for (let dx = -3; dx <= 3; dx++) {
        const cov = clamp(1 - Math.abs(dx + (xc - Math.floor(xc)) - 0.5 + 0.5) / (wt + 0.5)) * 0.9;
        if (cov <= 0) continue;
        const idx = px(Math.floor(xc) + dx, yy);
        const o = idx * 4;
        const k = 1 - cov * 0.72;
        rgba[o] *= k;
        rgba[o + 1] *= k;
        rgba[o + 2] *= k;
        hgt[idx] -= cov * 0.28;
        ao[idx] *= 1 - cov * 0.7;
        rough[idx] = Math.min(1, rough[idx] + cov * 0.1);
      }
    }
  }

  // Nail heads along the battens with rust streaks running down.
  if (cfg.nails) {
    for (let s = 0; s < nb; s++) {
      const sx = s * bw;
      for (let n = 0; n < 4; n++) {
        const ny = (n + 0.5 + (rng() - 0.5) * 0.3) * (S / 4);
        const nx = sx + (rng() - 0.5) * 4;
        // rust streak first (beneath the head)
        for (let t = 0; t < 46; t++) {
          const fall = 1 - t / 46;
          for (let dx = -3; dx <= 3; dx++) {
            const cov = clamp(1 - Math.abs(dx) / 3.2) * fall * 0.45;
            const idx = px(Math.round(nx) + dx, Math.round(ny) - t);
            const o = idx * 4;
            rgba[o] += (70 - rgba[o]) * cov;
            rgba[o + 1] += (44 - rgba[o + 1]) * cov;
            rgba[o + 2] += (28 - rgba[o + 2]) * cov;
          }
        }
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 4.5) continue;
            const idx = px(Math.round(nx) + dx, Math.round(ny) + dy);
            const o = idx * 4;
            const head = 1 - smoothstep(2.6, 3.6, d);
            const rim = smoothstep(2.4, 3.2, d) * (1 - smoothstep(3.2, 4.5, d));
            const hl = (dx * -0.4 + dy * 0.4) * 0.1;
            rgba[o] += (46 + hl * 90 - rgba[o]) * head;
            rgba[o + 1] += (40 + hl * 90 - rgba[o + 1]) * head;
            rgba[o + 2] += (38 + hl * 90 - rgba[o + 2]) * head;
            hgt[idx] += head * 0.2 - rim * 0.06;
            rough[idx] = rough[idx] * (1 - head) + 0.45 * head;
          }
        }
      }
    }
  }

  return pbrSet(rgba, hgt, rough, ao, S, S, cfg.normal);
}

// ================================================================================================
// SHINGLES
// ================================================================================================
// Staggered courses of cedar (or slate) shingles. Each shingle has its own width, colour, tilt,
// butt height and exposure; butts overlap the course below with a cast shadow and the vertical
// joints are dark. Moss collects in the shadow bands. Tileable. One tile is about 1 m of roof
// (8 courses). kind: 'cedar' (default) | 'slate'.
export function createShingleTextures({ seed = 5, size = 512, kind = "cedar" } = {}) {
  return cached("shingle", { seed, size, kind }, () => buildShingles(seed, size, kind));
}

function buildShingles(seed, S, kind) {
  const slate = kind === "slate";
  const rng = createRng(seed * 977 + (slate ? 5 : 1));
  const noise = createNoise(seed + (slate ? 77 : 13));
  const R = slate ? 6 : 8; // courses per tile
  const N = slate ? 5 : 8; // average shingles per course
  const rowH = S / R;
  const rr = (a, b) => a + (b - a) * rng();

  // Per course layout.
  const kIdx = new Uint8Array(R * S); // shingle index at each x
  const xLocal = new Float32Array(R * S); // px from the shingle's left edge
  const widthAt = new Float32Array(R * S); // that shingle's width in px
  const buttOff = new Float32Array(R * S); // butt line offset in px (positive = higher)
  const sh = []; // per shingle params, indexed [row][k]
  for (let r = 0; r < R; r++) {
    const ws = [];
    let tot = 0;
    const count = N + (slate ? 0 : Math.floor(rng() * 2));
    for (let k = 0; k < count; k++) {
      const w = slate ? rr(0.92, 1.08) : rr(0.68, 1.32);
      ws.push(w);
      tot += w;
    }
    const offset = rng() * S; // stagger: each course starts somewhere else
    let x0 = offset;
    const list = [];
    for (let k = 0; k < count; k++) {
      const wpx = (ws[k] / tot) * S;
      list.push({
        left: x0,
        w: wpx,
        tone: rng(),
        silver: rng(),
        butt: slate ? rr(-1.5, 1.5) : rr(-0.07, 0.05) * rowH,
        tilt: slate ? rr(-1, 1) : rr(-7, 7),
        slant: rr(-0.05, 0.05),
        grainSeed: rng() * 50,
        thick: rr(0.85, 1.05),
        moss: rng(),
      });
      x0 += wpx;
    }
    sh.push(list);
    for (let x = 0; x < S; x++) {
      // find shingle whose [left, left + w) wrapped contains x
      let rel = x - offset;
      rel -= S * Math.floor(rel / S);
      let acc = 0;
      let kk = 0;
      for (let k = 0; k < count; k++) {
        const wpx = list[k].w;
        if (rel < acc + wpx || k === count - 1) {
          kk = k;
          break;
        }
        acc += wpx;
      }
      const s = list[kk];
      kIdx[r * S + x] = kk;
      xLocal[r * S + x] = rel - acc;
      widthAt[r * S + x] = s.w;
      const fx = (rel - acc) / s.w;
      buttOff[r * S + x] =
        s.butt + s.tilt * (fx - 0.5) + noise.perlin2(x * 0.06 + r * 7.1, r * 3.3) * (slate ? 0.4 : 1.6);
    }
  }

  // Low res fields: moss distribution and damp stains.
  const K = Math.max(64, S >> 2);
  const Mk = new Float32Array(K * K);
  const Sk = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      Mk[y * K + x] = noise.fbm2(u * 5 + 1, v * 5 + 3, 4, 5, 5);
      Sk[y * K + x] = noise.fbm2(u * 9 + 5, v * 2 + 1, 3, 9, 2) * 0.5 + 0.5;
    }
  }
  const Mf = resampleBilinear(Mk, K, K, S, S, true);
  const Sf = resampleBilinear(Sk, K, K, S, S, true);

  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const SP = speckleTable(seed);
  const GX = 150; // vertical grain streaks
  const GY = 6;
  const cA = slate ? [58, 64, 72] : [118, 90, 60];
  const cB = slate ? [88, 94, 102] : [146, 116, 80];
  const silverCol = [132, 124, 110];
  const mossA = [58, 82, 34];
  const mossB = [96, 118, 52];

  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    const r0 = Math.floor(y / rowH);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const i = y * S + x;
      // Which course owns this pixel? A course's butt hangs over the course below it.
      const nextRow = (r0 + 1) % R;
      const buttNext = (r0 + 1) * rowH + buttOff[nextRow * S + x];
      let row;
      let butt;
      if (y >= buttNext) {
        row = r0 + 1;
        butt = buttNext;
      } else {
        const buttThis = r0 * rowH + buttOff[(r0 % R) * S + x];
        if (y >= buttThis) {
          row = r0;
          butt = buttThis;
        } else {
          row = r0 - 1;
          butt = (r0 - 1) * rowH + buttOff[(((r0 - 1) % R) + R) % R * S + x];
        }
      }
      const rw = ((row % R) + R) % R;
      const t = (y - butt) / rowH; // 0 at the butt edge, grows upward
      const rowAbove = (((row + 1) % R) + R) % R;
      const above = (row + 1) * rowH + buttOff[rowAbove * S + x];
      const distAbove = above - y; // px below the butt of the overlapping course: its shadow falls here
      const ix = rw * S + x;
      const s = sh[rw][kIdx[ix]];
      const xl = xLocal[ix];
      const wpx = widthAt[ix];
      const fx = xl / wpx;
      const ed = Math.min(xl, wpx - xl) - s.slant * t * rowH * 0.5; // px to the vertical joint

      const grain = noise.perlin2(u * GX + s.grainSeed, v * GY, GX, GY);
      const fine = 0.5 + 0.5 * grain;
      // base colour
      let tn = s.tone;
      let r = cA[0] + (cB[0] - cA[0]) * tn;
      let g = cA[1] + (cB[1] - cA[1]) * tn;
      let b = cA[2] + (cB[2] - cA[2]) * tn;
      if (!slate) {
        const sv = clamp(s.silver * 0.65 * (0.6 + 0.8 * Sf[i]));
        r += (silverCol[0] - r) * sv;
        g += (silverCol[1] - g) * sv;
        b += (silverCol[2] - b) * sv;
      }
      const gk = slate ? 0.95 + 0.1 * fine : 0.78 + 0.34 * fine;
      const topLight = 1 + 0.1 * (0.5 - clamp(t));
      r *= gk * topLight;
      g *= gk * topLight;
      b *= gk * topLight;
      // butt edge: lit end grain / chipped edge
      const edgeLit = 1 - smoothstep(0, slate ? 0.025 : 0.05, t);
      r += (slate ? 30 : 46) * edgeLit;
      g += (slate ? 32 : 38) * edgeLit;
      b += (slate ? 36 : 28) * edgeLit;
      // cast shadow of the course above, and darkening toward the tucked-in top
      const shadow = distAbove >= 0 ? Math.exp(-distAbove / (rowH * 0.1)) * 0.62 : 0;
      let aoV = 1 - shadow;
      aoV *= 1 - 0.22 * smoothstep(0.55, 1.0, t);
      // vertical joint
      const joint = 1 - smoothstep(1.0, 3.6, ed);
      aoV *= 1 - 0.8 * joint;
      // moss in the shadow bands and along the joints
      const mval = Mf[i] + 0.35 * (shadow / 0.62) + 0.18 * joint + 0.12 * (s.moss - 0.5);
      const mossW = smoothstep(slate ? 0.75 : 0.5, slate ? 0.95 : 0.78, mval) * (slate ? 0.45 : 1);
      const sp = SP[((y & 255) << 8) | (x & 255)];
      const mk = Math.min(1, mossW * 1.4) * 0.9;
      r += (mossA[0] + (mossB[0] - mossA[0]) * sp - r) * mk;
      g += (mossA[1] + (mossB[1] - mossA[1]) * sp - g) * mk;
      b += (mossA[2] + (mossB[2] - mossA[2]) * sp - b) * mk;
      const dark = aoV * (0.35 + 0.65 * aoV);
      const lightK = 0.45 + 0.55 * dark;
      r *= lightK;
      g *= lightK;
      b *= lightK;

      // height: thick at the butt, tapering up under the next course; cupped across the width
      const cup = (fx - 0.5) * 2;
      let h = 0.32 + 0.58 * Math.pow(1 - clamp(t), 1.1) * s.thick - 0.07 * cup * cup + 0.04 * grain;
      h *= 1 - 0.9 * joint;
      h += mk * 0.07 * sp;
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      hgt[i] = h;
      rough[i] = clamp((slate ? 0.58 : 0.8) + 0.08 * (1 - fine) + 0.2 * mk + 0.1 * joint + (slate ? 0.1 * edgeLit : 0));
      ao[i] = clamp(aoV);
    }
  }
  return pbrSet(rgba, hgt, rough, ao, S, S, slate ? 3 : 3.6);
}

// ================================================================================================
// LEAF SHAPES (shared by the leaf cards, the fern and the leaf litter on the ground)
// ================================================================================================
// A shape lives in leaf space: u runs along the midrib from the base (0) to the tip (1), v is the
// lateral offset in units of the leaf length. outline = closed polygon, veins = segments
// [u0, v0, u1, v1, widthFactor].

function sampledOutline(half, N = 44) {
  const outline = [];
  for (let i = 0; i <= N; i++) outline.push([i / N, half(i / N, 1)]);
  for (let i = N - 1; i >= 1; i--) outline.push([i / N, -half(i / N, -1)]);
  return outline;
}

// Lobed obovate leaf (English oak): rounded lobes separated by narrow sinuses.
function lobedShape(rng, { nl = 5, W = 0.3, envPow = 1.35, depth = 0.47, vein = true } = {}) {
  const ph = [rng(), rng()];
  const asym = [1 + (rng() - 0.5) * 0.14, 1 + (rng() - 0.5) * 0.14];
  const half = (t, s) => {
    const k = s > 0 ? 0 : 1;
    const env = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, envPow))), 0.8);
    // sin^2 (rounded at both the lobe tip and the sinus bottom) instead of |sin|^0.55, which made
    // V-shaped cusps and read as holly. The 0.8 power keeps the lobes broad and the sinuses narrow.
    const sl = Math.sin(Math.PI * (nl * t * 0.92 + ph[k]));
    const lobe = Math.pow(sl * sl, 0.9);
    return W * asym[k] * env * (1 - depth + depth * lobe);
  };
  const veins = [];
  if (vein) {
    for (const s of [1, -1]) {
      const k = s > 0 ? 0 : 1;
      for (let m = 0; m <= nl; m++) {
        const tk = (m + 0.5 - ph[k]) / (nl * 0.92);
        if (tk > 0.1 && tk < 0.94) veins.push([Math.max(0, tk - 0.11), 0, tk, s * half(tk, s) * 0.86, 1]);
      }
    }
  }
  return { outline: sampledOutline(half), veins };
}

// Ovate leaf with parallel side veins (beech, hornbeam, birch). serr = margin teeth amplitude.
function ovateShape(rng, { W = 0.26, pairs = 9, wave = 0.035, waveFreq = 11, tipPow = 0.8, serr = 0 } = {}) {
  const ph = [rng() * 6, rng() * 6];
  const half = (t, s) => {
    const k = s > 0 ? 0 : 1;
    const env = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, tipPow))), 0.85);
    const edge = 1 + wave * Math.sin(TAU * waveFreq * t + ph[k]) + serr * (Math.abs(Math.sin(Math.PI * 13 * t + ph[k])) - 0.5);
    return W * env * edge;
  };
  const veins = [];
  for (const s of [1, -1]) {
    for (let j = 0; j < pairs; j++) {
      const t0 = 0.07 + (j / pairs) * 0.84;
      const t1 = Math.min(0.97, t0 + 0.13);
      veins.push([t0, 0, t1, s * half(t1, s) * 0.92, 1]);
    }
  }
  return { outline: sampledOutline(half), veins };
}

// Palmate shapes defined in polar form around the petiole junction (maple, ivy).
function polarShape(rng, { lobes, minR, thetaMax, step, serr, notch = false }) {
  const ph = rng() * 6;
  const outline = [];
  if (!notch) outline.push([0, 0]);
  for (let a = -thetaMax; a <= thetaMax + 1e-6; a += step) {
    let r = minR;
    for (const lb of lobes) {
      const x = (a - lb.a) / lb.hw;
      if (Math.abs(x) < 1) r = Math.max(r, lb.len * Math.pow(1 - Math.abs(x), lb.pow || 0.65));
    }
    r *= 1 + serr * Math.sin(a * 41 + ph);
    if (notch) r *= 0.22 + 0.78 * smoothstep(Math.PI, Math.PI * 0.8, Math.abs(a));
    outline.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const veins = [];
  for (const lb of lobes) {
    const L = lb.len * 0.9;
    const tx = L * Math.cos(lb.a);
    const ty = L * Math.sin(lb.a);
    veins.push([0, 0, tx, ty, lb.a === 0 ? 1.3 : 1]);
    for (const f of [0.38, 0.62]) {
      for (const s of [1, -1]) {
        const bx = tx * f;
        const by = ty * f;
        const ang = lb.a + s * 0.7;
        const l2 = L * (1 - f) * 0.5;
        veins.push([bx, by, bx + l2 * Math.cos(ang), by + l2 * Math.sin(ang), 0.7]);
      }
    }
  }
  return { outline, veins };
}

function mapleShape(rng) {
  const j = () => (rng() - 0.5) * 0.12;
  return polarShape(rng, {
    lobes: [
      { a: 0, len: 1, hw: 0.46 + j() },
      { a: 0.86 + j(), len: 0.84, hw: 0.44 },
      { a: -0.86 + j(), len: 0.84, hw: 0.44 },
      { a: 1.62, len: 0.5, hw: 0.5 },
      { a: -1.62, len: 0.5, hw: 0.5 },
    ],
    minR: 0.3,
    thetaMax: 1.95,
    step: 0.035,
    serr: 0.035,
  });
}

function ivyShape(rng) {
  return polarShape(rng, {
    lobes: [
      { a: 0, len: 1, hw: 0.5, pow: 0.55 },
      { a: 1.0, len: 0.74, hw: 0.5, pow: 0.55 },
      { a: -1.0, len: 0.74, hw: 0.5, pow: 0.55 },
      { a: 2.45, len: 0.42, hw: 0.7, pow: 0.7 },
      { a: -2.45, len: 0.42, hw: 0.7, pow: 0.7 },
    ],
    minR: 0.34,
    thetaMax: Math.PI,
    step: 0.045,
    serr: 0.01,
    notch: true,
  });
}

function buildShape(kind, rng) {
  switch (kind) {
    case "oak":
      return lobedShape(rng, { nl: 4 + (rng() < 0.45 ? 1 : 0), W: 0.27 + rng() * 0.07 });
    case "beech":
      return ovateShape(rng, { W: 0.25 + rng() * 0.04, pairs: 9 });
    case "sprig":
      return ovateShape(rng, { W: 0.3 + rng() * 0.05, pairs: 6, wave: 0.0, serr: 0.1, tipPow: 0.75 });
    case "maple":
      return mapleShape(rng);
    case "ivy":
      return ivyShape(rng);
    case "fern":
      // wider pinnae with shallower notches: the see-through notches became bright bokeh dots
      return lobedShape(rng, { nl: 8, W: 0.125, envPow: 0.75, depth: 0.3, vein: false });
    default:
      return ovateShape(rng, {});
  }
}

// Leaf space -> canvas placement. ang in canvas radians (y down), bend curls the blade sideways.
function placer(x, y, ang, len, bend = 0, flip = 1) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (u, v) => {
    const vv = v * flip + bend * u * u;
    return [x + len * (u * c - vv * s), y + len * (u * s + vv * c)];
  };
}

// Leaf colour classes around the palette: mostly mid greens, a few sunlit highlights (#6B8F3A),
// some yellow-olive and some dark ones.
function leafColour(rng, kind) {
  const dark = rgbOf(PALETTE.leafDark);
  const mid = rgbOf(PALETTE.leafMid);
  const hi = rgbOf(PALETTE.leafHighlight);
  const roll = rng();
  let c;
  if (roll < 0.14) c = lerp3(dark, mid, rng() * 0.4);
  else if (roll < 0.62) c = lerp3(dark, mid, 0.35 + rng() * 0.65);
  else if (roll < 0.86) c = lerp3(mid, hi, rng());
  else if (roll < 0.95) c = lerp3(hi, [158, 152, 54], 0.25 + rng() * 0.6);
  else c = lerp3(dark, [60, 80, 28], rng());
  if (kind === "ivy") c = lerp3(c, [28, 62, 26], 0.45);
  if (kind === "sprig") c = lerp3(c, [96, 140, 52], 0.18);
  if (kind === "maple") c = lerp3(c, [120, 140, 44], 0.12);
  // per leaf hue jitter
  return [c[0] * 0.93 + (rng() - 0.5) * 12, c[1] * 0.93 + (rng() - 0.5) * 12, c[2] * 0.93 + (rng() - 0.5) * 8];
}

function leafPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// Rich leaf: gradient, folded halves, darkened margin, tapered midrib, side veins.
// g = colour ctx, hc = height ctx (veins are grooves, blade is slightly domed).
function paintLeafCard(g, hc, shape, place, col, o = {}) {
  const { len, kind, rng } = o;
  const pts = shape.outline.map(([u, v]) => place(u, v));
  const base = place(0, 0);
  const tip = place(1, 0);

  // contact shadow on whatever is already painted below (source-atop keeps the cut-out clean)
  g.globalCompositeOperation = "source-atop";
  leafPath(g, pts);
  g.lineJoin = "round";
  g.lineWidth = len * 0.075;
  g.strokeStyle = "rgba(0,0,0,0.10)";
  g.stroke();
  g.lineWidth = len * 0.03;
  g.strokeStyle = "rgba(0,0,0,0.14)";
  g.stroke();
  g.globalCompositeOperation = "source-over";

  const grad = g.createLinearGradient(base[0], base[1], tip[0], tip[1]);
  grad.addColorStop(0, css(scale3(lerp3(col, [120, 120, 40], 0.12), 0.78)));
  grad.addColorStop(0.45, css(col));
  grad.addColorStop(1, css(scale3(col, 1.06)));
  leafPath(g, pts);
  g.fillStyle = grad;
  g.fill();

  // the blade folds along the midrib: one half catches more light
  const half = shape.outline.length >> 1;
  const sideA = pts.slice(0, half + 1);
  const sideB = pts.slice(half).concat([pts[0]]);
  const lightFirst = rng() < 0.5;
  g.beginPath();
  g.moveTo(base[0], base[1]);
  for (const p of sideA) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillStyle = lightFirst ? "rgba(255,255,205,0.05)" : "rgba(0,14,0,0.1)";
  g.fill();
  g.beginPath();
  g.moveTo(base[0], base[1]);
  for (const p of sideB) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillStyle = lightFirst ? "rgba(0,14,0,0.1)" : "rgba(255,255,205,0.05)";
  g.fill();

  // darkened margin
  g.save();
  leafPath(g, pts);
  g.clip();
  g.lineWidth = Math.max(2, len * 0.045);
  g.strokeStyle = css(scale3(col, 0.5), 0.3);
  g.stroke();
  g.restore();
  leafPath(g, pts);
  g.lineWidth = 1;
  g.strokeStyle = css(scale3(col, 0.55), 0.35);
  g.stroke();

  // veins
  const veinCol = kind === "ivy" ? [214, 228, 172] : lerp3(col, [232, 238, 176], 0.5);
  const veinA = kind === "ivy" ? 0.7 : 0.4;
  g.lineCap = "round";
  for (const [u0, v0, u1, v1, wf] of shape.veins) {
    const a = place(u0, v0);
    const b = place(u1, v1);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineWidth = Math.max(0.7, len * 0.0065 * wf * (kind === "ivy" ? 1.6 : 1));
    g.strokeStyle = css(veinCol, veinA);
    g.stroke();
  }
  if (kind !== "maple" && kind !== "ivy" && kind !== "fern") {
    // tapered midrib (maple and ivy have fan veins from the base instead)
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const a = place((i / segs) * 0.97, 0);
      const b = place(((i + 1) / segs) * 0.97, 0);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.lineWidth = Math.max(0.8, len * 0.024 * (1 - (i / segs) * 0.85));
      g.strokeStyle = css(veinCol, 0.75);
      g.stroke();
    }
  } else if (kind === "fern") {
    const a = place(0, 0);
    const b = place(0.96, 0);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineWidth = Math.max(0.8, len * 0.02);
    g.strokeStyle = css(veinCol, 0.6);
    g.stroke();
  }

  if (hc) {
    leafPath(hc, pts);
    hc.fillStyle = "rgb(150,150,150)";
    hc.fill();
    hc.save();
    leafPath(hc, pts);
    hc.clip();
    hc.lineWidth = Math.max(2, len * 0.04);
    hc.strokeStyle = "rgba(70,70,70,0.45)";
    hc.stroke();
    hc.restore();
    hc.lineCap = "round";
    for (const [u0, v0, u1, v1, wf] of shape.veins) {
      const a = place(u0, v0);
      const b = place(u1, v1);
      hc.beginPath();
      hc.moveTo(a[0], a[1]);
      hc.lineTo(b[0], b[1]);
      hc.lineWidth = Math.max(0.8, len * 0.008 * wf);
      hc.strokeStyle = "rgb(88,88,88)";
      hc.stroke();
    }
    const a = place(0, 0);
    const b = place(0.97, 0);
    hc.beginPath();
    hc.moveTo(a[0], a[1]);
    hc.lineTo(b[0], b[1]);
    hc.lineWidth = Math.max(1, len * 0.02);
    hc.strokeStyle = "rgb(78,78,78)";
    hc.stroke();
  }
}

// Polyline stem with taper. pts = [[x, y], ...]
function paintStem(g, hc, pts, w0, w1, colA, colB) {
  g.lineCap = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / Math.max(1, pts.length - 2);
    g.beginPath();
    g.moveTo(pts[i][0], pts[i][1]);
    g.lineTo(pts[i + 1][0], pts[i + 1][1]);
    g.lineWidth = w0 + (w1 - w0) * t;
    g.strokeStyle = css(lerp3(colA, colB, t));
    g.stroke();
    // lit edge
    g.lineWidth = Math.max(0.6, (w0 + (w1 - w0) * t) * 0.3);
    g.strokeStyle = css(scale3(lerp3(colA, colB, t), 1.35), 0.55);
    g.stroke();
    if (hc) {
      hc.lineCap = "round";
      hc.beginPath();
      hc.moveTo(pts[i][0], pts[i][1]);
      hc.lineTo(pts[i + 1][0], pts[i + 1][1]);
      hc.lineWidth = w0 + (w1 - w0) * t;
      hc.strokeStyle = "rgb(200,200,200)";
      hc.stroke();
    }
  }
}

// ---- twig composition ---------------------------------------------------------------------------
function quadPath(p0, p1, p2) {
  return (s) => {
    const a = (1 - s) * (1 - s);
    const b = 2 * (1 - s) * s;
    const c = s * s;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  };
}
function pathAngle(path, s) {
  const e = 0.01;
  const a = path(Math.max(0, s - e));
  const b = path(Math.min(1, s + e));
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// Adds a twig (stem polyline) with n leaves to `items`.
function addTwig(items, rng, path, o) {
  const {
    n,
    startS = 0.2,
    endS = 1,
    leafLen,
    spread = [50, 70],
    petiole = 0.02,
    kind,
    S,
    w0 = 7,
    w1 = 2.5,
    terminal = true,
    depth = 0,
    bendMax = 0.2,
  } = o;
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(path(i / 40));
  items.stems.push({ pts, w0, w1, z: depth });
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? endS : startS + (endS - startS) * (k / (n - 1));
    const pos = path(s);
    const tang = pathAngle(path, s);
    const side = k % 2 ? 1 : -1;
    const isTerm = terminal && k === n - 1;
    const ang = isTerm ? tang + (rng() - 0.5) * 0.3 : tang + side * (spread[0] + rng() * (spread[1] - spread[0])) * DEG;
    const len = (leafLen[1] + (leafLen[0] - leafLen[1]) * (1 - s)) * S * (0.9 + rng() * 0.2);
    const pl = petiole * S * (0.7 + rng() * 0.6);
    const bx = pos[0] + Math.cos(ang) * pl;
    const by = pos[1] + Math.sin(ang) * pl;
    items.stems.push({ pts: [pos, [bx, by]], w0: Math.max(1.5, w1 + 1), w1: Math.max(1.2, w1 * 0.7), z: depth + 0.5 });
    items.leaves.push({ x: bx, y: by, ang, len, bend: (rng() - 0.5) * 2 * bendMax, flip: rng() < 0.5 ? 1 : -1, kind, z: depth + rng() });
  }
}

function composeCard(kind, rng, S) {
  const items = { leaves: [], stems: [] };
  const P = (a, b) => [a * S, b * S];
  if (kind === "oak") {
    const main = quadPath(P(0.5, 0.995), P(0.4, 0.55), P(0.58, 0.2));
    addTwig(items, rng, main, { n: 8, startS: 0.2, leafLen: [0.25, 0.17], spread: [52, 70], petiole: 0.018, kind, S, depth: 0 });
    for (const [ps, sd] of [[0.3, 1], [0.55, -1]]) {
      const p0 = main(ps);
      const side = quadPath(p0, [p0[0] + sd * 0.1 * S, p0[1] - 0.07 * S], [p0[0] + sd * 0.23 * S, p0[1] - 0.15 * S]);
      addTwig(items, rng, side, { n: 3, startS: 0.4, leafLen: [0.17, 0.13], spread: [45, 65], petiole: 0.015, kind, S, w0: 4, w1: 2, depth: -1 });
    }
  } else if (kind === "beech") {
    const main = quadPath(P(0.44, 0.995), P(0.34, 0.52), P(0.6, 0.2));
    addTwig(items, rng, main, { n: 9, startS: 0.16, leafLen: [0.24, 0.16], spread: [42, 58], petiole: 0.014, kind, S, bendMax: 0.28, depth: 0 });
    for (const [ps, sd] of [[0.35, 1], [0.6, -1]]) {
      const p0 = main(ps);
      const side = quadPath(p0, [p0[0] + sd * 0.1 * S, p0[1] - 0.06 * S], [p0[0] + sd * 0.2 * S, p0[1] - 0.1 * S]);
      addTwig(items, rng, side, { n: 4, startS: 0.3, leafLen: [0.15, 0.11], spread: [40, 55], petiole: 0.012, kind, S, w0: 4, w1: 2, depth: -1 });
    }
  } else if (kind === "sprig") {
    const main = quadPath(P(0.5, 0.995), P(0.45, 0.55), P(0.52, 0.1));
    addTwig(items, rng, main, { n: 6, startS: 0.3, leafLen: [0.11, 0.08], spread: [40, 60], petiole: 0.008, kind, S, w0: 5, w1: 2, depth: 0 });
    [0.2, 0.36, 0.52, 0.68, 0.84].forEach((ps, i) => {
      const sd = i % 2 ? 1 : -1;
      const p0 = main(ps);
      const reach = 0.2 + rng() * 0.1;
      const side = quadPath(p0, [p0[0] + sd * reach * 0.5 * S, p0[1] - 0.05 * S], [p0[0] + sd * reach * S, p0[1] - (0.09 + rng() * 0.06) * S]);
      addTwig(items, rng, side, { n: 6, startS: 0.15, leafLen: [0.115, 0.075], spread: [38, 58], petiole: 0.007, kind, S, w0: 3, w1: 1.5, depth: -1 });
    });
  } else if (kind === "ivy") {
    const path = (s) => [S * (0.5 + 0.16 * Math.sin(s * TAU * 1.05 + 0.4)), S * (0.995 - 0.86 * s)];
    addTwig(items, rng, path, { n: 8, startS: 0.14, leafLen: [0.2, 0.16], spread: [65, 95], petiole: 0.05, kind, S, w0: 6, w1: 2.5, bendMax: 0.15 });
  } else if (kind === "maple") {
    const node = P(0.5, 0.67);
    const stem = [];
    for (let i = 0; i <= 20; i++) stem.push([S * (0.5 + 0.02 * Math.sin(i * 0.3)), S * (0.995 - (0.995 - 0.67) * (i / 20))]);
    items.stems.push({ pts: stem, w0: 8, w1: 5, z: -2 });
    const nl = 7;
    for (let i = 0; i < nl; i++) {
      const a = -Math.PI / 2 + (i - (nl - 1) / 2) * 0.43 + (rng() - 0.5) * 0.12;
      const pl = S * (0.07 + rng() * 0.05);
      const px = node[0] + Math.cos(a) * pl;
      const py = node[1] + Math.sin(a) * pl;
      items.stems.push({ pts: [node, [px, py]], w0: 3.5, w1: 2.5, z: -1 });
      items.leaves.push({ x: px, y: py, ang: a, len: S * (0.25 + rng() * 0.04), bend: (rng() - 0.5) * 0.16, flip: rng() < 0.5 ? 1 : -1, kind, z: rng() });
    }
  }
  return items;
}

// ================================================================================================
// LEAF CARDS
// ================================================================================================
// A cluster / twig painted from many individual leaves on a transparent background. Alpha is the
// cut-out (use alphaTest ~0.5). The base of the twig is at the bottom centre of the card, the tip
// at the top. Colours bled into transparent pixels, coverage-preserving mips.
//   kind 'oak' | 'beech' | 'sprig' (small leaves, bushy filler) | 'ivy' | 'maple'
// Returns { map, normalMap }.
export function createLeafCardTexture({ kind = "oak", seed = 1, size = 512 } = {}) {
  return cached("leaf", { kind, seed, size }, () => buildLeafCard(kind, seed, size));
}

function buildLeafCard(kind, seed, S) {
  const rng = createRng(seed * 7919 + kind.charCodeAt(0) * 31 + kind.length);
  const { ctx: g } = makeCanvas(S, S);
  const { ctx: hc } = makeCanvas(S, S);
  hc.fillStyle = "rgb(128,128,128)";
  hc.fillRect(0, 0, S, S);
  g.clearRect(0, 0, S, S);
  // sizes are authored for 1024; scale line widths with the canvas
  const k = S / 1024;
  const items = composeCard(kind, rng, S);

  const twigA = [72, 56, 34];
  const twigB = [92, 100, 46];
  items.stems.sort((a, b) => a.z - b.z);
  for (const st of items.stems) paintStem(g, hc, st.pts, st.w0 * k, st.w1 * k, twigA, twigB);
  items.leaves.sort((a, b) => a.z - b.z);
  for (const lf of items.leaves) {
    const shape = buildShape(lf.kind, rng);
    const place = placer(lf.x, lf.y, lf.ang, lf.len, lf.bend, lf.flip);
    const col = leafColour(rng, kind);
    paintLeafCard(g, hc, shape, place, col, { len: lf.len, kind, rng });
  }
  return finishCard(g, hc, S, seed, 4.5);
}

// Common end of the card pipeline: read, fine noise, normal map, bleed, mips.
function finishCard(g, hc, S, seed, normalStrength) {
  const rgba = readCanvasFlipped(g, S, S);
  const hgt = canvasToHeight(hc, S, S);
  const SP = speckleTable(seed);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      if (rgba[o + 3] === 0) continue;
      // fine value noise so leaves are never flat colour
      const n = 0.965 + SP[((y & 255) << 8) | (x & 255)] * 0.07;
      rgba[o] *= n;
      rgba[o + 1] *= n;
      rgba[o + 2] *= n;
    }
  }
  const normal = heightToNormal(hgt, S, S, normalStrength, false, false);
  return cardSet(rgba, normal, S, S);
}

// ================================================================================================
// FERN FROND
// ================================================================================================
// One arching frond: curved rachis, ~28 pairs of pinnae tapering to the tip, each pinna cut into
// lobed pinnules with its own midrib. Base at bottom centre-left, tip arches to the upper right.
// Returns { map, normalMap }.
export function createFernFrondTexture({ seed = 2, size = 512 } = {}) {
  return cached("fern", { seed, size }, () => buildFern(seed, size));
}

function buildFern(seed, S) {
  const rng = createRng(seed * 4099 + 17);
  const { ctx: g } = makeCanvas(S, S);
  const { ctx: hc } = makeCanvas(S, S);
  hc.fillStyle = "rgb(128,128,128)";
  hc.fillRect(0, 0, S, S);
  const k = S / 1024;
  const path = quadPath([0.4 * S, 0.995 * S], [0.34 * S, 0.42 * S], [0.74 * S, 0.07 * S]);
  const np = 36; // dense enough that neighbouring pinnae overlap at their bases (no round gaps)
  const Lmax = 0.31 * S;
  const leaves = [];
  for (let i = 0; i < np; i++) {
    const s = 0.06 + 0.92 * (i / (np - 1));
    const pos = path(s);
    const tang = pathAngle(path, s);
    const f = Math.sin(Math.PI * Math.pow(s, 0.62));
    const lenF = 0.16 + 0.84 * f;
    const open = (80 - 22 * s) * DEG; // pinnae sweep forward toward the tip
    for (const side of [-1, 1]) {
      const ang = tang + side * (open + (rng() - 0.5) * 0.12);
      // one side of a real frond is shorter and droops more: breaks the mirror symmetry
      const len = Lmax * lenF * (0.9 + rng() * 0.2) * (side < 0 ? 0.86 : 1);
      leaves.push({ x: pos[0], y: pos[1], ang, len, bend: side * -0.1 * (0.5 + rng() * 0.5), flip: 1, z: s + (rng() - 0.5) * 0.05 });
    }
  }
  // rachis first, then pinnae
  const pts = [];
  for (let i = 0; i <= 60; i++) pts.push(path(i / 60));
  // a narrow continuous blade along the rachis: pinnae of a real frond are joined to it, so no
  // see-through gaps open up where two pinna bases meet
  paintStem(g, hc, pts, 52 * k, 8 * k, [44, 82, 30], [58, 100, 38]);
  paintStem(g, hc, pts, 11 * k, 2.5 * k, [58, 78, 34], [70, 98, 40]);
  leaves.sort((a, b) => a.z - b.z);
  for (const lf of leaves) {
    const shape = buildShape("fern", rng);
    const place = placer(lf.x, lf.y, lf.ang, lf.len, lf.bend, lf.flip);
    const shade = Math.pow(clamp(1 - lf.z, 0, 1), 0.6);
    const col = lerp3([34, 76, 26], [92, 132, 54], clamp(0.12 + 0.7 * rng() * (0.6 + 0.4 * shade)));
    paintLeafCard(g, hc, shape, place, col, { len: lf.len, kind: "fern", rng });
  }
  return finishCard(g, hc, S, seed, 4);
}

// ================================================================================================
// FOREST FLOOR
// ================================================================================================
// Damp dark soil, olive moss patches, and hundreds of overlapping painted fallen leaves in three
// layers (decayed, mid, fresh) plus twigs and nut husks. Low overall brightness: it lives in mist
// and shadow. Tileable in U and V. One tile is about 2 m of floor.
export function createGroundTextures({ seed = 11, size = 512 } = {}) {
  return cached("ground", { seed, size }, () => buildGround(seed, size));
}

function litterLeaf(g, hc, rng, x, y, len, col, layer, detail) {
  const kinds = ["oak", "beech", "sprig", "maple", "oak", "beech"];
  const shape = buildShape(kinds[Math.floor(rng() * kinds.length)], rng);
  const ang = rng() * TAU;
  const bend = (rng() - 0.5) * 0.7;
  const flip = rng() < 0.5 ? 1 : -1;
  const gray = 105 + layer * 34 + rng() * 14;
  wrapDraw(g.canvas.width, x, y, len * 1.15, (dx, dy) => {
    const place = placer(x + dx, y + dy, ang, len, bend, flip);
    const pts = shape.outline.map(([u, v]) => place(u, v));
    // soft drop shadow on what lies below
    g.save();
    g.translate(1.5, 2.5);
    leafPath(g, pts);
    g.fillStyle = "rgba(0,0,0,0.38)";
    g.fill();
    g.restore();
    leafPath(g, pts);
    g.fillStyle = css(col);
    g.fill();
    // darker, slightly decayed margin
    g.lineWidth = Math.max(1.2, len * 0.05);
    g.strokeStyle = css(scale3(col, 0.62), 0.5);
    g.stroke();
    // midrib
    const a0 = place(0, 0);
    const b0 = place(0.97, 0);
    if (detail) {
      g.beginPath();
      g.moveTo(a0[0], a0[1]);
      g.lineTo(b0[0], b0[1]);
      g.lineWidth = Math.max(1, len * 0.026);
      g.strokeStyle = css(lerp3(col, [200, 175, 120], 0.38), 0.55);
      g.stroke();
    }
    leafPath(hc, pts);
    hc.fillStyle = `rgb(${gray},${gray},${gray})`;
    hc.fill();
    hc.lineWidth = Math.max(1.6, len * 0.06);
    hc.strokeStyle = `rgba(${gray - 55},${gray - 55},${gray - 55},0.8)`;
    hc.stroke();
  });
}

function buildGround(seed, S) {
  const rng = createRng(seed * 6007 + 3);
  const noise = createNoise(seed + 31);
  const { ctx: g } = makeCanvas(S, S);
  const { ctx: hc } = makeCanvas(S, S);

  // ---- soil base, painted straight into canvas orientation ---------------------------------------
  const K = S >> 1;
  const A = new Float32Array(K * K);
  const B = new Float32Array(K * K);
  const Hs = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const i = y * K + x;
      A[i] = noise.fbm2(u * 5, v * 5, 4, 5, 5) * 0.5 + 0.5;
      B[i] = noise.fbm2(u * 22 + 3, v * 22 + 1, 3, 22, 22) * 0.5 + 0.5;
      Hs[i] = noise.fbm2(u * 14 + 7, v * 14 + 2, 4, 14, 14) * 0.5 + 0.5;
    }
  }
  const Af = resampleBilinear(A, K, K, S, S, true);
  const Bf = resampleBilinear(B, K, K, S, S, true);
  const Hf = resampleBilinear(Hs, K, K, S, S, true);
  const earth = [38, 28, 17];
  const olive = [38, 52, 24];
  const green = rgbOf(PALETTE.floorLight);
  const floorDark = rgbOf(PALETTE.floorDark);
  const base = g.createImageData(S, S);
  const hbase = hc.createImageData(S, S);
  const SPT = speckleTable(seed);
  for (let i = 0; i < S * S; i++) {
    const a = smoothstep(0.3, 0.7, Af[i]);
    const b = Bf[i];
    const sp = SPT[(((i / S) & 255) << 8) | (i & 255)];
    // earth -> olive by patch noise, darker pockets, a little floor green; inlined (no allocation)
    const dk = smoothstep(0.55, 0.8, b) * 0.6;
    const gr = smoothstep(0.7, 0.9, Af[i] * 0.5 + b * 0.5) * 0.5;
    let r = earth[0] + (olive[0] - earth[0]) * a;
    let gg = earth[1] + (olive[1] - earth[1]) * a;
    let bl = earth[2] + (olive[2] - earth[2]) * a;
    r += (floorDark[0] - r) * dk;
    gg += (floorDark[1] - gg) * dk;
    bl += (floorDark[2] - bl) * dk;
    r += (green[0] - r) * gr;
    gg += (green[1] - gg) * gr;
    bl += (green[2] - bl) * gr;
    const k = 0.82 + 0.3 * sp;
    const o = i * 4;
    base.data[o] = r * k;
    base.data[o + 1] = gg * k;
    base.data[o + 2] = bl * k;
    base.data[o + 3] = 255;
    const hv = (0.25 + 0.3 * Hf[i] + 0.05 * sp) * 255;
    hbase.data[o] = hbase.data[o + 1] = hbase.data[o + 2] = hv;
    hbase.data[o + 3] = 255;
  }
  g.putImageData(base, 0, 0);
  hc.putImageData(hbase, 0, 0);

  // ---- leaf litter in three layers ----------------------------------------------------------------
  const k = S / 1024;
  const decayed = [[46, 38, 22], [58, 48, 28], [50, 54, 28], [40, 34, 20]];
  const mid = [[88, 66, 36], [104, 78, 42], [76, 56, 30], [112, 72, 34], [80, 76, 38], [94, 70, 38]];
  const fresh = [[132, 100, 54], [142, 106, 56], [100, 88, 42], [118, 78, 38], [64, 88, 36], [150, 124, 72]];
  const mossLitter = scale3(rgbOf(PALETTE.mossTone), 0.75);
  const layers = [
    { n: 130, pal: decayed, len: [54, 98], detail: false },
    { n: 165, pal: mid, len: [48, 94], detail: true },
    { n: 55, pal: fresh, len: [44, 84], detail: true },
  ];
  layers.forEach((L, li) => {
    for (let n = 0; n < L.n; n++) {
      // Pulled 30 percent toward brand moss: the floor is deep forest and moss with litter on it,
      // not an orange leaf carpet (the warm browns stay, with less saturation).
      const col = lerp3(scale3(L.pal[Math.floor(rng() * L.pal.length)], 0.78 + rng() * 0.3), mossLitter, 0.3);
      litterLeaf(g, hc, rng, rng() * S, rng() * S, (L.len[0] + rng() * (L.len[1] - L.len[0])) * k, col, li, L.detail && k > 0.45);
    }
    // twigs between layers so some lie under leaves and some over them
    if (li < 2) {
      const nt = li === 0 ? 12 : 10;
      for (let t = 0; t < nt; t++) paintTwig(g, hc, rng, S, k);
    }
  });
  // nut husks and beech mast scattered on top
  for (let n = 0; n < 30; n++) {
    const x = rng() * S;
    const rot = rng() * 3;
    const y = rng() * S;
    const r = (3 + rng() * 3.5) * k;
    const col = lerp3([62, 44, 24], [96, 70, 38], rng());
    wrapDraw(S, x, y, r * 2, (dx, dy) => {
      g.beginPath();
      g.ellipse(x + dx + 1, y + dy + 2, r * 1.1, r * 1.3, 0, 0, TAU);
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.fill();
      g.beginPath();
      g.ellipse(x + dx, y + dy, r, r * 1.25, rot, 0, TAU);
      g.fillStyle = css(col);
      g.fill();
      g.beginPath();
      g.ellipse(x + dx - r * 0.2, y + dy - r * 0.3, r * 0.45, r * 0.4, 0, 0, TAU);
      g.fillStyle = css(scale3(col, 1.35), 0.7);
      g.fill();
      hc.beginPath();
      hc.ellipse(x + dx, y + dy, r, r * 1.25, 0, 0, TAU);
      hc.fillStyle = "rgb(205,205,205)";
      hc.fill();
    });
  }

  // ---- pixel pass: moss, wetness, cavity AO ------------------------------------------------------
  const rgba = readCanvasFlipped(g, S, S);
  const hgt = canvasToHeight(hc, S, S);
  const cav = blurField(hgt, S, S, Math.max(3, Math.round(6 * k)), true);
  const Mk = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) Mk[y * K + x] = noise.fbm2(((x + 0.5) / K) * 4 + 2, v * 4 + 5, 4, 4, 4);
  }
  const Mf = resampleBilinear(Mk, K, K, S, S, true);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const mossA = [40, 62, 22];
  const mossB = [78, 104, 40];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const o = i * 4;
      const h = hgt[i];
      const sp = hash2(x, y, seed + 5);
      // moss collects in the lower, flatter places between leaves
      const mw = smoothstep(0.2, 0.52, Mf[i]) * (0.35 + 0.65 * (1 - smoothstep(0.35, 0.7, h)));
      const mk = Math.min(1, mw * 1.5) * 0.88;
      const m0 = 0.7 + 0.6 * hash2(x >> 1, y >> 1, seed + 8);
      let r = rgba[o];
      let gg = rgba[o + 1];
      let b = rgba[o + 2];
      r += (mix(mossA[0], mossB[0], sp) * m0 - r) * mk;
      gg += (mix(mossA[1], mossB[1], sp) * m0 - gg) * mk;
      b += (mix(mossA[2], mossB[2], sp) * m0 - b) * mk;
      // damp darkening in hollows, overall low key
      const cavity = h - cav[i];
      const damp = 1 - 0.3 * smoothstep(0.25, 0.0, cavity + 0.05);
      const low = 0.72;
      rgba[o] = r * damp * low;
      rgba[o + 1] = gg * damp * low;
      rgba[o + 2] = b * damp * low;
      hgt[i] = h + mk * 0.05 * sp;
      rough[i] = clamp(0.86 - 0.12 * smoothstep(0.15, -0.1, cavity) + 0.1 * mk);
      ao[i] = clamp(0.62 + cavity * 4.2, 0.18, 1);
    }
  }
  return pbrSet(rgba, hgt, rough, ao, S, S, 3.5);
}

function paintTwig(g, hc, rng, S, k) {
  const x0 = rng() * S;
  const y0 = rng() * S;
  const dir = rng() * TAU;
  const len = (90 + rng() * 170) * k;
  const w = (3 + rng() * 2.6) * k;
  const col = lerp3([54, 40, 26], [84, 64, 40], rng());
  const pts = [];
  let a = dir;
  let x = 0;
  let y = 0;
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    pts.push([x, y]);
    a += (rng() - 0.5) * 0.28;
    x += (Math.cos(a) * len) / steps;
    y += (Math.sin(a) * len) / steps;
  }
  const fork = pts[Math.floor(steps * (0.4 + rng() * 0.3))];
  const forkDir = dir + (rng() < 0.5 ? 1 : -1) * (0.5 + rng() * 0.5);
  const forkLen = len * (0.25 + rng() * 0.25);
  wrapDraw(S, x0, y0, len * 1.1, (dx, dy) => {
    const draw = (ctx, shadow, colour, widthK) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const off = shadow ? [1.5, 2.5] : [0, 0];
      for (let i = 0; i < pts.length - 1; i++) {
        const t = i / (pts.length - 1);
        ctx.beginPath();
        ctx.moveTo(x0 + dx + pts[i][0] + off[0], y0 + dy + pts[i][1] + off[1]);
        ctx.lineTo(x0 + dx + pts[i + 1][0] + off[0], y0 + dy + pts[i + 1][1] + off[1]);
        ctx.lineWidth = w * (1 - 0.6 * t) * widthK;
        ctx.strokeStyle = colour;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x0 + dx + fork[0] + off[0], y0 + dy + fork[1] + off[1]);
      ctx.lineTo(x0 + dx + fork[0] + Math.cos(forkDir) * forkLen + off[0], y0 + dy + fork[1] + Math.sin(forkDir) * forkLen + off[1]);
      ctx.lineWidth = w * 0.5 * widthK;
      ctx.strokeStyle = colour;
      ctx.stroke();
    };
    draw(g, true, "rgba(0,0,0,0.38)", 1.15);
    draw(hc, true, "rgba(40,40,40,0.5)", 1.15);
    draw(g, false, css(col), 1);
    // lit upper edge
    g.save();
    g.translate(-0.8, -0.8);
    draw(g, false, css(scale3(col, 1.4), 0.35), 0.35);
    g.restore();
    draw(hc, false, "rgb(190,190,190)", 1);
  });
}

// ================================================================================================
// ROPE (twisted manila, 3 strands)
// ================================================================================================
// Tileable in U (around the rope) and V (along it, 4 full twists per tile). The strands run
// diagonally; finer yarn twists run the opposite way on top. U covers the circumference.
// Returns { map, normalMap, roughnessMap }.
export function createRopeTextures({ seed = 9, size = 256 } = {}) {
  return cached("rope", { seed, size }, () => buildRope(seed, size));
}

function buildRope(seed, S) {
  const noise = createNoise(seed + 101);
  const STR = 3; // strands around
  const TW = 4; // twists along one tile
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const KX = 10;
  const KY = 3;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const i = y * S + x;
      const p = u * STR - v * TW; // strand phase: constant along the slanted strand
      const fp = p - Math.floor(p);
      const t = 2 * fp - 1;
      const round = Math.sqrt(Math.max(0, 1 - t * t));
      const strandId = Math.floor(p) - Math.floor(p / STR) * STR;
      // fibres aligned with the strand; period equals one strand so they stay seamless
      const fa = noise.perlin2(p * KX, (u * TW + v * STR) * KY, KX, KY);
      const fb = noise.perlin2(u * 96, v * 96, 96, 96);
      const fib = 0.65 * fa + 0.35 * fb;
      // yarn twists: finer helix the opposite way
      const q = u * 22 + v * 18;
      const yarn = 0.5 + 0.5 * Math.sin(TAU * q + fa * 1.5);
      const h = 0.12 + 0.62 * Math.pow(round, 0.8) + 0.16 * round * yarn + 0.05 * fib;
      const lit = clamp(0.2 + 0.8 * Math.pow(round, 0.7));
      let r = 74 + (192 - 74) * (lit * (0.78 + 0.22 * yarn) * (0.88 + 0.16 * fib));
      let g = 60 + (168 - 60) * (lit * (0.78 + 0.22 * yarn) * (0.88 + 0.16 * fib));
      let b = 38 + (120 - 38) * (lit * (0.78 + 0.22 * yarn) * (0.88 + 0.16 * fib));
      const sv = 0.95 + 0.1 * ((strandId * 0.37) % 1);
      r *= sv;
      g *= sv;
      b *= sv;
      // loose hairs catching the light
      if (hash2(x, y, seed) > 0.992) {
        r += 34;
        g += 30;
        b += 22;
      }
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      hgt[i] = h;
      rough[i] = 0.9 + 0.08 * (1 - round);
      ao[i] = clamp(0.28 + 0.72 * Math.pow(round, 0.7));
    }
  }
  return pbrSet(rgba, hgt, rough, ao, S, S, 5.5);
}

// ================================================================================================
// MOSS CARPET
// ================================================================================================
// Dense cushion moss: tiny rounded bumps, green with yellow-green tips. Tileable. For roofs,
// rocks, branch tops, as a decal texture or a ground cover layer. Returns { map, normalMap, roughnessMap }.
export function createMossTexture({ seed = 4, size = 256 } = {}) {
  return cached("moss", { seed, size }, () => buildMoss(seed, size));
}

function buildMoss(seed, S) {
  const noise = createNoise(seed + 55);
  const NC = 40;
  const wor = createWorley(seed + 3, NC, NC, 0.95);
  const SP = speckleTable(seed);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const dark = rgbOf(PALETTE.leafDark);
  const mid = rgbOf(PALETTE.leafMid);
  const hi = rgbOf(PALETTE.leafHighlight);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const i = y * S + x;
      // irregular clumps: warped Voronoi domes modulated by fbm, then shaggy fibre noise on top
      const nz = noise.fbm2(u * 8, v * 8, 4, 8, 8);
      wor.sample(u * NC + nz * 2.2, v * NC + noise.fbm2(u * 8 + 4, v * 8 + 4, 2, 8, 8) * 2.2);
      const dome = clamp(1 - wor.f1 * 1.25);
      const clump = 0.5 + 0.5 * nz;
      const sp = SP[((y & 255) << 8) | (x & 255)];
      const sp2 = SP[(((y * 3) & 255) << 8) | ((x * 7 + 11) & 255)];
      const h = 0.22 + 0.5 * dome * (0.6 + 0.4 * wor.id) + 0.2 * clump + 0.1 * (sp - 0.5);
      const tip = smoothstep(0.5, 0.95, dome * (0.6 + 0.4 * wor.id) + 0.25 * (sp - 0.5));
      let c = lerp3(dark, mid, clamp(0.2 + 0.7 * clump * (0.5 + 0.5 * dome)));
      c = lerp3(c, hi, tip * 0.65);
      c = lerp3(c, [146, 150, 62], tip * smoothstep(0.6, 0.95, wor.id) * 0.45);
      const k = (0.5 + 0.65 * smoothstep(0, 0.9, dome)) * (0.85 + 0.3 * sp2);
      const o = i * 4;
      rgba[o] = c[0] * k;
      rgba[o + 1] = c[1] * k;
      rgba[o + 2] = c[2] * k;
      rgba[o + 3] = 255;
      hgt[i] = h;
      rough[i] = 0.94;
      ao[i] = clamp(0.3 + 0.8 * smoothstep(0, 0.8, dome));
    }
  }
  return pbrSet(rgba, hgt, rough, ao, S, S, 5);
}

// ================================================================================================
// SPRITES (mist, motes, soft particles) and glass
// ================================================================================================
// Radial alpha sprite, white RGB, for Points / Sprites / planes with transparent blending.
//   kind 'soft' (default) smooth falloff, 'mote' small bright core with halo (dust, pollen),
//        'mist' noisy wispy cloud puff. power shapes the falloff. Returns ONE texture.
export function createSoftSpriteTexture({ size = 128, kind = "soft", power = 2, seed = 1 } = {}) {
  return cached("sprite", { size, kind, power, seed }, () => {
    const S = size;
    const noise = createNoise(seed + 700);
    const rgba = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = ((x + 0.5) / S) * 2 - 1;
        const dy = ((y + 0.5) / S) * 2 - 1;
        const r = Math.sqrt(dx * dx + dy * dy);
        let a;
        if (kind === "mote") a = Math.exp(-Math.pow(r * 3.2, 2)) + 0.22 * Math.pow(Math.max(0, 1 - r), 2.5);
        else if (kind === "mist") {
          const n = noise.simplexFbm2(dx * 2.2 + 3, dy * 2.2 + 1, 4) * 0.5 + 0.5;
          a = Math.pow(Math.max(0, 1 - r), power) * (0.35 + 0.9 * n);
        } else a = Math.pow(Math.max(0, 1 - r), power);
        const o = (y * S + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 255;
        rgba[o + 3] = clamp(a) * 255;
      }
    }
    // non-tiling, no coverage fix: it is a soft gradient
    return { map: makeTexture(rgba, S, S, { srgb: true, tile: false }) };
  }).map;
}

// Window glass: mostly clean (low roughness) with smudges, rain runs and dust that raise
// roughness. Use as roughnessMap on a glass / transmission material. Returns { roughnessMap }.
export function createGlassSmudgeTexture({ seed = 6, size = 256 } = {}) {
  return cached("glass", { seed, size }, () => {
    const S = size;
    const noise = createNoise(seed + 900);
    const n = S * S;
    const rough = new Float32Array(n);
    const ao = new Float32Array(n).fill(1);
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S;
        const blot = smoothstep(0.1, 0.55, noise.fbm2(u * 3 + 1, v * 3 + 2, 4, 3, 3) * 0.5 + 0.5 - 0.15);
        const runs = smoothstep(0.62, 0.9, noise.fbm2(u * 18, v * 2, 3, 18, 2) * 0.5 + 0.5);
        const dust = hash2(x, y, seed) > 0.985 ? 0.25 : 0;
        rough[y * S + x] = clamp(0.07 + 0.3 * blot + 0.22 * runs + dust);
      }
    }
    return { roughnessMap: makeTexture(packRoughAO(rough, ao, n), S, S) };
  }).roughnessMap;
}
