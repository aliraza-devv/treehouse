// Seeded noise toolkit for the procedural texture generators.
//
// Everything is deterministic for a given seed. The hot paths are written for tight loops over
// typed arrays (no per-sample allocation, no closures created per pixel).
//
// Overview
//   createNoise(seed)      -> gradient (Perlin) noise with optional PERIODIC lattice, simplex 2D/3D,
//                             fbm, ridged fbm and billow helpers
//   createWorley(seed,...) -> periodic cellular noise (F1, F2, F2-F1, nearest cell id)
//   fillFbm(...)           -> fills a Float32Array with (tileable) fbm, 0..1
//   resampleBilinear(...)  -> cheap up/down sampling of scalar fields (compute coarse, upsample)
//   hash2 / hash3          -> integer hashes returning [0, 1)
//
// Convention for scalar fields used across the toolkit: Float32Array of w*h, index = y*w + x,
// row y = 0 is v = 0 (the BOTTOM of the texture in three.js UV space).

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const fract = (x) => x - Math.floor(x);

// Integer hashes (good enough avalanche for texture work), result in [0, 1).
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z, seed = 0) {
  return hash2(x + Math.imul(z | 0, 0x632be5ab), y ^ Math.imul(z | 0, 0x2545f491), seed);
}

// Quintic fade curve (Perlin's improved interpolant, C2 continuous so normals do not crease).
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 12 simplex gradients for 3D.
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1,
  -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// Build a deterministic permutation table from a seed (Fisher-Yates driven by hash2).
function buildPerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(hash2(i, 7919, seed) * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

export function createNoise(seed = 1) {
  const perm = buildPerm(seed);
  // Unit gradient table for 2D gradient noise: 256 random directions (not axis-biased).
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = hash2(i, 31337, seed) * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }

  // ---- 2D gradient (Perlin) noise, optionally periodic -------------------------------------------
  // x, y are in lattice units. If px > 0 the noise repeats every px lattice cells along x (same for
  // py/y); pass 0 for no repetition (the table then repeats every 256 cells, i.e. never in practice).
  // Result is roughly in [-1, 1].
  function perlin2(x, y, px = 0, py = 0) {
    const x0f = Math.floor(x);
    const y0f = Math.floor(y);
    const fx = x - x0f;
    const fy = y - y0f;
    let i0;
    let i1;
    let j0;
    let j1;
    if (px > 0) {
      i0 = x0f - px * Math.floor(x0f / px);
      i1 = i0 + 1 === px ? 0 : i0 + 1;
    } else {
      i0 = x0f & 255;
      i1 = (x0f + 1) & 255;
    }
    if (py > 0) {
      j0 = y0f - py * Math.floor(y0f / py);
      j1 = j0 + 1 === py ? 0 : j0 + 1;
    } else {
      j0 = y0f & 255;
      j1 = (y0f + 1) & 255;
    }
    const pi0 = perm[i0 & 255];
    const pi1 = perm[i1 & 255];
    const h00 = perm[pi0 + (j0 & 255)];
    const h10 = perm[pi1 + (j0 & 255)];
    const h01 = perm[pi0 + (j1 & 255)];
    const h11 = perm[pi1 + (j1 & 255)];
    const n00 = gx[h00] * fx + gy[h00] * fy;
    const n10 = gx[h10] * (fx - 1) + gy[h10] * fy;
    const n01 = gx[h01] * fx + gy[h01] * (fy - 1);
    const n11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    // 1.41 rescales the theoretical +-0.707 range of unit-gradient Perlin to about +-1.
    return (a + (b - a) * v) * 1.41;
  }

  // ---- 2D simplex noise (not periodic) ----------------------------------------------------------
  function simplex2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = perm[ii + perm[jj]];
      t0 *= t0;
      n0 = t0 * t0 * (gx[g] * x0 + gy[g] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = perm[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * (gx[g] * x1 + gy[g] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = perm[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * (gx[g] * x2 + gy[g] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  // ---- 3D simplex noise (not periodic) ----------------------------------------------------------
  function simplex3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1;
    let j1;
    let k1;
    let i2;
    let j2;
    let k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    let tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) {
      const g = (perm[ii + perm[jj + perm[kk]]] % 12) * 3;
      tt *= tt;
      n += tt * tt * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
    }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) {
      const g = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12) * 3;
      tt *= tt;
      n += tt * tt * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
    }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) {
      const g = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12) * 3;
      tt *= tt;
      n += tt * tt * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
    }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) {
      const g = (perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12) * 3;
      tt *= tt;
      n += tt * tt * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
    }
    return 32 * n;
  }

  // ---- fractal sums -----------------------------------------------------------------------------
  // fbm of the periodic gradient noise. (x, y) in lattice units of the FIRST octave; px, py are the
  // first-octave periods (0 = non periodic). Each octave doubles frequency AND period so the sum
  // stays periodic. Result roughly in [-1, 1].
  function fbm2(x, y, octaves = 5, px = 0, py = 0, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * perlin2(x * f + o * 17.3, y * f + o * 9.1, px * f, py * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  // Ridged multifractal: sharp creases where the base noise crosses zero. Result in [0, 1].
  function ridged2(x, y, octaves = 5, px = 0, py = 0, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(perlin2(x * f + o * 17.3, y * f + o * 9.1, px * f, py * f));
      n *= n;
      n *= weight;
      weight = clamp(n * 2);
      sum += n * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  // Billow: |noise| folds, giving puffy rounded lumps. Result in [0, 1].
  function billow2(x, y, octaves = 4, px = 0, py = 0, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * Math.abs(perlin2(x * f + o * 17.3, y * f + o * 9.1, px * f, py * f));
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  // fbm of simplex (non-periodic) for places that do not need to tile (leaf painting, sprites).
  function simplexFbm2(x, y, octaves = 5, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * simplex2(x * f + o * 5.7, y * f + o * 3.3);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  return { seed, perlin2, simplex2, simplex3, fbm2, ridged2, billow2, simplexFbm2 };
}

// ------------------------------------------------------------------------------------------------
// Worley (cellular) noise on a PERIODIC grid of nx by ny cells. Feature points are precomputed
// per cell so sampling is just 9 table lookups.
//   w = createWorley(seed, 12, 4); w.sample(u, v)  where u in [0, nx), v in [0, ny) (cell units)
// After sample(): w.f1, w.f2 (distances in cell units), w.id (random 0..1 per nearest cell),
// w.cx, w.cy (integer cell of nearest feature), w.dx, w.dy (vector to nearest feature, unwrapped).
// Anisotropic cells are done by the caller scaling u and v differently (nx != ny in cells per tile
// while the texture is square gives stretched cells).
// ------------------------------------------------------------------------------------------------
export function createWorley(seed, nx, ny, jitter = 0.95) {
  const fpx = new Float32Array(nx * ny);
  const fpy = new Float32Array(nx * ny);
  const ids = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      fpx[k] = 0.5 + (hash2(i, j, seed) - 0.5) * jitter;
      fpy[k] = 0.5 + (hash2(i, j, seed + 101) - 0.5) * jitter;
      ids[k] = hash2(i, j, seed + 977);
    }
  }
  const out = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0, dx: 0, dy: 0, nx, ny };
  out.sample = (u, v) => {
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    let f1 = 1e9;
    let f2 = 1e9;
    let bestK = 0;
    let bx = 0;
    let by = 0;
    let bcx = 0;
    let bcy = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const cj = iv + dj;
      const wj = cj - ny * Math.floor(cj / ny);
      for (let di = -1; di <= 1; di++) {
        const ci = iu + di;
        const wi = ci - nx * Math.floor(ci / nx);
        const k = wj * nx + wi;
        const dx = ci + fpx[k] - u;
        const dy = cj + fpy[k] - v;
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          bestK = k;
          bx = dx;
          by = dy;
          bcx = ci;
          bcy = cj;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = ids[bestK];
    out.dx = bx;
    out.dy = by;
    out.cx = bcx;
    out.cy = bcy;
    return out;
  };
  return out;
}

// ------------------------------------------------------------------------------------------------
// Field helpers
// ------------------------------------------------------------------------------------------------

// Fill `out` (w*h Float32Array) with fbm in [0, 1].
//   fx, fy      lattice cells across the tile in x and y (integers when periodic)
//   periodicX/Y wrap the pattern so the field tiles in that direction
//   mode        'fbm' | 'ridged' | 'billow'
//   warp        optional { noise, amp, freq } domain warp: the sample point is displaced by two
//               periodic low frequency fields (amp in lattice cells of the base frequency).
export function fillFbm(noise, out, w, h, opts = {}) {
  const {
    fx = 4,
    fy = 4,
    octaves = 5,
    gain = 0.5,
    periodicX = true,
    periodicY = true,
    mode = 'fbm',
    ox = 0,
    oy = 0,
    warp = null,
  } = opts;
  const px = periodicX ? fx : 0;
  const py = periodicY ? fy : 0;
  const fn = mode === 'ridged' ? noise.ridged2 : mode === 'billow' ? noise.billow2 : noise.fbm2;
  const remap = mode === 'fbm';
  const wn = warp ? warp.noise || noise : null;
  const wf = warp ? warp.freq || 2 : 0;
  const wa = warp ? warp.amp || 1 : 0;
  const wpx = periodicX ? Math.max(1, Math.round(wf)) : 0;
  const wpy = periodicY ? Math.max(1, Math.round(wf)) : 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let sx = u * fx + ox;
      let sy = v * fy + oy;
      if (warp) {
        sx += wn.perlin2(u * wf + 3.1, v * wf + 7.7, wpx, wpy) * wa;
        sy += wn.perlin2(u * wf + 11.3, v * wf + 1.9, wpx, wpy) * wa;
      }
      const n = fn(sx, sy, octaves, px, py, gain);
      out[y * w + x] = remap ? n * 0.5 + 0.5 : n;
    }
  }
  return out;
}

// Bilinear resample of a scalar field. wrap = true treats the field as periodic (tileable).
// Column indices and weights are computed once, then reused for every row.
export function resampleBilinear(src, sw, sh, dw, dh, wrap = true) {
  const dst = new Float32Array(dw * dh);
  const sxScale = sw / dw;
  const syScale = sh / dh;
  const cx0 = new Int32Array(dw);
  const cx1 = new Int32Array(dw);
  const ctx = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = (x + 0.5) * sxScale - 0.5;
    let x0 = Math.floor(fx);
    ctx[x] = fx - x0;
    let x1 = x0 + 1;
    if (wrap) {
      x0 = (x0 + sw) % sw;
      x1 = x1 % sw;
    } else {
      x0 = x0 < 0 ? 0 : x0;
      x1 = x1 >= sw ? sw - 1 : x1;
    }
    cx0[x] = x0;
    cx1[x] = x1;
  }
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * syScale - 0.5;
    let y0 = Math.floor(fy);
    const ty = fy - y0;
    let y1 = y0 + 1;
    if (wrap) {
      y0 = (y0 + sh) % sh;
      y1 = y1 % sh;
    } else {
      y0 = y0 < 0 ? 0 : y0;
      y1 = y1 >= sh ? sh - 1 : y1;
    }
    const r0 = y0 * sw;
    const r1 = y1 * sw;
    const o = y * dw;
    const iy = 1 - ty;
    for (let x = 0; x < dw; x++) {
      const a = src[r0 + cx0[x]];
      const b = src[r0 + cx1[x]];
      const c = src[r1 + cx0[x]];
      const d = src[r1 + cx1[x]];
      const t = ctx[x];
      dst[o + x] = (a + (b - a) * t) * iy + (c + (d - c) * t) * ty;
    }
  }
  return dst;
}

// Separable box blur on a (periodic) scalar field, in place friendly (returns a new array).
export function blurField(src, w, h, radius, wrap = true) {
  if (radius < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const inv = 1 / (2 * radius + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const xx = wrap ? (k + w) % w : clamp(k, 0, w - 1);
      acc += src[row + xx];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      const addX = wrap ? (x + radius + 1) % w : Math.min(w - 1, x + radius + 1);
      const subX = wrap ? (x - radius + w) % w : Math.max(0, x - radius);
      acc += src[row + addX] - src[row + subX];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const yy = wrap ? (k + h) % h : clamp(k, 0, h - 1);
      acc += tmp[yy * w + x];
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      const addY = wrap ? (y + radius + 1) % h : Math.min(h - 1, y + radius + 1);
      const subY = wrap ? (y - radius + h) % h : Math.max(0, y - radius);
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return dst;
}

// Domain warp helper for one-off point queries: returns the warped coordinate pair in `out`.
//   warp2(noise, x, y, freq, amp, out)  displaces (x, y) by two perlin fields.
export function warp2(noise, x, y, freq, amp, out = { x: 0, y: 0 }, px = 0, py = 0) {
  out.x = x + noise.perlin2(x * freq + 3.1, y * freq + 7.7, px * freq, py * freq) * amp;
  out.y = y + noise.perlin2(x * freq + 11.3, y * freq + 1.9, px * freq, py * freq) * amp;
  return out;
}
