// Runtime painted textures for the understorey flora. BROWSER ONLY (canvas 2D), nothing is read from
// a file. Every painter is a GENERATOR: it yields every few milliseconds of work so the caller (the
// build scheduler in floraAssemble.js) can spread painting across many frames. A painter returns its
// texture(s) with `return`, so drive it with `yield*` or the scheduler.
//
//   fern fronds       paintMaleFern, paintHartsTongue, paintBracken      (alpha cut, 2 fronds per atlas)
//   ground plants     paintMercury, paintSorrel, paintSedge, paintIvy, paintBramble
//   moss and litter   paintMossPatch, paintBeechLeaves, paintSoil
//   mushrooms         paintMushroom                                      (gills, stem, cap in one atlas)
//
// Alpha card conventions match src/lib/proceduralTextures.js: colour is bled into transparent pixels
// (no dark halos), and the mip chain preserves alpha coverage (leaves do not thin out with distance).
// Painted base is at the BOTTOM of each card (texture v = 0), tip at the top.

import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { createNoise, createWorley, clamp, mix, smoothstep, hash2 } from "@/lib/noise";
import { TONE, mixRgb, scaleRgb, rgbCss } from "./floraColor";
import { TEX } from "./floraTuning";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------
// Plumbing
// ------------------------------------------------------------------------------------------------
function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx;
}

export function makeTexture(bytes, w, h, { srgb = false, tile = false, mipmaps = null } = {}) {
  const tex = new THREE.DataTexture(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.generateMipmaps = !mipmaps;
  if (mipmaps) tex.mipmaps = mipmaps;
  tex.needsUpdate = true;
  return tex;
}

// Replace the colour of (nearly) transparent pixels with the local mean colour of the opaque ones, so
// bilinear and mip filtering never blend leaf colour with black.
function bleedColour(rgba, w, h) {
  const B = 8;
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const sum = new Float32Array(gw * gh * 4);
  for (let y = 0; y < h; y++) {
    const gy = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = rgba[o + 3];
      if (a === 0) continue;
      const g = (gy * gw + ((x / B) | 0)) * 4;
      sum[g] += rgba[o] * a;
      sum[g + 1] += rgba[o + 1] * a;
      sum[g + 2] += rgba[o + 2] * a;
      sum[g + 3] += a;
    }
  }
  const col = new Float32Array(gw * gh * 3);
  const filled = new Uint8Array(gw * gh);
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mw = 0;
  for (let g = 0; g < gw * gh; g++) {
    const a = sum[g * 4 + 3];
    if (a > 0) {
      col[g * 3] = sum[g * 4] / a;
      col[g * 3 + 1] = sum[g * 4 + 1] / a;
      col[g * 3 + 2] = sum[g * 4 + 2] / a;
      filled[g] = 1;
      mr += sum[g * 4];
      mg += sum[g * 4 + 1];
      mb += sum[g * 4 + 2];
      mw += a;
    }
  }
  if (mw === 0) return;
  mr /= mw;
  mg /= mw;
  mb /= mw;
  for (let pass = 0; pass < 6; pass++) {
    const next = filled.slice();
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
            r += col[g2 * 3];
            gg += col[g2 * 3 + 1];
            b += col[g2 * 3 + 2];
          }
        }
        if (n) {
          col[g * 3] = r / n;
          col[g * 3 + 1] = gg / n;
          col[g * 3 + 2] = b / n;
          next[g] = 1;
          any = true;
        }
      }
    }
    filled.set(next);
    if (!any) break;
  }
  for (let g = 0; g < gw * gh; g++) {
    if (!filled[g]) {
      col[g * 3] = mr;
      col[g * 3 + 1] = mg;
      col[g * 3 + 2] = mb;
    }
  }
  for (let y = 0; y < h; y++) {
    const gy = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = rgba[o + 3];
      if (a >= 200) continue;
      const g = (gy * gw + ((x / B) | 0)) * 3;
      const k = a < 8 ? 0 : smoothstep(8, 160, a);
      rgba[o] = col[g] + (rgba[o] - col[g]) * k;
      rgba[o + 1] = col[g + 1] + (rgba[o + 1] - col[g + 1]) * k;
      rgba[o + 2] = col[g + 2] + (rgba[o + 2] - col[g + 2]) * k;
    }
  }
}

// Box filter mip chain; with `coverage` the alpha of each level is rescaled so the fraction of pixels
// that pass alphaTest 0.5 stays what it was at level 0.
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

// Height field (Float32, row 0 = v 0) to a tangent space normal map, OpenGL convention. `strength` is
// resolution independent (as in proceduralTextures: a height change of 1 across a texel of a 1024
// wide texture tilts the normal by about 63 degrees at 4).
function heightToNormal(hgt, w, h, strength, wrapX = true, wrapY = false) {
  const out = new Uint8ClampedArray(w * h * 4);
  const k = (strength * (w / 1024)) / 2;
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : wrapY ? h - 1 : 0) * w;
    const yc = y * w;
    const yp = (y < h - 1 ? y + 1 : wrapY ? 0 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? x - 1 : wrapX ? w - 1 : 0;
      const r = x < w - 1 ? x + 1 : wrapX ? 0 : w - 1;
      const dx = hgt[ym + r] + 2 * hgt[yc + r] + hgt[yp + r] - (hgt[ym + l] + 2 * hgt[yc + l] + hgt[yp + l]);
      const dy = hgt[yp + l] + 2 * hgt[yp + x] + hgt[yp + r] - (hgt[ym + l] + 2 * hgt[ym + x] + hgt[ym + r]);
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
export { heightToNormal };

// Canvas (row 0 = top) to alpha card: flips to texture order, adds a fine grain, bleeds colour, mips.
function* finishCard(g, W, H, seed = 1) {
  const src = g.getImageData(0, 0, W, H).data;
  yield;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const rowBytes = W * 4;
  for (let y = 0; y < H; y++) rgba.set(src.subarray((H - 1 - y) * rowBytes, (H - y) * rowBytes), y * rowBytes);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (rgba[o + 3] === 0) continue;
      const n = 0.95 + hash2(x, y, seed) * 0.1; // fine grain so no leaf is ever a flat colour
      rgba[o] *= n;
      rgba[o + 1] *= n;
      rgba[o + 2] *= n;
    }
  }
  yield;
  bleedColour(rgba, W, H);
  yield;
  const mips = buildMipChain(rgba, W, H, true);
  yield;
  return makeTexture(rgba, W, H, { srgb: true, tile: false, mipmaps: mips });
}

// ------------------------------------------------------------------------------------------------
// Drawing primitives (canvas coordinates: y grows DOWN, the painted base sits at the bottom)
// ------------------------------------------------------------------------------------------------
function fillPoly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// Outline of an ovate leaf along +x from the origin: widest in the lower half, pointed tip, optional
// regular teeth. Returns a closed polygon in leaf space (x along the leaf, y across).
function leafOutline(len, wid, { teeth = 0, amp = 0.05, base = 0.75, tip = 0.9, N = 30, phase = 0 } = {}) {
  const top = [];
  const bot = [];
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    let hw = wid * 0.5 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, base))), tip);
    if (teeth) hw *= 1 + amp * (2 * Math.abs(Math.sin(Math.PI * teeth * u + phase)) - 1);
    top.push([u * len, -hw]);
    bot.push([u * len, hw]);
  }
  return top.concat(bot.reverse());
}

// Draw a polygon given in leaf space at (x, y) rotated by `ang` (canvas radians, 0 = +x).
function drawLeafPoly(g, pts, x, y, ang, fill, stroke = null, lw = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  fillPoly(g, pts);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
  g.restore();
}

function line(g, x0, y0, x1, y1, style, lw) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.strokeStyle = style;
  g.lineWidth = lw;
  g.lineCap = "round";
  g.stroke();
}

// Quadratic bezier point and tangent angle
const qPoint = (p0, p1, p2, t) => {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
};
const qAngle = (p0, p1, p2, t) => {
  const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return Math.atan2(dy, dx);
};

// ================================================================================================
// FERNS
// ================================================================================================
// Pinna: a lobed lance shaped blade along a gently curved axis, cut by pinnule gaps. The outline is
// stroked darker so overlapping pinnae read as layers.
function drawPinna(g, ox, oy, dir, L, Wp, curve, lobes, fill, rib, rng) {
  const N = Math.max(10, lobes * 4);
  const left = [];
  const right = [];
  const axis = [];
  let x = ox;
  let y = oy;
  let a = dir;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    axis.push([x, y, a]);
    x += (Math.cos(a) * L) / N;
    y += (Math.sin(a) * L) / N;
    a += curve / N;
  }
  const phase = rng() * TAU;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const [px, py, pa] = axis[k];
    // widest at about a third along, blunt rounded tip; scalloped by the pinnule lobes
    let hw = Wp * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.62))), 0.85);
    hw *= 0.8 + 0.2 * Math.abs(Math.sin(Math.PI * lobes * u + phase));
    const nx = -Math.sin(pa);
    const ny = Math.cos(pa);
    left.push([px + nx * hw, py + ny * hw]);
    right.push([px - nx * hw, py - ny * hw]);
  }
  const poly = left.concat(right.reverse());
  fillPoly(g, poly);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = "rgba(10,22,10,0.30)";
  g.lineWidth = 0.9;
  g.stroke();
  // pinnule gaps: short dark cuts from the margin toward the midrib at each lobe boundary
  g.strokeStyle = "rgba(8,20,8,0.22)";
  g.lineWidth = 0.8;
  for (let q = 1; q < lobes; q++) {
    const k = Math.round(((q + 0.0) / lobes) * N);
    if (k <= 0 || k >= N) continue;
    const [px, py, pa] = axis[k];
    const hw = Wp * 0.9 * Math.pow(Math.sin(Math.PI * Math.pow(k / N, 0.62)), 0.85);
    const nx = -Math.sin(pa);
    const ny = Math.cos(pa);
    line(g, px + nx * hw, py + ny * hw, px + nx * hw * 0.35, py + ny * hw * 0.35, "rgba(8,20,8,0.22)", 0.8);
    line(g, px - nx * hw, py - ny * hw, px - nx * hw * 0.35, py - ny * hw * 0.35, "rgba(8,20,8,0.22)", 0.8);
  }
  // midrib
  g.beginPath();
  g.moveTo(axis[0][0], axis[0][1]);
  for (let k = 1; k <= N - 1; k++) g.lineTo(axis[k][0], axis[k][1]);
  g.strokeStyle = rib;
  g.lineWidth = 1.1;
  g.stroke();
}

// One male fern frond in the cell [x0, x0 + w] of a canvas h tall. Base at the bottom centre, tip at
// the top. Lanceolate blade (widest about a third up), pinnae sweep forward, a bare scaly stipe below.
function drawMaleFernFrond(g, x0, w, h, rng, variant) {
  const cx = x0 + w / 2;
  const yBase = h * 0.875;
  const yTip = h * 0.014;
  const len = yBase - yTip;
  const halfW = w * 0.47;
  const young = variant === 1;
  const dark = mixRgb(TONE.leafDark, TONE.forest, 0.15);
  const mid = young ? mixRgb(TONE.leafMid, TONE.yellowGreen, 0.35) : mixRgb(TONE.leafDark, TONE.leafMid, 0.62);
  const hi = mixRgb(TONE.leafMid, TONE.leafLight, young ? 0.5 : 0.32);
  // stipe with brown scales
  line(g, cx, h, cx, yBase + 6, rgbCss(mixRgb(TONE.timber, TONE.leafMid, 0.45)), 4.6);
  for (let i = 0; i < 16; i++) {
    const yy = h - rng() * (h - yBase);
    line(g, cx - 3, yy, cx + 3 + rng() * 3, yy - 4, rgbCss(mixRgb(TONE.timberDark, TONE.timber, rng()), 0.8), 1.6);
  }
  const NP = young ? 23 : 26;
  const ph = rng() * TAU;
  const rachisX = (s) => cx + Math.sin(s * Math.PI * 1.15 + ph) * w * 0.014;
  const records = [];
  for (let i = 0; i < NP; i++) {
    const s = (i + 0.5) / NP;
    const py = yBase - s * len;
    const px = rachisX(s);
    // lanceolate profile: short pinnae at the base, longest a third up, fine at the tip
    const prof = s < 0.32 ? 0.36 + 0.64 * Math.sin((s / 0.32) * (Math.PI / 2)) : Math.pow(Math.cos(((s - 0.32) / 0.68) * (Math.PI / 2)), 0.8);
    for (const side of [-1, 1]) {
      const Lp = Math.max(8, halfW * prof * range(rng, 0.9, 1.08) * (side < 0 ? 0.94 : 1));
      // pinnae sweep toward the tip; the direction is measured from "up" (-y) rotated sideways
      const sweep = (68 - 26 * s + range(rng, -5, 5)) * DEG;
      const dir = -Math.PI / 2 + side * sweep;
      records.push({ s, px, py, side, Lp, dir, Wp: Lp * 0.25, curve: -side * range(rng, 0.1, 0.4), lobes: Math.max(3, Math.round(Lp / 9)) });
    }
  }
  // paint from the base up so the upper pinnae overlap the lower ones
  for (const r of records) {
    const shade = clamp(0.25 + 0.75 * r.s + (rng() - 0.5) * 0.25, 0, 1);
    const fill = rgbCss(mixRgb(mixRgb(dark, mid, 0.5 + 0.5 * rng()), hi, shade * 0.45));
    drawPinna(g, r.px, r.py, r.dir, r.Lp, r.Wp, r.curve, r.lobes, fill, rgbCss(mixRgb(mid, TONE.leafLight, 0.45), 0.8), rng);
  }
  // terminal pinna and the rachis
  drawPinna(g, rachisX(1), yTip + 26, -Math.PI / 2, 26, 5, 0, 3, rgbCss(mixRgb(mid, hi, 0.4)), rgbCss(hi, 0.7), rng);
  g.beginPath();
  g.moveTo(cx, yBase + 4);
  for (let k = 0; k <= 30; k++) g.lineTo(rachisX(k / 30), yBase - (k / 30) * len);
  g.strokeStyle = rgbCss(mixRgb(mid, TONE.leafLight, 0.55), 0.85);
  g.lineWidth = 2;
  g.stroke();
}

export function* paintMaleFern() {
  const [W, H] = TEX.male;
  const g = makeCanvas(W, H);
  for (let cell = 0; cell < 2; cell++) {
    drawMaleFernFrond(g, (cell * W) / 2, W / 2, H, createRng(4101 + cell * 37), cell);
    yield;
  }
  return yield* finishCard(g, W, H, 41);
}

// Hart's tongue: undivided strap fronds, glossy, wavy margin, pale midrib, fine parallel forked veins.
// Cell 0 is a sterile frond. Cell 1 is fertile: oblique brown sori lines in pairs either side of the
// midrib (they are on the underside in life, but the card is double sided so both faces show them).
function drawStrap(g, x0, w, h, rng, fertile) {
  const cx = x0 + w / 2;
  const topY = h * 0.012;
  const W = w * 0.86;
  const dark = mixRgb(TONE.leafDark, TONE.forest, 0.25);
  const body = mixRgb(TONE.leafDark, TONE.leafMid, 0.55);
  const sheen = mixRgb(TONE.leafMid, TONE.leafLight, 0.28);
  const pL = rng() * TAU;
  const pR = rng() * TAU;
  const prof = (t) => {
    let s = smoothstep(0.0, 0.2, t) * 0.82 + 0.18;
    if (t > 0.8) s *= Math.pow(Math.max(0, Math.cos(((t - 0.8) / 0.2) * (Math.PI / 2))), 0.55);
    return s;
  };
  const left = [];
  const right = [];
  const N = 80;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const y = h - t * (h - topY);
    const waveL = 1 + 0.07 * Math.sin(t * TAU * 6.5 + pL) + 0.03 * Math.sin(t * TAU * 15 + pL * 2);
    const waveR = 1 + 0.07 * Math.sin(t * TAU * 6.1 + pR) + 0.03 * Math.sin(t * TAU * 14 + pR * 2);
    const hw = (W / 2) * prof(t);
    left.push([cx - hw * waveL, y]);
    right.push([cx + hw * waveR, y]);
  }
  fillPoly(g, left.concat(right.reverse()));
  const grad = g.createLinearGradient(cx - W / 2, 0, cx + W / 2, 0);
  grad.addColorStop(0, rgbCss(dark));
  grad.addColorStop(0.3, rgbCss(body));
  grad.addColorStop(0.42, rgbCss(sheen));
  grad.addColorStop(0.58, rgbCss(body));
  grad.addColorStop(1, rgbCss(dark));
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = rgbCss(scaleRgb(dark, 0.7), 0.7);
  g.lineWidth = 1;
  g.stroke();
  // fine forked veins running out from the midrib at about 80 degrees
  for (let t = 0.1; t < 0.94; t += 0.014) {
    const y = h - t * (h - topY);
    const hw = (W / 2) * prof(t) * 0.92;
    for (const side of [-1, 1]) {
      line(g, cx, y, cx + side * hw, y - hw * 0.28, "rgba(5,18,8,0.12)", 0.8);
    }
  }
  if (fertile) {
    // sori: paired oblique bars from near the midrib out to about 80 percent of the half width
    const col = mixRgb(TONE.timber, TONE.warm, 0.18);
    for (let t = 0.2; t < 0.9; t += 0.026) {
      const y = h - t * (h - topY);
      const hw = (W / 2) * prof(t);
      for (const side of [-1, 1]) {
        const j = rng() * 2 - 1;
        line(g, cx + side * 4, y + j, cx + side * hw * 0.82, y - hw * 0.42 + j, rgbCss(col, 0.7), 1.6);
      }
    }
  }
  // pale midrib on top
  line(g, cx, h, cx, topY + h * 0.03, rgbCss(mixRgb(TONE.leafLight, TONE.yellowGreen, 0.5), 0.85), 2.4);
}

export function* paintHartsTongue() {
  const [W, H] = TEX.harts;
  const g = makeCanvas(W, H);
  drawStrap(g, 0, W / 2, H, createRng(5303), false);
  yield;
  drawStrap(g, W / 2, W / 2, H, createRng(5311), true);
  yield;
  return yield* finishCard(g, W, H, 53);
}

// Bracken: a stalk below, a triangular tripinnate blade above (longest pinnae near the base of the
// blade, shortening to the tip), each pinna carrying rows of small pinnules.
function drawPinnule(g, x, y, ang, len, wid, fill) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.2, -wid, len * 0.7, -wid * 0.9, len, 0);
  g.bezierCurveTo(len * 0.7, wid * 0.9, len * 0.2, wid, 0, 0);
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

function drawBrackenFrond(g, x0, w, h, rng, variant) {
  const cx = x0 + w / 2;
  const yb = h * 0.42;
  const yt = h * 0.012;
  const halfW = w * 0.47;
  const leafA = mixRgb(TONE.leafMid, TONE.yellowGreen, variant === 1 ? 0.5 : 0.28);
  const leafB = mixRgb(TONE.leafDark, TONE.leafMid, 0.6);
  const leafC = mixRgb(TONE.leafMid, TONE.leafLight, 0.4);
  // stalk: browner and thicker at the foot, green and fine at the blade
  const ph = rng() * TAU;
  const sx = (y) => cx + Math.sin((y / h) * 6 + ph) * 2.5;
  g.beginPath();
  g.moveTo(sx(h), h);
  for (let y = h; y >= yb; y -= 8) g.lineTo(sx(y), y);
  g.strokeStyle = rgbCss(mixRgb(TONE.timber, TONE.leafMid, 0.55));
  g.lineWidth = 7;
  g.lineCap = "round";
  g.stroke();
  g.beginPath();
  g.moveTo(sx(h * 0.75), h * 0.75);
  for (let y = h * 0.75; y >= yb; y -= 8) g.lineTo(sx(y), y);
  g.strokeStyle = rgbCss(mixRgb(TONE.leafMid, TONE.yellowGreen, 0.5));
  g.lineWidth = 4.2;
  g.stroke();
  const NPAIR = variant === 1 ? 10 : 12;
  // lower pairs first so the pinnae nearer the tip overlap them
  for (let i = 0; i < NPAIR; i++) {
    const s = (i + 0.35) / NPAIR;
    const py = yb - s * (yb - yt) * 0.97;
    const px = sx(py);
    const Lp = halfW * Math.pow(1 - s, 0.88) * Math.min(1, 0.6 + 3.8 * s) * range(rng, 0.93, 1.05);
    for (const side of [-1, 1]) {
      const sweep = (80 - 28 * s + range(rng, -4, 4)) * DEG;
      const dir = -Math.PI / 2 + side * sweep;
      const curve = -side * range(rng, 0.0, 0.25); // pinna axes droop a little toward the tip
      // pinna axis
      const N = 12;
      const axis = [];
      let x = px;
      let y = py;
      let a = dir;
      for (let k = 0; k <= N; k++) {
        axis.push([x, y, a]);
        x += (Math.cos(a) * Lp) / N;
        y += (Math.sin(a) * Lp) / N;
        a += curve / N;
      }
      g.beginPath();
      g.moveTo(axis[0][0], axis[0][1]);
      for (const p of axis) g.lineTo(p[0], p[1]);
      g.strokeStyle = rgbCss(mixRgb(TONE.leafMid, TONE.yellowGreen, 0.45), 0.9);
      g.lineWidth = 1.6;
      g.stroke();
      const nPin = Math.max(3, Math.round(Lp / 10));
      for (let k = 0; k < nPin; k++) {
        const u = (k + 0.6) / nPin;
        const [ax, ay, aa] = axis[Math.min(N, Math.round(u * N))];
        // pinnules shrink toward the pinna tip, and everything shrinks toward the frond tip
        const lp = (30 - 10 * s) * (1 - 0.8 * Math.pow(u, 1.3)) * range(rng, 0.85, 1.1);
        for (const ps of [-1, 1]) {
          const pa = aa + ps * range(rng, 52, 70) * DEG;
          const c = mixRgb(mixRgb(leafB, leafA, rng()), leafC, rng() * 0.35);
          drawPinnule(g, ax, ay, pa, lp, lp * 0.3, rgbCss(c));
        }
      }
      // terminal pinnule
      const [tx, ty, ta] = axis[N];
      drawPinnule(g, tx, ty, ta, 20 * (1 - 0.6 * s), 6, rgbCss(mixRgb(leafA, leafC, 0.5)));
    }
    if (i % 3 === 2) {
      /* yield points are handled by the caller per frond */
    }
  }
  // blade apex
  for (let k = 0; k < 5; k++) {
    const y = yt + k * 14 + 8;
    const sz = 22 - k * 2.5;
    drawPinnule(g, sx(y), y, -Math.PI / 2 - 0.9, sz, sz * 0.3, rgbCss(mixRgb(leafA, leafC, 0.4)));
    drawPinnule(g, sx(y), y, -Math.PI / 2 + 0.9, sz, sz * 0.3, rgbCss(mixRgb(leafA, leafC, 0.4)));
  }
  drawPinnule(g, sx(yt + 6), yt + 14, -Math.PI / 2, 16, 5, rgbCss(mixRgb(leafA, leafC, 0.5)));
  line(g, sx(yb), yb, sx(yt + 8), yt + 8, rgbCss(mixRgb(TONE.leafMid, TONE.yellowGreen, 0.5), 0.9), 2);
}

export function* paintBracken() {
  const [W, H] = TEX.bracken;
  const g = makeCanvas(W, H);
  for (let cell = 0; cell < 2; cell++) {
    drawBrackenFrond(g, (cell * W) / 2, W / 2, H, createRng(6007 + cell * 53), cell);
    yield;
  }
  return yield* finishCard(g, W, H, 61);
}

// ================================================================================================
// GROUND PLANTS
// ================================================================================================
// Dog's mercury: several upright stems with opposite pairs of dark, toothed, ovate leaves.
export function* paintMercury() {
  const [W, H] = TEX.mercury;
  const g = makeCanvas(W, H);
  const rng = createRng(7019);
  const stems = 4;
  for (let s = 0; s < stems; s++) {
    const bx = W / 2 + (s - (stems - 1) / 2) * 34 + range(rng, -12, 12);
    const lean = range(rng, -0.5, 0.5) * 60;
    const topY = H * range(rng, 0.1, 0.34);
    const p0 = [bx, H - 2];
    const p1 = [bx + lean * 0.3, (H + topY) / 2];
    const p2 = [bx + lean, topY];
    g.beginPath();
    g.moveTo(p0[0], p0[1]);
    for (let t = 0; t <= 1.001; t += 0.05) {
      const p = qPoint(p0, p1, p2, t);
      g.lineTo(p[0], p[1]);
    }
    g.strokeStyle = rgbCss(mixRgb(TONE.leafMid, TONE.yellowGreen, 0.35));
    g.lineWidth = 3.2;
    g.lineCap = "round";
    g.stroke();
    const nodes = 5;
    for (let n = 0; n < nodes; n++) {
      const t = 0.3 + (0.68 * n) / (nodes - 1);
      const [nx, ny] = qPoint(p0, p1, p2, t);
      const ang = qAngle(p0, p1, p2, t);
      const size = (1 - 0.45 * t) * range(rng, 56, 74);
      for (const side of [-1, 1]) {
        const la = ang + side * range(rng, 48, 66) * DEG;
        const col = mixRgb(mixRgb(TONE.leafDark, TONE.leafMid, 0.3 + rng() * 0.3), TONE.forest, 0.08);
        const pts = leafOutline(size, size * 0.46, { teeth: 11, amp: 0.05, base: 0.8, tip: 0.8 });
        drawLeafPoly(g, pts, nx, ny, la, rgbCss(col), "rgba(6,18,8,0.5)", 1);
        g.save();
        g.translate(nx, ny);
        g.rotate(la);
        line(g, 0, 0, size * 0.92, 0, rgbCss(mixRgb(col, TONE.leafLight, 0.38), 0.7), 1.3);
        g.restore();
      }
    }
    // terminal pair, small
    const [ex, ey] = qPoint(p0, p1, p2, 1);
    const ea = qAngle(p0, p1, p2, 1);
    drawLeafPoly(g, leafOutline(34, 17, { teeth: 7 }), ex, ey, ea, rgbCss(mixRgb(TONE.leafDark, TONE.leafMid, 0.55)), "rgba(6,18,8,0.5)", 1);
    yield;
  }
  return yield* finishCard(g, W, H, 71);
}

// Wood sorrel: a rosette of long petioles each ending in three heart shaped leaflets that fold along
// the midrib, a few small white flowers on thin stalks.
export function* paintSorrel() {
  const [W, H] = TEX.sorrel;
  const g = makeCanvas(W, H);
  const rng = createRng(7331);
  const bx = W / 2;
  const by = H - 3;
  const fresh = mixRgb(TONE.leafMid, TONE.leafLight, 0.45);
  const heart = (cx, cy, ang, size, col) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.beginPath();
    // obcordate: a notched, heart shaped leaflet whose point is at the origin
    g.moveTo(0, 0);
    g.bezierCurveTo(size * 0.25, -size * 0.55, size * 0.95, -size * 0.7, size * 1.0, -size * 0.3);
    g.quadraticCurveTo(size * 0.92, -size * 0.06, size * 0.8, -size * 0.04);
    g.quadraticCurveTo(size * 0.82, 0, size * 0.8, size * 0.04);
    g.quadraticCurveTo(size * 0.92, size * 0.06, size * 1.0, size * 0.3);
    g.bezierCurveTo(size * 0.95, size * 0.7, size * 0.25, size * 0.55, 0, 0);
    g.closePath();
    g.fillStyle = rgbCss(col);
    g.fill();
    g.strokeStyle = "rgba(10,30,10,0.4)";
    g.lineWidth = 1;
    g.stroke();
    line(g, 0, 0, size * 0.85, 0, "rgba(10,30,10,0.35)", 1.3); // the fold
    g.restore();
  };
  const petioles = 9;
  for (let i = 0; i < petioles; i++) {
    const a = -Math.PI / 2 + ((i - (petioles - 1) / 2) / petioles) * 2.1 + range(rng, -0.12, 0.12);
    const L = range(rng, 90, 150) * (1 - 0.3 * Math.abs(a + Math.PI / 2));
    const ex = bx + Math.cos(a) * L;
    const ey = by + Math.sin(a) * L;
    const mx = bx + Math.cos(a) * L * 0.5 + range(rng, -6, 6);
    const my = by + Math.sin(a) * L * 0.5;
    g.beginPath();
    g.moveTo(bx, by);
    g.quadraticCurveTo(mx, my, ex, ey);
    g.strokeStyle = rgbCss(mixRgb(TONE.leafMid, TONE.timber, 0.25));
    g.lineWidth = 1.8;
    g.stroke();
    const size = range(rng, 44, 58);
    const col = mixRgb(mixRgb(TONE.leafMid, fresh, rng()), TONE.leafDark, rng() * 0.2);
    // three leaflets fanned around the petiole's end: they droop a little, like real sorrel
    for (const da of [-0.95, 0, 0.95]) heart(ex, ey, a + da + range(rng, -0.1, 0.1), size, col);
  }
  yield;
  // flowers: five white petals with faint veins
  for (let f = 0; f < 3; f++) {
    const fx = W * range(rng, 0.22, 0.78);
    const fy = H * range(rng, 0.32, 0.5);
    line(g, bx + (fx - bx) * 0.2, by, fx, fy, rgbCss(mixRgb(TONE.leafMid, TONE.cream, 0.4)), 1.4);
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * TAU + f;
      g.save();
      g.translate(fx, fy);
      g.rotate(pa);
      g.beginPath();
      g.ellipse(9, 0, 10, 5, 0, 0, TAU);
      g.fillStyle = rgbCss(mixRgb(TONE.cream, TONE.stone, 0.15));
      g.fill();
      g.strokeStyle = rgbCss(mixRgb(TONE.stone, TONE.timber, 0.3), 0.7);
      g.lineWidth = 0.7;
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(fx, fy, 2.6, 0, TAU);
    g.fillStyle = rgbCss(mixRgb(TONE.warm, TONE.cream, 0.5));
    g.fill();
  }
  yield;
  return yield* finishCard(g, W, H, 73);
}

// Sedge / tall grass: arching tapered blades, a few dead tan ones, one pale midrib line each.
export function* paintSedge() {
  const [W, H] = TEX.sedge;
  const g = makeCanvas(W, H);
  const rng = createRng(7457);
  const blades = 17;
  const order = [];
  for (let i = 0; i < blades; i++) order.push(i);
  for (const i of order) {
    const spread = (i / (blades - 1)) * 2 - 1;
    const x0 = W / 2 + spread * 22 + range(rng, -8, 8);
    const len = H * range(rng, 0.55, 0.97) * (1 - 0.2 * Math.abs(spread));
    const dx = spread * W * 0.34 + range(rng, -20, 20);
    const tipY = H - len;
    const ctl = [x0 + dx * 0.15, H - len * 0.62];
    const tip = [x0 + dx, tipY + range(rng, 0, 40) * Math.abs(spread)]; // outer blades droop
    const w0 = range(rng, 6, 11);
    const dead = rng() < 0.14;
    const col = dead
      ? mixRgb(TONE.beechOchre, TONE.cream, 0.15)
      : mixRgb(mixRgb(TONE.leafMid, TONE.leafLight, rng() * 0.6), TONE.leafDark, rng() * 0.25);
    // tapered ribbon along the bezier
    const L = [];
    const R = [];
    const N = 22;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const p = qPoint([x0, H - 1], ctl, tip, t);
      const a = qAngle([x0, H - 1], ctl, tip, t);
      const w = w0 * 0.5 * Math.pow(1 - t, 0.75) * (0.4 + 0.6 * Math.min(1, t * 7));
      L.push([p[0] - Math.sin(a) * w, p[1] + Math.cos(a) * w]);
      R.push([p[0] + Math.sin(a) * w, p[1] - Math.cos(a) * w]);
    }
    fillPoly(g, L.concat(R.reverse()));
    g.fillStyle = rgbCss(col);
    g.fill();
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const p = qPoint([x0, H - 1], ctl, tip, k / N);
      if (k === 0) g.moveTo(p[0], p[1]);
      else g.lineTo(p[0], p[1]);
    }
    g.strokeStyle = rgbCss(mixRgb(col, dead ? TONE.cream : TONE.leafLight, 0.35), 0.7);
    g.lineWidth = 1.1;
    g.stroke();
    if (i % 4 === 3) yield;
  }
  return yield* finishCard(g, W, H, 79);
}

// Ivy runner: a trailing stem with alternate, five lobed glossy leaves with pale veins and a few
// rootlets. Lies on the floor or drapes over wood.
function ivyLeafPoints(size, rng) {
  const lobes = [
    [-1.9, 0.52],
    [-0.95, 0.78],
    [0, 1.0],
    [0.95, 0.78],
    [1.9, 0.52],
  ];
  const pts = [];
  const N = 72;
  for (let k = 0; k < N; k++) {
    const phi = -Math.PI + (k / N) * TAU; // 0 points along the leaf axis (to the tip)
    let r = 0.26;
    for (const [ang, len] of lobes) {
      let d = Math.abs(phi - ang);
      d = Math.min(d, TAU - d);
      r = Math.max(r, len * Math.pow(Math.max(0, 1 - d / 0.62), 0.85));
    }
    // heart shaped base notch where the petiole joins
    r *= 1 - 0.55 * Math.exp(-Math.pow((Math.abs(phi) - Math.PI) / 0.2, 2));
    pts.push([Math.cos(phi) * r * size, Math.sin(phi) * r * size * 0.95]);
  }
  return pts;
}

function drawIvyLeaf(g, x, y, ang, size, rng, dark) {
  const pts = ivyLeafPoints(size, rng);
  const col = dark ? mixRgb(TONE.leafDark, TONE.forest, 0.2) : mixRgb(TONE.leafDark, TONE.leafMid, 0.2 + rng() * 0.35);
  drawLeafPoly(g, pts, x, y, ang, rgbCss(col), "rgba(6,16,8,0.55)", 1);
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  const vein = rgbCss(mixRgb(TONE.cream, TONE.leafLight, 0.5), 0.6);
  line(g, -size * 0.1, 0, size * 0.95, 0, vein, 1.4);
  for (const a of [-0.95, 0.95, -1.9, 1.9]) line(g, 0, 0, Math.cos(a) * size * 0.7, Math.sin(a) * size * 0.7, vein, 1);
  g.restore();
}

export function* paintIvy() {
  const [W, H] = TEX.ivy;
  const g = makeCanvas(W, H);
  const rng = createRng(7561);
  const p0 = [W * 0.42, H - 2];
  const p1 = [W * 0.72, H * 0.45];
  const p2 = [W * 0.48, H * 0.04];
  g.beginPath();
  for (let t = 0; t <= 1.001; t += 0.04) {
    const p = qPoint(p0, p1, p2, t);
    if (t === 0) g.moveTo(p[0], p[1]);
    else g.lineTo(p[0], p[1]);
  }
  g.strokeStyle = rgbCss(mixRgb(TONE.timber, TONE.leafDark, 0.4));
  g.lineWidth = 3.4;
  g.lineCap = "round";
  g.stroke();
  const nodes = 11;
  for (let i = 0; i < nodes; i++) {
    const t = 0.05 + (0.93 * i) / (nodes - 1);
    const [nx, ny] = qPoint(p0, p1, p2, t);
    const a = qAngle(p0, p1, p2, t);
    const side = i % 2 === 0 ? 1 : -1;
    const size = range(rng, 50, 70) * (1 - 0.3 * t);
    // petiole then the leaf
    const la = a + side * range(rng, 0.9, 1.35);
    const px = nx + Math.cos(la) * 12;
    const py = ny + Math.sin(la) * 12;
    line(g, nx, ny, px, py, rgbCss(mixRgb(TONE.timber, TONE.leafDark, 0.4)), 2);
    drawIvyLeaf(g, px, py, la, size, rng, i > 7);
    if (rng() < 0.5) line(g, nx, ny, nx - side * 7, ny + 9, rgbCss(TONE.timber, 0.8), 1.2); // rootlet
    if (i % 3 === 2) yield;
  }
  return yield* finishCard(g, W, H, 83);
}

// Bramble: an arching red-brown cane with small thorns and compound leaves of 3 to 5 serrated
// leaflets, paler and speckled beneath.
export function* paintBramble() {
  const [W, H] = TEX.bramble;
  const g = makeCanvas(W, H);
  const rng = createRng(7673);
  const p0 = [W * 0.2, H - 2];
  const p1 = [W * 0.34, H * 0.18];
  const p2 = [W * 0.86, H * 0.1];
  const cane = mixRgb(TONE.timberDark, TONE.timber, 0.35);
  g.beginPath();
  for (let t = 0; t <= 1.001; t += 0.03) {
    const p = qPoint(p0, p1, p2, t);
    if (t === 0) g.moveTo(p[0], p[1]);
    else g.lineTo(p[0], p[1]);
  }
  g.strokeStyle = rgbCss(cane);
  g.lineWidth = 6.5;
  g.lineCap = "round";
  g.stroke();
  // thorns
  for (let i = 0; i < 16; i++) {
    const t = 0.05 + i * 0.058;
    const [x, y] = qPoint(p0, p1, p2, t);
    const a = qAngle(p0, p1, p2, t) + (i % 2 ? 1 : -1) * (Math.PI / 2 + range(rng, -0.4, 0.4));
    line(g, x, y, x + Math.cos(a) * 9, y + Math.sin(a) * 9, rgbCss(mixRgb(cane, TONE.warm, 0.2)), 2.4);
  }
  const leaflet = (x, y, a, size, col) => {
    drawLeafPoly(g, leafOutline(size, size * 0.62, { teeth: 14, amp: 0.07, base: 0.78, tip: 0.8 }), x, y, a, rgbCss(col), "rgba(8,18,8,0.55)", 1);
    g.save();
    g.translate(x, y);
    g.rotate(a);
    line(g, 0, 0, size * 0.92, 0, rgbCss(mixRgb(col, TONE.cream, 0.4), 0.7), 1.2);
    for (let v = 0.2; v < 0.8; v += 0.15) {
      line(g, size * v, 0, size * (v + 0.18), -size * 0.24, "rgba(8,18,8,0.2)", 0.8);
      line(g, size * v, 0, size * (v + 0.18), size * 0.24, "rgba(8,18,8,0.2)", 0.8);
    }
    g.restore();
  };
  for (let i = 0; i < 6; i++) {
    const t = 0.22 + i * 0.14;
    const [nx, ny] = qPoint(p0, p1, p2, t);
    const a = qAngle(p0, p1, p2, t);
    const side = i % 2 ? 1 : -1;
    const la = a + side * range(rng, 0.7, 1.2);
    const stalk = 26;
    const sx = nx + Math.cos(la) * stalk;
    const sy = ny + Math.sin(la) * stalk;
    line(g, nx, ny, sx, sy, rgbCss(mixRgb(cane, TONE.leafDark, 0.3)), 2.4);
    const size = range(rng, 46, 62) * (1 - 0.2 * t);
    const col = mixRgb(mixRgb(TONE.leafDark, TONE.leafMid, 0.25 + rng() * 0.3), TONE.forest, 0.12);
    for (const da of [-0.75, 0.75, 0]) leaflet(sx, sy, la + da + range(rng, -0.1, 0.1), da === 0 ? size * 1.1 : size * 0.85, col);
    if (i % 2) yield;
  }
  return yield* finishCard(g, W, H, 89);
}

// ================================================================================================
// MOSS PATCH (flat ground card with a shaggy edge) and BEECH LEAVES, SOIL
// ================================================================================================
// Shared cushion moss colour: dark moss in the hollows, brand green on the domes, pale yellow-green
// tips where the light catches. `cushion` 0..1 (dome height), `tone` 0..1 (slow colour drift).
const MOSS_DARK = mixRgb(TONE.leafDark, TONE.moss, 0.4);
const MOSS_MID = mixRgb(TONE.moss, TONE.leafMid, 0.55);
const MOSS_TIP = mixRgb(TONE.leafLight, TONE.yellowGreen, 0.35);
export function mossColour(cushion, tone, out) {
  const base = mixRgb(MOSS_DARK, MOSS_MID, clamp(0.25 + 0.6 * tone + 0.35 * cushion));
  const t = smoothstep(0.55, 0.98, cushion);
  out[0] = base[0] + (MOSS_TIP[0] - base[0]) * t * 0.6;
  out[1] = base[1] + (MOSS_TIP[1] - base[1]) * t * 0.6;
  out[2] = base[2] + (MOSS_TIP[2] - base[2]) * t * 0.6;
  return out;
}

export function* paintMossPatch() {
  const S = TEX.moss;
  const noise = createNoise(8101);
  const wor = createWorley(8111, 30, 30, 0.95);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const c = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const i = y * S + x;
      const dx = u * 2 - 1;
      const dy = v * 2 - 1;
      const d = Math.hypot(dx, dy);
      // irregular outline: warped radius plus a high frequency fringe so the edge is shaggy
      const n1 = noise.fbm2(u * 4.5 + 2.1, v * 4.5 + 7.7, 3);
      const fringe = noise.perlin2(u * 34, v * 34) * 0.5 + noise.perlin2(u * 71 + 9, v * 71 + 3) * 0.3;
      const edge = d + 0.34 * n1 + 0.1 * fringe;
      const a = smoothstep(0.98, 0.8, edge);
      const nz = noise.fbm2(u * 7, v * 7, 3);
      wor.sample(u * 30 + nz * 2, v * 30 + noise.fbm2(u * 7 + 4, v * 7 + 4, 2) * 2);
      const dome = clamp(1 - wor.f1 * 1.2) * (0.6 + 0.4 * wor.id);
      mossColour(dome, 0.5 + 0.5 * nz, c);
      let k = 0.55 + 0.6 * dome;
      // a few leaf litter flecks and bare pale tips
      const fleck = hash2((u * 70) | 0, (v * 70) | 0, 17);
      if (fleck > 0.985) {
        c[0] = TONE.beechRust[0];
        c[1] = TONE.beechRust[1];
        c[2] = TONE.beechRust[2];
        k = 0.7;
      }
      const o = i * 4;
      rgba[o] = c[0] * k;
      rgba[o + 1] = c[1] * k;
      rgba[o + 2] = c[2] * k;
      rgba[o + 3] = a * 255;
      hgt[i] = (0.25 + 0.55 * dome + 0.1 * (nz * 0.5 + 0.5)) * (0.4 + 0.6 * a);
    }
    if ((y & 15) === 15) yield;
  }
  yield;
  const normal = heightToNormal(hgt, S, S, 4.5, false, false);
  bleedColour(rgba, S, S);
  yield;
  return {
    map: makeTexture(rgba, S, S, { srgb: true, mipmaps: buildMipChain(rgba, S, S, true) }),
    normalMap: makeTexture(normal, S, S),
  };
}

// Fallen beech leaves, four to an atlas (2 x 2 cells): copper, ochre, dark brown and pale tan, with
// a wavy margin, pointed tip and parallel veins at about 55 degrees.
export function* paintBeechLeaves() {
  const S = TEX.beech;
  const g = makeCanvas(S, S);
  const rng = createRng(8219);
  const cell = S / 2;
  const tones = [
    TONE.beechRust,
    TONE.beechOchre,
    mixRgb(TONE.timberDark, TONE.litter, 0.55),
    mixRgb(TONE.beechOchre, TONE.cream, 0.3),
  ];
  for (let c = 0; c < 4; c++) {
    const cx = (c % 2) * cell + cell / 2;
    // canvas row 0 is the top; atlas cell 0..1 on the top row of the canvas would map to v 1, so the
    // geometry picks u0, v0 with (c >> 1) counted from the bottom: rows are swapped here to match
    const cy = (1 - (c >> 1)) * cell + cell / 2;
    const len = cell * 0.86;
    const wid = len * 0.52;
    const ang = -Math.PI / 2 + range(rng, -0.35, 0.35);
    const pts = leafOutline(len, wid, { teeth: 9, amp: 0.035, base: 0.85, tip: 0.85, N: 44, phase: rng() * 6 });
    const base = tones[c];
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.translate(-len / 2, 0);
    fillPoly(g, pts);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, rgbCss(scaleRgb(base, 1.12)));
    grad.addColorStop(0.55, rgbCss(base));
    grad.addColorStop(1, rgbCss(scaleRgb(base, 0.78)));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = rgbCss(scaleRgb(base, 0.55), 0.8);
    g.lineWidth = 1.6;
    g.stroke();
    // veins: parallel pairs sweeping toward the tip, plus the midrib and a petiole
    for (let v = 0.06; v < 0.93; v += 0.07) {
      const hw = wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.85)), 0.85);
      line(g, len * v, 0, len * (v + 0.11), -hw * 0.85, rgbCss(scaleRgb(base, 0.62), 0.55), 1.1);
      line(g, len * v, 0, len * (v + 0.11), hw * 0.85, rgbCss(scaleRgb(base, 0.62), 0.55), 1.1);
    }
    line(g, 0, 0, len * 0.96, 0, rgbCss(scaleRgb(base, 0.7), 0.8), 1.8);
    line(g, 0, 0, -len * 0.06, 0, rgbCss(scaleRgb(base, 0.55)), 2);
    // a few small dark decay spots
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.arc(len * range(rng, 0.15, 0.85), wid * range(rng, -0.3, 0.3), range(rng, 1.4, 3.2), 0, TAU);
      g.fillStyle = rgbCss(scaleRgb(base, 0.45), 0.55);
      g.fill();
    }
    g.restore();
    yield;
  }
  return yield* finishCard(g, S, S, 97);
}

// Tileable dark soil with crumbs and root threads, for the upturned root plate. { map, normalMap }
export function* paintSoil() {
  const S = TEX.soil;
  const noise = createNoise(8431);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const dark = mixRgb(TONE.forest, TONE.timberDark, 0.55);
  const light = mixRgb(TONE.timberDark, TONE.litter, 0.45);
  const f = 6;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const n = noise.fbm2(u * f, v * f, 4, f, f) * 0.5 + 0.5;
      const crumb = noise.billow2(u * 22, v * 22, 2, 22, 22);
      const thread = Math.pow(1 - Math.abs(noise.perlin2(u * 10 + 3, v * 32 + 1, 10, 32)), 12);
      const t = clamp(n * 0.8 + crumb * 0.5);
      const c = mixRgb(dark, light, t);
      const k = 0.8 + 0.4 * crumb - 0.15 * thread;
      const o = (y * S + x) * 4;
      rgba[o] = c[0] * k + thread * 30;
      rgba[o + 1] = c[1] * k + thread * 22;
      rgba[o + 2] = c[2] * k + thread * 14;
      rgba[o + 3] = 255;
      hgt[y * S + x] = 0.35 * n + 0.5 * crumb + 0.15 * thread;
    }
    if ((y & 31) === 31) yield;
  }
  const normal = heightToNormal(hgt, S, S, 5, true, true);
  return {
    map: makeTexture(rgba, S, S, { srgb: true, tile: true }),
    normalMap: makeTexture(normal, S, S, { tile: true }),
  };
}

// ================================================================================================
// MUSHROOM ATLAS
// ================================================================================================
// One tileable-in-u atlas for cap, stem and gills (rows are v bands, see floraGeometry). Light neutral
// albedo so per-instance colours (cream, tan, honey brown, orange brown) multiply into proper caps.
// G channel of the second map is roughness (wet, glossy caps; matte gills).
export function* paintMushroom() {
  const S = TEX.mushroom;
  const noise = createNoise(8537);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const rough = new Uint8ClampedArray(S * S * 4);
  const capBase = mixRgb(TONE.cream, TONE.stone, 0.22);
  const gillBase = mixRgb(TONE.cream, TONE.timber, 0.16);
  const stemBase = mixRgb(TONE.cream, TONE.stone, 0.35);
  const scaleCol = mixRgb(TONE.timberDark, TONE.timber, 0.4);
  const per = (u, v, fu, fv, oct = 3) => noise.fbm2(u * fu, v * fv, oct, fu, 0) * 0.5 + 0.5;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const o = (y * S + x) * 4;
      let c;
      let r = 0.7;
      if (v < 0.22) {
        // gills: fine radial plates (constant u lines), darker toward the stem
        const vr = clamp((v - 0.01) / 0.2);
        const w = per(u, v, 6, 3, 2);
        const gl = Math.abs(Math.sin(Math.PI * (u * 44 + w * 0.8)));
        c = scaleRgb(mixRgb(gillBase, TONE.timber, 0.12 * w), (0.74 + 0.3 * Math.pow(gl, 0.6)) * (1 - 0.28 * vr));
        r = 0.82;
      } else if (v < 0.5) {
        // stem: fibrous vertical streaks, darker at the foot, a pale annulus about three quarters up
        const vs = clamp((v - 0.23) / 0.26);
        const fib = per(u, vs, 26, 2.2, 3);
        c = mixRgb(stemBase, scaleCol, 0.18 * (1 - fib) + 0.4 * Math.pow(1 - vs, 2.2));
        const ring = smoothstep(0.7, 0.76, vs) * (1 - smoothstep(0.82, 0.9, vs));
        c = mixRgb(c, mixRgb(TONE.cream, TONE.warm, 0.12), ring * 0.8);
        // small dark scales below the ring
        const sc = hash2((u * 38) | 0, (vs * 16) | 0, 5) > 0.82 && vs < 0.72 ? 0.18 : 0;
        c = mixRgb(c, scaleCol, sc);
        r = 0.66;
      } else {
        // cap top: radial fibrils, darker scales packed toward the middle, a paler striate margin
        const vc = clamp((v - 0.51) / 0.48);
        const fib = per(u, vc, 30, 3, 3);
        const centre = smoothstep(0.35, 1.0, vc);
        const scales = hash2((u * 34) | 0, (vc * 14) | 0, 9) > 0.55 ? centre : 0;
        c = mixRgb(capBase, scaleCol, 0.16 * (1 - fib) + 0.34 * scales + 0.14 * centre);
        const rimLight = smoothstep(0.2, 0.0, vc);
        c = mixRgb(c, TONE.cream, rimLight * 0.5);
        c = scaleRgb(c, 1 - 0.14 * rimLight * Math.abs(Math.sin(u * Math.PI * 64)));
        // wet patches: lower roughness here and there
        r = 0.2 + 0.24 * per(u, vc, 5, 2, 2);
      }
      const k = 0.96 + 0.08 * hash2(x, y, 3);
      rgba[o] = c[0] * k;
      rgba[o + 1] = c[1] * k;
      rgba[o + 2] = c[2] * k;
      rgba[o + 3] = 255;
      rough[o] = 255;
      rough[o + 1] = r * 255;
      rough[o + 2] = 0;
      rough[o + 3] = 255;
    }
    if ((y & 15) === 15) yield;
  }
  return {
    map: makeTexture(rgba, S, S, { srgb: true, tile: false }),
    roughnessMap: makeTexture(rough, S, S),
  };
}
