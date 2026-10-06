// Painted (computed) textures for the signposts: weathered oak, the lettered boards, grass tufts and a
// small stone. Nothing here touches a canvas or an image: every texel is computed from seeded noise, so
// the result is identical on every load, and the painters also run under plain node (the dev check).
//
// Every painter is a GENERATOR that yields after a few thousand texels, so the staged build never holds
// the main thread for long. Row 0 of every field is the BOTTOM of the texture (v = 0).
//
// Units: pxPerM texels per metre. Heights are in metres, so the normal maps are physically scaled:
// the V groove of a letter is about 3 mm deep and the adze scoops on the post about 1.5 mm.

import { createNoise, createWorley, blurField, hash2 } from "@/lib/noise";
import { createRng } from "@/lib/random";
import { TONES, mixBytes, scaleBytes } from "./propTones";
import { clamp, smoothstep, textureSetFrom } from "./propKit";
import { layoutWord, layoutDecor, rasterV } from "./propLetters";

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const SIGN_TEX = {
  boardPxPerM: 700, // board texture density (a small capital is about 75 px tall)
  postW: 384, // post texture: round the octagon (u) ...
  postH: 1024, // ... and up it (v), tile
  postPerimeterM: 0.514, // the octagon's perimeter: texels per metre = postW / this
  grooveDepthM: 0.0034, // V groove depth of the lettering (metres)
  rowsPerChunk: 16, // texture rows between yields
};

const PIXELS_PER_CHUNK = 5500;

// ------------------------------------------------------------------------------------------------
// The weathered oak sheet (post and boards share it)
// ------------------------------------------------------------------------------------------------
// o: {
//   w, h, pxPerM, seed,
//   axis            "u" grain runs along x (a board) or "v" along y (a post)
//   tileU, tileV    the sheet wraps (the post)
//   early, late     sapwood and summerwood tones, silver: 0..1 weathering, damp: 0..1 dark water staining
//   lichen: 0..1    lichen on the surface, adze: hewn scoops (the post), cracks: number of shakes, knots: number
// }
// Returns { rgba, height, rough, ao, w, h }.
export function* paintWoodSheet(o) {
  const { w, h, pxPerM, seed } = o;
  const grainU = (o.axis ?? "u") === "u";
  const tileU = !!o.tileU;
  const tileV = !!o.tileV;
  const noise = createNoise(seed * 3 + 1);
  const rng = createRng(seed * 101 + 7);
  const wm = w / pxPerM;
  const hm = h / pxPerM;
  const texel = 1 / pxPerM;
  const early = o.early ?? TONES.oakEarly;
  const late = o.late ?? TONES.oakLate;
  const silverCol = TONES.silver;
  const silverDark = TONES.silverDark;
  const silverK = o.silver ?? 0.6;
  const dampK = o.damp ?? 0.3;
  const lichenK = o.lichen ?? 0.4;
  const grainK = o.grain ?? 0.55; // how strongly the growth rings show: weathered boards are much quieter than fresh ones

  const rgba = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const rough = new Float32Array(w * h);
  const ao = new Float32Array(w * h);

  // ---- noise helpers: cycles per metre, periodic where the sheet tiles ---------------------------------------
  const cyc = (fx, fy) => ({
    nx: tileU ? Math.max(1, Math.round(wm * fx)) : wm * fx,
    ny: tileV ? Math.max(1, Math.round(hm * fy)) : hm * fy,
  });
  const fbmAt = (c, u, v, oct, off = 0) => noise.fbm2(u * c.nx + off, v * c.ny + off * 0.7, oct, tileU ? c.nx : 0, tileV ? c.ny : 0);

  // ---- coarse fields (1/4 resolution, sampled bilinearly): the slow variations --------------------------------
  const K = 4;
  const gw = Math.ceil(w / K);
  const gh = Math.ceil(h / K);
  // frequencies: along the grain slow, across it quicker
  const fa = grainU ? [1.4, 4] : [4, 1.4];
  const cWarp = cyc(grainU ? 1.2 : 3, grainU ? 3 : 1.2);
  const cSil = cyc(fa[0], fa[1]);
  const cRain = cyc(grainU ? 14 : 2.5, grainU ? 2.5 : 14); // rain streaks run down the page, whatever the grain does
  const cPatch = cyc(2.2, 2.2);
  const cTone = cyc(3, 3);
  const cFacet = cyc(grainU ? 10 : 24, grainU ? 22 : 9);
  const warpG = new Float32Array(gw * gh);
  const silG = new Float32Array(gw * gh);
  const rainG = new Float32Array(gw * gh);
  const patchG = new Float32Array(gw * gh);
  const toneG = new Float32Array(gw * gh);
  const facetG = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const v = (gy + 0.5) / gh;
    for (let gx = 0; gx < gw; gx++) {
      const u = (gx + 0.5) / gw;
      const i = gy * gw + gx;
      warpG[i] = fbmAt(cWarp, u, v, 3, 0);
      silG[i] = fbmAt(cSil, u, v, 3, 5) * 0.5 + 0.5;
      rainG[i] = fbmAt(cRain, u, v, 2, 9) * 0.5 + 0.5;
      patchG[i] = fbmAt(cPatch, u, v, 3, 3) * 0.5 + 0.5;
      toneG[i] = fbmAt(cTone, u, v, 2, 7);
      facetG[i] = noise.ridged2(u * cFacet.nx + 11, v * cFacet.ny + 4, 2, tileU ? cFacet.nx : 0, tileV ? cFacet.ny : 0);
    }
    if (gy % 8 === 7) yield;
  }
  const gwm = gw - 1;
  const ghm = gh - 1;
  const samp = (g, x, y) => {
    // bilinear sample of a coarse grid at texel (x, y); wraps when the sheet tiles
    const fx = (x + 0.5) / K - 0.5;
    const fy = (y + 0.5) / K - 0.5;
    let x0 = Math.floor(fx);
    let y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    if (tileU) {
      x0 = (x0 + gw) % gw;
      x1 = x1 % gw;
    } else {
      x0 = x0 < 0 ? 0 : x0 > gwm ? gwm : x0;
      x1 = x1 > gwm ? gwm : x1;
    }
    if (tileV) {
      y0 = (y0 + gh) % gh;
      y1 = y1 % gh;
    } else {
      y0 = y0 < 0 ? 0 : y0 > ghm ? ghm : y0;
      y1 = y1 > ghm ? ghm : y1;
    }
    const a = g[y0 * gw + x0] + (g[y0 * gw + x1] - g[y0 * gw + x0]) * tx;
    const b = g[y1 * gw + x0] + (g[y1 * gw + x1] - g[y1 * gw + x0]) * tx;
    return a + (b - a) * ty;
  };

  // ---- hewn scoops (adze marks) ------------------------------------------------------------------------------------
  // Cells about 4 cm across the post and 26 cm along it (the adze is swung down the post and each strike leaves
  // a long shallow scoop), each a facet with its own tilt and tone. The cell lookup is domain warped so the
  // scoops are ragged and overlap, not a clean mosaic.
  const adzeNx = Math.max(2, Math.round(wm / 0.04));
  const adzeNy = Math.max(2, Math.round(hm / 0.26));
  const adze = o.adze ? createWorley(seed * 7 + 3, adzeNx, adzeNy, 0.9) : null;

  // ---- lichen: crustose discs inside the patches --------------------------------------------------------------------
  const lichNx = Math.max(2, Math.round(wm / 0.021)); // rosettes about 2 cm across
  const lichNy = Math.max(2, Math.round(hm / 0.021));
  const lich = createWorley(seed * 11 + 5, lichNx, lichNy, 0.95);

  // ---- knots ---------------------------------------------------------------------------------------------------------------
  const knots = [];
  for (let k = 0; k < (o.knots ?? 0); k++) {
    knots.push({ x: (0.2 + 0.6 * rng()) * w, y: (0.2 + 0.6 * rng()) * h, along: 9 + 8 * rng(), across: 5 + 4 * rng() });
  }

  // fine grain coordinates: one cycle every so many metres along the grain / across it
  const cFib = cyc(grainU ? 26 : 480, grainU ? 480 : 26);
  const cPore = cyc(grainU ? 60 : 340, grainU ? 340 : 60);
  const ringFreq = 70 + 40 * rng(); // growth rings per metre across the grain
  const phase0 = rng() * 10;

  let done = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const i = y * w + x;
      const across = grainU ? y : x;
      const cm = across * texel;
      const warp = samp(warpG, x, y);
      const sil0 = samp(silG, x, y);
      const rain = samp(rainG, x, y);
      const patch = samp(patchG, x, y);
      const tone = samp(toneG, x, y);
      const facet = samp(facetG, x, y);

      // fibres: fine streaks along the grain
      const fib = noise.perlin2(u * cFib.nx, v * cFib.ny, tileU ? cFib.nx : 0, tileV ? cFib.ny : 0);
      // growth rings: cathedral arcs from a slowly warped phase, plus a finer second set at an irrational ratio
      let ph = cm * ringFreq + warp * 11 + tone * 2.4 + 0.45 * fib + phase0;
      let knotDark = 0;
      let knotH = 0;
      for (let k = 0; k < knots.length; k++) {
        const kn = knots[k];
        let dxk = (x - kn.x) / (grainU ? kn.along : kn.across);
        let dyk = (y - kn.y) / (grainU ? kn.across : kn.along);
        const d2 = dxk * dxk + dyk * dyk;
        if (d2 < 9) {
          const g = Math.exp(-d2 * 0.55);
          ph += (grainU ? dyk : dxk) * 3 * g; // rings flow around the knot
          const core = 1 - smoothstep(0.5, 1.1, Math.sqrt(d2));
          knotDark = Math.max(knotDark, core);
          knotH = Math.min(knotH, -core * 0.0006);
        }
      }
      const ringI = Math.floor(ph);
      const rf = ph - ringI;
      const ringH = hash2(ringI, 7, seed); // every growth ring its own tone and weight
      const lateW0 = rf * rf * rf * (0.75 + 0.5 * ringH);
      const p2 = ph * 3.71 + tone * 2;
      const r2 = p2 - Math.floor(p2);
      const lateW = lateW0 * 0.78 + r2 * r2 * 0.22;

      // fibres and open oak pores (short dark dashes along the grain)
      const poreN = noise.perlin2(u * cPore.nx + 17, v * cPore.ny + 3, tileU ? cPore.nx : 0, tileV ? cPore.ny : 0);
      const pores = smoothstep(0.35, 0.7, poreN) * (0.5 + 0.5 * (1 - lateW));

      // base wood colour
      const tl = clamp(lateW * grainK + 0.22 * pores + 0.08 * fib + 0.05);
      let r = early[0] + (late[0] - early[0]) * tl;
      let g = early[1] + (late[1] - early[1]) * tl;
      let b = early[2] + (late[2] - early[2]) * tl;
      const tn = (1 + 0.1 * tone + 0.06 * fib) * (0.92 + 0.16 * ringH);
      r *= tn;
      g *= tn;
      b *= tn;

      // hewn facets (post only)
      let hgt = 0.00022 * (lateW - 0.4) + 0.00018 * fib - 0.00035 * pores + 0.0004 * (facet - 0.4);
      let facetShade = 1;
      let ridge = 0;
      if (adze) {
        adze.sample(u * adzeNx + 0.9 * (facet - 0.4) + 0.5 * fib, v * adzeNy + 0.7 * warp);
        const ang = adze.id * 6.2832;
        // slope in metres per cell unit: a facet leans a few percent across its width
        hgt += (adze.dx * Math.cos(ang) + adze.dy * 0.2 * Math.sin(ang)) * 0.0021 - (1 - smoothstep(0, 0.9, adze.f1)) * 0.0009;
        ridge = (1 - smoothstep(0, 0.12, adze.f2 - adze.f1)) * 0.45;
        facetShade = 0.9 + 0.2 * adze.id;
        hgt -= ridge * 0.0004;
      }

      // weathering: silvering concentrated in streaks, damp dark staining where the rain runs
      const silv = clamp(silverK * (0.3 + 1.35 * sil0) * (0.75 + 0.5 * rain) - 0.08);
      const sv = 0.8 + 0.28 * pores + 0.1 * fib;
      r += (silverCol[0] * sv - r) * silv;
      g += (silverCol[1] * sv - g) * silv;
      b += (silverCol[2] * sv - b) * silv;
      // grey valleys: the soft springwood weathers to a darker silver
      const valley = silv * (1 - lateW) * 0.25;
      r += (silverDark[0] - r) * valley;
      g += (silverDark[1] - g) * valley;
      b += (silverDark[2] - b) * valley;
      const dampMask = smoothstep(0.55, 0.9, rain) * dampK;
      const dk = 1 - 0.38 * dampMask;
      r *= dk * facetShade;
      g *= dk * facetShade;
      b *= dk * facetShade;
      if (ridge > 0) {
        const rk = 1 - 0.3 * ridge;
        r *= rk;
        g *= rk;
        b *= rk;
      }
      if (knotDark > 0) {
        const kk = 1 - 0.5 * knotDark;
        r *= kk;
        g *= kk * 0.97;
        b *= kk * 0.9;
      }

      // lichen: grey green and orange discs, only inside the patches
      let lich01 = 0;
      const lp = smoothstep(0.54, 0.76, patch) * lichenK;
      if (lp > 0.02) {
        lich.sample(u * lichNx, v * lichNy);
        const rad = 0.3 + 0.62 * lp * (0.45 + lich.id);
        const disc = 1 - smoothstep(rad - 0.1, rad, lich.f1);
        if (disc > 0) {
          const yellow = lich.id > 0.8;
          const lc = yellow ? TONES.lichenYellow : TONES.lichenPale;
          const rim = smoothstep(rad - 0.22, rad - 0.05, lich.f1); // darker rim and a lighter heart
          const lk = 0.82 + 0.3 * (1 - rim);
          const a = disc * Math.min(1, lp * 1.3) * (yellow ? 0.55 : 0.7);
          r += (lc[0] * lk - r) * a;
          g += (lc[1] * lk - g) * a;
          b += (lc[2] * lk - b) * a;
          lich01 = a;
          hgt += a * 0.0004;
        }
      }

      const o4 = i * 4;
      rgba[o4] = r;
      rgba[o4 + 1] = g;
      rgba[o4 + 2] = b;
      rgba[o4 + 3] = 255;
      height[i] = hgt + knotH;
      rough[i] = clamp(0.84 + 0.08 * silv + 0.06 * (1 - lateW) - 0.05 * dampMask + 0.04 * lich01, 0.4, 1);
      ao[i] = clamp(1 - 0.35 * pores - 0.3 * ridge - 0.4 * knotDark - 0.1 * (1 - lateW) * 0, 0, 1);
    }
    done += w;
    if (done >= PIXELS_PER_CHUNK) {
      done = 0;
      yield;
    }
  }

  // ---- shakes: long splits running with the grain ------------------------------------------------------------
  const shakes = [];
  for (let c = 0; c < (o.cracks ?? 0); c++) {
    const pts = [];
    const lenPx = (0.1 + 0.3 * rng()) * (grainU ? w : h);
    const a0 = (0.1 + 0.6 * rng()) * (grainU ? w : h);
    const c0 = (0.15 + 0.7 * rng()) * (grainU ? h : w);
    const wd = 1.6 + 2.2 * rng();
    const sd = rng() * 50;
    const steps = Math.ceil(lenPx / 14);
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps;
      const wob = noise.perlin2(s * 0.16 + sd, sd) * 9 + noise.perlin2(s * 0.7 + sd, 4) * 2;
      const wdt = wd * Math.pow(Math.sin(Math.PI * Math.min(0.98, Math.max(0.02, tt))), 0.55);
      const aa = a0 + tt * lenPx;
      const cc = c0 + wob;
      pts.push(grainU ? [aa, cc, wdt] : [cc, aa, wdt]);
    }
    shakes.push({ pts, depth: 1 });
  }
  if (shakes.length) {
    const dc = new Float32Array(w * h);
    rasterV(dc, w, h, shakes, { endTaper: 6 });
    for (let i = 0; i < w * h; i++) {
      const d = dc[i];
      if (d <= 0) continue;
      const k = 1 - 0.42 * Math.min(1, d * 1.4);
      rgba[i * 4] *= k;
      rgba[i * 4 + 1] *= k * 0.97;
      rgba[i * 4 + 2] *= k * 0.92;
      height[i] -= d * 0.0032;
      ao[i] *= 1 - 0.85 * Math.min(1, d * 1.2);
      rough[i] = Math.min(1, rough[i] + 0.1 * d);
    }
  }
  return { rgba, height, rough, ao, w, h };
}

// ------------------------------------------------------------------------------------------------
// The post: a hewn octagon, weathered, with adze scoops, lichen and a shake or two. Tileable.
// ------------------------------------------------------------------------------------------------
export function* paintPostSheet(seed = 1) {
  const w = SIGN_TEX.postW;
  const h = SIGN_TEX.postH;
  const pxPerM = w / SIGN_TEX.postPerimeterM;
  const sheet = yield* paintWoodSheet({
    w,
    h,
    pxPerM,
    seed: seed * 17 + 2,
    axis: "v",
    tileU: true,
    tileV: true,
    early: TONES.oakEarly,
    late: TONES.oakLate,
    silver: 0.62,
    damp: 0.4,
    lichen: 0.4,
    grain: 0.42,
    adze: true,
    cracks: 3,
    knots: 1,
  });
  return { ...sheet, texelMetres: 1 / pxPerM };
}

// ------------------------------------------------------------------------------------------------
// A lettered board. spec: {
//   seed, text, w, h (texels), pxPerM,
//   x0, y0: board-space metres of the texel (0, 0) corner (bottom left),
//   textX, textY: baseline left of the lettering in board space, cap, small: letter heights (metres)
//   decor: { kind: "leaf" | "bird", x, y, size, rot } or null
//   look: { early, late, silver, damp, lichen, groove: stain strength, mossGroove: 0..1, knots, cracks }
// }
// ------------------------------------------------------------------------------------------------
export function* paintBoardSheet(spec) {
  const { w, h, pxPerM, seed } = spec;
  const look = spec.look ?? {};
  const sheet = yield* paintWoodSheet({
    w,
    h,
    pxPerM,
    seed: seed * 29 + 11,
    axis: "u",
    early: look.early ?? TONES.oakEarly,
    late: look.late ?? TONES.oakLate,
    silver: look.silver ?? 0.55,
    damp: look.damp ?? 0.35,
    lichen: look.lichen ?? 0.25,
    grain: look.grain ?? 0.34,
    cracks: look.cracks ?? 2,
    knots: look.knots ?? 1,
  });
  const { rgba, height, rough, ao } = sheet;
  const N = w * h;

  // ---- the lettering as a depth field ---------------------------------------------------------------------------------
  const depth = new Float32Array(N);
  const word = layoutWord(spec.text, { cap: spec.cap ?? 0.14, small: spec.small ?? 0.114, seed });
  const toPx = (strokes, ox, oy) =>
    strokes.map((s) => ({ depth: s.depth, pts: s.pts.map(([px, py, pw]) => [(ox + px - spec.x0) * pxPerM, (oy + py - spec.y0) * pxPerM, pw * pxPerM]) }));
  rasterV(depth, w, h, toPx(word.strokes, spec.textX, spec.textY), { endTaper: 3 });
  if (spec.decor) {
    const d = layoutDecor(spec.decor.kind, spec.decor.size, { seed: seed + 5, rot: spec.decor.rot ?? 0 });
    rasterV(depth, w, h, toPx(d.strokes, spec.decor.x, spec.decor.y), { endTaper: 2 });
  }
  yield;
  // soften the V by one texel so it antialiases (the ridge at the groove bottom stays visible)
  const D = blurField(depth, w, h, 1, false);
  yield;

  // ---- apply the carving to colour, height, roughness, AO ---------------------------------------------------------------
  const noise = createNoise(seed * 5 + 91);
  const early = look.early ?? TONES.oakEarly;
  const stain = TONES.stain;
  const moss = TONES.moss;
  const mossK = look.mossGroove ?? 0;
  const stainK = look.groove ?? 0.62;
  const grooveDepth = SIGN_TEX.grooveDepthM;
  let done = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = D[i];
      if (d > 0.004) {
        const o4 = i * 4;
        // a thin lighter inner edge where the chisel cut fresh wood, then a stained, darker bottom
        const lip = smoothstep(0.01, 0.1, d) * (1 - smoothstep(0.1, 0.34, d));
        const st = smoothstep(0.1, 0.85, d);
        let r = rgba[o4];
        let g = rgba[o4 + 1];
        let b = rgba[o4 + 2];
        r += (early[0] * 1.08 - r) * 0.42 * lip;
        g += (early[1] * 1.08 - g) * 0.42 * lip;
        b += (early[2] * 1.05 - b) * 0.42 * lip;
        r += (stain[0] * 0.9 - r) * stainK * st;
        g += (stain[1] * 0.9 - g) * stainK * st;
        b += (stain[2] * 0.9 - b) * stainK * st;
        if (mossK > 0) {
          const m = clamp((noise.perlin2(x * 0.035, y * 0.06) * 0.5 + 0.5 - (0.5 - 0.35 * mossK)) * 3) * mossK * st;
          if (m > 0) {
            const mt = 0.8 + 0.4 * noise.perlin2(x * 0.3, y * 0.3);
            r += (moss[0] * mt - r) * m * 0.85;
            g += (moss[1] * mt - g) * m * 0.85;
            b += (moss[2] * mt - b) * m * 0.85;
          }
        }
        rgba[o4] = r;
        rgba[o4 + 1] = g;
        rgba[o4 + 2] = b;
        // depth: the cut is a V, with a little variation from tool to tool
        height[i] -= d * grooveDepth * (0.88 + 0.24 * (noise.perlin2(x * 0.09, y * 0.09) * 0.5 + 0.5));
        rough[i] = Math.min(1, rough[i] + 0.06 * st);
        ao[i] *= 1 - 0.62 * Math.pow(d, 0.8);
      }
    }
    done += w;
    if (done >= PIXELS_PER_CHUNK * 2) {
      done = 0;
      yield;
    }
  }
  return { rgba, height, rough, ao, w, h, texelMetres: 1 / pxPerM, lettering: word };
}

// ------------------------------------------------------------------------------------------------
// Grass tuft card (RGBA, alpha cut): blades as tapered curved strokes, a few dry ones. 128 x 128.
// ------------------------------------------------------------------------------------------------
export function* paintGrassCard(seed = 1) {
  const S = 128;
  const rng = createRng(seed * 313 + 9);
  const field = new Float32Array(S * S);
  const ids = new Uint16Array(S * S);
  const blades = [];
  const n = 34;
  for (let k = 0; k < n; k++) {
    const x0 = S * (0.3 + 0.4 * rng());
    const lean = (rng() - 0.5) * 1.4;
    const hgt = S * (0.5 + 0.48 * Math.pow(rng(), 0.7));
    const bend = (rng() - 0.5) * 0.9;
    const wBase = 3.6 + 2.2 * rng();
    const pts = [];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      const px = x0 + lean * hgt * t * 0.5 + bend * hgt * t * t * 0.6;
      const py = 2 + hgt * t * (1 - 0.18 * t);
      pts.push([px, py, Math.max(0.9, wBase * (1 - t) ** 0.8)]);
    }
    blades.push({ pts, depth: 1, dry: rng() < 0.14, shade: 0.75 + 0.5 * rng() });
  }
  rasterV(field, S, S, blades, { endTaper: 0, ids });
  yield;
  const rgba = new Uint8ClampedArray(S * S * 4);
  const dark = TONES.grassGreen.map((v) => v * 0.5);
  const light = mixBytes(TONES.grassGreen, TONES.lichenYellow, 0.3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const f = field[i];
      const o4 = i * 4;
      const id = ids[i] - 1;
      const bl = id >= 0 ? blades[id] : null;
      const t = y / S;
      const base = bl && bl.dry ? mixBytes(TONES.grassDry, scaleBytes(TONES.grassDry, 0.7), t) : mixBytes(dark, light, Math.min(1, t * 1.2));
      const k = bl ? bl.shade * (0.82 + 0.36 * Math.min(1, f * 2)) : 0.7;
      // colour is bled everywhere (so mip filtering never fades toward black); alpha carries the shape
      rgba[o4] = (bl ? base[0] : TONES.grassGreen[0] * 0.6) * k;
      rgba[o4 + 1] = (bl ? base[1] : TONES.grassGreen[1] * 0.6) * k;
      rgba[o4 + 2] = (bl ? base[2] : TONES.grassGreen[2] * 0.6) * k;
      rgba[o4 + 3] = f > 0 ? Math.min(255, 70 + f * 480) : 0;
    }
  }
  return { rgba, w: S, h: S };
}

// ------------------------------------------------------------------------------------------------
// A small weathered stone (tileable, 192 x 192): grey, speckled, with moss and a little lichen.
// ------------------------------------------------------------------------------------------------
export function* paintStoneSheet(seed = 1) {
  const S = 192;
  const noise = createNoise(seed * 19 + 4);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const wor = createWorley(seed + 31, 9, 9, 0.9);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const i = y * S + x;
      const big = noise.fbm2(u * 4, v * 4, 4, 4, 4);
      const fine = noise.perlin2(u * 64, v * 64, 64, 64);
      wor.sample(u * 9 + big * 0.8, v * 9 + big * 0.6);
      const crack = 1 - smoothstep(0, 0.09, wor.f2 - wor.f1);
      const warm = clamp(0.5 + 0.9 * noise.fbm2(u * 3 + 5, v * 3, 3, 3, 3));
      let c = mixBytes(TONES.stone, TONES.stoneWarm, warm);
      const k = 0.78 + 0.34 * (big * 0.5 + 0.5) + 0.12 * fine;
      c = scaleBytes(c, k);
      // moss in the low, damp hollows
      const mossM = smoothstep(0.1, 0.5, noise.fbm2(u * 5 + 9, v * 5 + 2, 3, 5, 5) - 0.2 * big);
      c = mixBytes(c, TONES.moss, mossM * 0.55);
      const lich = smoothstep(0.62, 0.8, noise.fbm2(u * 7 + 3, v * 7 + 8, 2, 7, 7)) * (0.5 + 0.5 * (fine * 0.5 + 0.5));
      c = mixBytes(c, TONES.lichenPale, lich * 0.6);
      c = scaleBytes(c, 1 - 0.45 * crack);
      const o4 = i * 4;
      rgba[o4] = c[0];
      rgba[o4 + 1] = c[1];
      rgba[o4 + 2] = c[2];
      rgba[o4 + 3] = 255;
      height[i] = 0.0016 * big + 0.0006 * fine + 0.0006 * mossM - 0.0012 * crack;
      rough[i] = clamp(0.86 + 0.1 * mossM - 0.05 * (1 - crack) * 0, 0.5, 1);
      ao[i] = clamp(1 - 0.5 * crack - 0.12 * (1 - mossM) * 0, 0, 1);
    }
    if (y % 24 === 23) yield;
  }
  return { rgba, height, rough, ao, w: S, h: S, texelMetres: 0.35 / S };
}

export { textureSetFrom };
