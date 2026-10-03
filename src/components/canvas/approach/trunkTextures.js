// Runtime-painted textures for the approach trunks that the shared toolkit does not make:
//
//   paintSmoothBark(variant)   beech (smooth grey skin, fine horizontal wrinkles, pale lichen crust),
//                              hornbeam (grey, streaked and cracked in long vertical muscles) and silver
//                              birch (white papery bark, black lenticel dashes, dark fissured patches).
//   paintLichenStrands()       a small alpha card of hanging beard lichen for the broken branches.
//
// The painters are GENERATORS: they yield between row blocks so the scheduler (trunkBuild.js) can spread a
// 100 ms paint over several frames. Every result is a standard PBR set (map sRGB, normalMap OpenGL
// convention, roughnessMap with R = ambient occlusion and G = roughness, so it can also be the aoMap),
// seamless in U (it wraps round a trunk) and tileable in V, exactly like createBarkTextures.
//
// Pure typed-array maths (no canvas), deterministic per seed. The caller owns the returned textures and
// must dispose them (they are NOT in the shared toolkit cache).

import * as THREE from "three";
import { createNoise, resampleBilinear, clamp, smoothstep, hash2 } from "@/lib/noise";
import { createRng } from "@/lib/random";
import { smoothBarkColours, LICHEN_STRAND } from "./trunkTones";

const ANISOTROPY = 8;
const ROWS_PER_CHUNK = 48; // rows painted between yields

function makeTexture(bytes, w, h, { srgb = false, tile = true } = {}) {
  const tex = new THREE.DataTexture(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length),
    w,
    h,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = ANISOTROPY;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Height field -> tangent space normal map (Sobel, OpenGL convention, wraps in both directions).
// strength is resolution independent (see the toolkit: 4 tilts the normal 63 degrees for a unit step per
// texel at 1024).
function heightToNormal(hgt, w, h, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  const k = (strength * (w / 1024)) / 2;
  for (let y = 0; y < h; y++) {
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

function packRoughAO(rough, ao, n) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = ao[i] * 255;
    out[o + 1] = rough[i] * 255;
    out[o + 3] = 255;
  }
  return out;
}

// 256 x 256 random table: a cheap per-pixel speckle source (a hash per pixel is too slow).
function speckleTable(seed) {
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) t[i] = hash2(i & 255, i >> 8, seed + 4242);
  return t;
}

export function disposeTextureSet(set) {
  if (!set) return;
  for (const k of Object.keys(set)) if (set[k] && set[k].isTexture) set[k].dispose();
}

// ------------------------------------------------------------------------------------------------
// SMOOTH BARK
// ------------------------------------------------------------------------------------------------
// Returns a generator. Drive it with next() until done; the final value is { map, normalMap, roughnessMap }.
export function* paintSmoothBark({ variant, seed, size }) {
  const S = size;
  const K = Math.max(128, S >> 1); // slow fields are computed at half resolution then upsampled
  const noise = createNoise(seed * 31 + variant.length * 7);
  const C = smoothBarkColours(variant);
  const SP = speckleTable(seed);
  const birch = variant === "birch";
  const horn = variant === "hornbeam";

  // ---- coarse periodic fields (all tile in U and V) ---------------------------------------------
  const Ft = new Float32Array(K * K); // large scale tone
  const Fm = new Float32Array(K * K); // mottling
  const Fl = new Float32Array(K * K); // lichen / dark patch mask
  const Fb = new Float32Array(K * K); // peeling band / streak tone
  for (let y = 0; y < K; y++) {
    const v = (y + 0.5) / K;
    for (let x = 0; x < K; x++) {
      const u = (x + 0.5) / K;
      const i = y * K + x;
      Ft[i] = noise.fbm2(u * 5, v * 5, 3, 5, 5);
      Fm[i] = noise.fbm2(u * 17 + 3, v * 17 + 7, 3, 17, 17);
      Fl[i] = noise.fbm2(u * (birch ? 4 : 6) + 1, v * (birch ? 3 : 6) + 4, 3, birch ? 4 : 6, birch ? 3 : 6);
      Fb[i] = birch ? noise.fbm2(u * 3, v * 36, 2, 3, 36) : horn ? noise.fbm2(u * 30, v * 3, 2, 30, 3) : noise.fbm2(u * 9, v * 7, 2, 9, 7);
    }
  }
  const up = (f) => resampleBilinear(f, K, K, S, S, true);
  const Tf = up(Ft);
  const Mf = up(Fm);
  const Lf = up(Fl);
  const Bf = up(Fb);
  yield;

  // ---- birch lenticels: short horizontal dark dashes, denser and bolder low on the tile ------------
  const dash = new Float32Array(S * S);
  if (birch) {
    const rng = createRng(seed * 977 + 5);
    const n = Math.round(S * 0.9);
    for (let d = 0; d < n; d++) {
      const cx = rng() * S;
      const cy = rng() * S;
      const w = (6 + rng() * 22) * (S / 512);
      const hgt = (1.2 + rng() * 1.8) * (S / 512);
      const strength = 0.55 + rng() * 0.45;
      const x0 = Math.floor(cx - w);
      const x1 = Math.ceil(cx + w);
      const y0 = Math.floor(cy - hgt - 1);
      const y1 = Math.ceil(cy + hgt + 1);
      for (let yy = y0; yy <= y1; yy++) {
        const wy = ((yy % S) + S) % S;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = (xx - cx) / w;
          const dy = (yy - cy) / hgt;
          const e = dx * dx + dy * dy;
          if (e >= 1) continue;
          const wx = ((xx % S) + S) % S;
          const a = (1 - e) * strength;
          const idx = wy * S + wx;
          if (a > dash[idx]) dash[idx] = a;
        }
      }
    }
  }
  yield;

  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const { dark, light, lichen, algae } = C;
  const black = C.black || dark;
  const brown = C.brown || dark;

  for (let y0 = 0; y0 < S; y0 += ROWS_PER_CHUNK) {
    const yEnd = Math.min(S, y0 + ROWS_PER_CHUNK);
    for (let y = y0; y < yEnd; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S;
        const i = y * S + x;
        const sp = SP[((y & 255) << 8) | (x & 255)];
        const sp2 = SP[(((y + 113) & 255) << 8) | ((x + 59) & 255)];
        const tone = clamp(0.5 + 0.5 * Tf[i]);
        const mott = 1 + 0.1 * Mf[i] + 0.035 * (sp - 0.5);
        let r;
        let g;
        let b;
        let h = 0.5;
        let rg = 0.82;
        let aoV = 1;

        if (birch) {
          // papery white with warm grey shade, horizontal peeling bands (curling paper edges)
          const band = Bf[i];
          const shadeT = clamp(0.35 + 0.5 * band + 0.25 * Tf[i]);
          r = light[0] + (dark[0] - light[0]) * shadeT * 0.8;
          g = light[1] + (dark[1] - light[1]) * shadeT * 0.8;
          b = light[2] + (dark[2] - light[2]) * shadeT * 0.8;
          // thin horizontal paper edges: ridged noise stretched along U
          const edge = noise.perlin2(u * 4 + Mf[i] * 0.4, v * 30, 4, 30);
          const paper = 1 - smoothstep(0.0, 0.07, Math.abs(edge)); // 1 on an edge line
          r *= 1 - 0.14 * paper;
          g *= 1 - 0.14 * paper;
          b *= 1 - 0.12 * paper;
          h += 0.1 * paper;
          // dark fissured patches (old bark at branch collars and the base): ragged mask
          const patch = smoothstep(0.1, 0.34, Lf[i] + (sp - 0.5) * 0.18);
          const fis = noise.perlin2(u * 22 + Bf[i], v * 12, 22, 12);
          const ridge = smoothstep(-0.1, 0.35, fis);
          const pr = black[0] + (brown[0] - black[0]) * ridge * 0.6;
          const pg = black[1] + (brown[1] - black[1]) * ridge * 0.6;
          const pb = black[2] + (brown[2] - black[2]) * ridge * 0.6;
          r += (pr - r) * patch;
          g += (pg - g) * patch;
          b += (pb - b) * patch;
          h += patch * (0.18 * ridge - 0.08);
          // lenticels
          const dsh = dash[i] * (1 - patch);
          r += (black[0] - r) * dsh * 0.9;
          g += (black[1] - g) * dsh * 0.9;
          b += (black[2] - b) * dsh * 0.9;
          h -= dsh * 0.1;
          // faint algae green on the shaded flank
          const alg = smoothstep(0.35, 0.8, tone) * 0.12;
          r += (algae[0] - r) * alg;
          g += (algae[1] - g) * alg;
          b += (algae[2] - b) * alg;
          rg = 0.58 + 0.38 * patch + 0.06 * paper;
          aoV = 1 - 0.4 * patch * (1 - ridge) - 0.2 * paper - 0.3 * dsh;
        } else {
          // beech and hornbeam: grey skin, mottled, with a long wavelength tone drift
          const t = smoothstep(0.15, 0.85, tone);
          r = dark[0] + (light[0] - dark[0]) * t;
          g = dark[1] + (light[1] - dark[1]) * t;
          b = dark[2] + (light[2] - dark[2]) * t;
          r *= mott;
          g *= mott;
          b *= mott;
          let line = 0;
          let crack = 0;
          if (horn) {
            // long vertical streaks (muscle sheen) and thin dark cracks running with the grain
            const streak = Bf[i];
            const k = 1 + 0.16 * streak;
            r *= k;
            g *= k;
            b *= k;
            const cr = noise.perlin2(u * 56 + Mf[i] * 0.8, v * 6, 56, 6);
            crack = 1 - smoothstep(0.0, 0.055, Math.abs(cr));
            r *= 1 - 0.34 * crack;
            g *= 1 - 0.34 * crack;
            b *= 1 - 0.3 * crack;
            h += 0.06 * streak - 0.12 * crack;
          } else {
            // beech: fine horizontal wrinkles, strongest in patches (stretch lines around old scars)
            const w = noise.perlin2(u * 8 + Mf[i] * 0.5, v * 70, 8, 70);
            const crease = 1 - Math.abs(w);
            const zone = smoothstep(-0.25, 0.45, Bf[i]);
            line = smoothstep(0.84, 0.985, crease) * (0.35 + 0.65 * zone);
            r *= 1 - 0.2 * line;
            g *= 1 - 0.2 * line;
            b *= 1 - 0.18 * line;
            h += 0.12 * line * 1.0 + 0.04 * Bf[i];
          }
          // pale lichen crust: ragged-edged blotches on the smooth skin, with the odd dark fleck
          const lm = smoothstep(-0.05, 0.5, Lf[i]);
          const crust = smoothstep(0.38, 0.62, lm + (sp - 0.5) * 0.9);
          const lk = crust * (horn ? 0.5 : 0.72);
          r += (lichen[0] * (0.9 + 0.2 * sp2) - r) * lk;
          g += (lichen[1] * (0.9 + 0.2 * sp2) - g) * lk;
          b += (lichen[2] * (0.9 + 0.2 * sp2) - b) * lk;
          const fleck = sp2 > 0.988 && lm > 0.25 ? 1 : 0;
          r *= 1 - 0.5 * fleck;
          g *= 1 - 0.5 * fleck;
          b *= 1 - 0.5 * fleck;
          // faint green algae on the damp (low tone) areas
          const alg = (1 - t) * 0.1 * (1 - crust);
          r += (algae[0] - r) * alg;
          g += (algae[1] - g) * alg;
          b += (algae[2] - b) * alg;
          h += crust * 0.035 - fleck * 0.05;
          rg = 0.74 + 0.16 * crust - 0.05 * line + 0.05 * crack;
          aoV = 1 - 0.3 * line - 0.4 * crack - 0.15 * fleck;
        }
        const o = i * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
        hgt[i] = h;
        rough[i] = clamp(rg, 0.3, 1);
        ao[i] = clamp(aoV, 0.2, 1);
      }
    }
    yield;
  }

  const normal = heightToNormal(hgt, S, S, birch ? 3.4 : horn ? 3.2 : 2.6);
  yield;
  const packed = packRoughAO(rough, ao, S * S);
  return {
    map: makeTexture(rgba, S, S, { srgb: true }),
    normalMap: makeTexture(normal, S, S),
    roughnessMap: makeTexture(packed, S, S),
  };
}

// ------------------------------------------------------------------------------------------------
// LICHEN STRANDS (beard lichen hanging from broken branches)
// ------------------------------------------------------------------------------------------------
// 128 x 256 alpha card. The attachment is at the TOP centre, the strands hang down and taper. Alpha is
// the cut-out (use alphaTest 0.5). Colour is bled into the transparent pixels to avoid dark fringes.
export function paintLichenStrands(seed = 3) {
  const W = 128;
  const H = 256;
  const rng = createRng(seed * 3571 + 11);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const alpha = new Float32Array(W * H);
  const tone = new Float32Array(W * H);
  const strands = 34;
  for (let s = 0; s < strands; s++) {
    const x0 = W * (0.5 + (rng() - 0.5) * 0.7);
    const len = H * (0.35 + 0.6 * Math.pow(rng(), 0.7));
    const sway = (rng() - 0.5) * 38;
    const wob = rng() * 6.28;
    const wid = 1.3 + rng() * 1.5;
    const t0 = 0.4 + rng() * 0.5; // tone: lighter or darker strand
    const steps = Math.ceil(len * 1.4);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const y = t * len;
      // hangs from the top, drifts sideways a little with a slight wave
      const x = x0 + sway * t * t + Math.sin(t * 9 + wob) * 2.2 * t;
      const rr = wid * (1 - 0.8 * t) + 0.35;
      const xs = Math.floor(x - rr - 1);
      const xe = Math.ceil(x + rr + 1);
      const ys = Math.floor(y - rr - 1);
      const ye = Math.ceil(y + rr + 1);
      for (let yy = Math.max(0, ys); yy <= Math.min(H - 1, ye); yy++) {
        for (let xx = Math.max(0, xs); xx <= Math.min(W - 1, xe); xx++) {
          const d = Math.hypot(xx - x, yy - y) / rr;
          if (d >= 1) continue;
          const a = (1 - d * d) * (1 - 0.35 * t);
          const idx = yy * W + xx;
          if (a > alpha[idx]) {
            alpha[idx] = a;
            tone[idx] = t0 * (1 - 0.3 * t) + 0.25 * rng();
          }
        }
      }
    }
  }
  const [lr, lg, lb] = LICHEN_STRAND.light;
  const [dr, dg, db] = LICHEN_STRAND.dark;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const t = clamp(tone[i]);
    rgba[o] = dr + (lr - dr) * t;
    rgba[o + 1] = dg + (lg - dg) * t;
    rgba[o + 2] = db + (lb - db) * t;
    // sharpen to a cut-out: soft core stays opaque, the fringe falls under the 0.5 test
    rgba[o + 3] = clamp(alpha[i] * 1.8) * 255;
  }
  // transparent pixels keep a mid colour so bilinear filtering never mixes in black
  const mr = (lr + dr) / 2;
  const mg = (lg + dg) / 2;
  const mb = (lb + db) / 2;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 8) {
      rgba[o] = mr;
      rgba[o + 1] = mg;
      rgba[o + 2] = mb;
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer), W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
