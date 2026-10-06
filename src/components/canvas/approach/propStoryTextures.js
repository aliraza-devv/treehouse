// Painted (computed) textures for the story props: the sawn top of the stump with its growth rings, the
// child's painted arrow board and the muddy tread of the boot sole. Same rules as propSignTextures.js: no
// canvas, seeded, generators that yield, row 0 = the bottom of the texture, heights in metres.

import { createNoise, createWorley, hash2 } from "@/lib/noise";
import { createRng } from "@/lib/random";
import { TONES, mixBytes, scaleBytes } from "./propTones";
import { clamp, smoothstep, TAU } from "./propKit";
import { paintWoodSheet } from "./propSignTextures";
import { rasterV } from "./propLetters";

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const STORY_TEX = {
  stumpSize: 256, // the sawn top: 256 x 256 texels over the disc's bounding square
  stumpSquareM: 0.66, // metres the stump texture's square covers (a little more than the 0.62 m disc)
  arrowW: 256, // the arrow board: 256 x 88 texels for a 0.36 x 0.124 m board
  arrowH: 88,
  arrowPxPerM: 710,
  soleW: 64,
  soleH: 160,
  soleSquareM: [0.088, 0.22], // metres the sole texture covers (width, length)
};

// ------------------------------------------------------------------------------------------------
// The sawn top of the stump
// ------------------------------------------------------------------------------------------------
// A felled oak, cut some winters ago: growth rings (bold ones a centimetre and a half apart, a finer set between
// them), a darker heartwood, a silvered weathered surface, radial drying checks, a bark rim, moss creeping in from
// the shady side and a few lichens and leaf stains. r is the disc radius in metres.
export function* paintStumpTop(seed = 1, r = 0.31) {
  const S = STORY_TEX.stumpSize;
  const sq = STORY_TEX.stumpSquareM;
  const px = S / sq; // texels per metre
  const noise = createNoise(seed * 13 + 3);
  const rng = createRng(seed * 71 + 9);
  const rgba = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);
  const pith = [(rng() - 0.5) * 0.05, (rng() - 0.5) * 0.04]; // the heart is never dead centre
  const ringPhase = rng() * 10;
  const heart = mixBytes(TONES.oakLate, TONES.stain, 0.3);
  const sap = mixBytes(TONES.oakEarly, TONES.silver, 0.25);
  const bark = mixBytes(TONES.stain, TONES.soil, 0.5);
  const wor = createWorley(seed + 5, 22, 22, 0.95);

  // radial checks (drying cracks) from near the heart outward, as strokes in texels
  const checks = [];
  const nCheck = 6 + Math.floor(rng() * 3);
  for (let k = 0; k < nCheck; k++) {
    const a = rng() * TAU;
    const len = (0.12 + 0.17 * rng()) / 1;
    const pts = [];
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const d = 0.015 + t * len;
      const wob = noise.perlin2(k * 3.1 + t * 4, 1.7) * 0.012;
      const aa = a + wob / Math.max(0.05, d);
      const x = (pith[0] + Math.cos(aa) * d) * px + S / 2;
      const y = (pith[1] + Math.sin(aa) * d) * px + S / 2;
      pts.push([x, y, (1.4 + 3.2 * Math.pow(1 - t, 0.6)) * (0.8 + 0.5 * rng())]);
    }
    checks.push({ pts, depth: 1 });
  }
  const checkField = new Float32Array(S * S);
  rasterV(checkField, S, S, checks, { endTaper: 5 });
  yield;

  const mossSide = rng() * TAU; // moss comes in from the shaded side
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const mx = (x + 0.5 - S / 2) / px; // metres from the disc centre
      const my = (y + 0.5 - S / 2) / px;
      const rr = Math.hypot(mx, my);
      const ang = Math.atan2(my, mx);
      const dx = mx - pith[0];
      const dy = my - pith[1];
      let rho = Math.hypot(dx, dy);
      // rings wander: an egg shaped heart, slow warp
      rho *= 1 + 0.08 * noise.perlin2(Math.cos(ang) * 1.3 + 4, Math.sin(ang) * 1.3) + 0.03 * noise.perlin2(rho * 14, ang);
      const ph = rho / 0.0145 + ringPhase;
      const rf = ph - Math.floor(ph);
      const late = rf * rf * rf;
      const fine = noise.perlin2(rho * 160, ang * 3) * 0.5 + 0.5; // the finer ring set
      const heartK = 1 - smoothstep(0.1, 0.22, rho); // the heartwood is darker
      const base = mixBytes(sap, heart, heartK * 0.8);
      let c = mixBytes(base, scaleBytes(base, 0.62), clamp(late * 0.75 + fine * 0.2));
      // weathering: silvered, patchy, more at the edge
      const wk = clamp(0.35 + 0.5 * (noise.perlin2(mx * 6 + 9, my * 6) * 0.5 + 0.5) + 0.3 * smoothstep(0.15, 0.3, rr));
      c = mixBytes(c, TONES.silver, wk * 0.55);
      // saw marks: faint concentric arcs at wide spacing (a chainsaw swung round the log)
      const kerf = 0.5 + 0.5 * Math.sin(rr * 220 + noise.perlin2(ang * 2, 1) * 3);
      c = scaleBytes(c, 0.95 + 0.07 * kerf);
      // grain pores: speckle
      c = scaleBytes(c, 0.92 + 0.14 * hash2(x, y, seed));
      let hgt = 0.0004 * (late - 0.4) + 0.0003 * kerf;
      let ao1 = 1 - 0.18 * late;
      // checks
      const ck = checkField[i];
      if (ck > 0) {
        c = scaleBytes(c, 1 - 0.7 * Math.min(1, ck * 1.4));
        hgt -= ck * 0.004;
        ao1 *= 1 - 0.8 * Math.min(1, ck);
      }
      // damp stains and leaf scraps (dark blotches)
      const stain = smoothstep(0.55, 0.8, noise.fbm2(mx * 9 + 3, my * 9 + 8, 3));
      c = scaleBytes(c, 1 - 0.28 * stain);
      // the bark rim and a rolled sapwood lip just inside it
      const rim = smoothstep(r - 0.028, r - 0.014, rr);
      c = mixBytes(c, bark, rim);
      hgt += rim * 0.003;
      const rimMask = 1 - smoothstep(r + 0.004, r + 0.02, rr);
      // moss: thick at the rim on the shaded side, thinning inward, in cushions
      const side = 0.5 + 0.5 * Math.cos(ang - mossSide);
      const mossN = noise.fbm2(mx * 18 + 11, my * 18 + 4, 3) * 0.5 + 0.5;
      const mossK = clamp((smoothstep(0.1, 0.9, side) * smoothstep(r - 0.11, r - 0.015, rr) + 0.2 * smoothstep(r - 0.05, r, rr)) * (0.45 + 0.9 * mossN) * 1.1);
      const mossC = smoothstep(0.22, 0.75, mossK); // cushions with bare wood between, not a gradient
      if (mossC > 0.02) {
        wor.sample((mx + 0.5) * 22, (my + 0.5) * 22);
        const tip = 0.62 + 0.4 * wor.id;
        const mc = mixBytes(TONES.mossDark, TONES.moss, clamp(mossN * 0.9) * 0.7);
        c = mixBytes(c, scaleBytes(mc, tip), Math.min(1, mossC) * 0.92);
        hgt += mossC * 0.0035 * (0.6 + 0.8 * (1 - wor.f1));
        ao1 *= 1 - 0.3 * mossC;
      }
      // a pale lichen crust, a few discs
      const lp = smoothstep(0.62, 0.78, noise.fbm2(mx * 7 + 20, my * 7, 2));
      if (lp > 0 && mossC < 0.3) {
        c = mixBytes(c, TONES.lichenPale, 0.5 * lp * (0.5 + 0.5 * hash2(x >> 1, y >> 1, seed + 2)));
      }
      const o4 = i * 4;
      if (rr > r + 0.01) {
        // outside the disc: bark colour (it is never drawn, but mips bleed it in)
        c = bark;
      }
      rgba[o4] = c[0];
      rgba[o4 + 1] = c[1];
      rgba[o4 + 2] = c[2];
      rgba[o4 + 3] = 255;
      height[i] = hgt * (rimMask > 0 ? 1 : 0);
      rough[i] = clamp(0.88 + 0.08 * wk - 0.1 * stain + 0.04 * mossK, 0.5, 1);
      ao[i] = clamp(ao1, 0, 1);
    }
    if (y % 24 === 23) yield;
  }
  return { rgba, height, rough, ao, w: S, h: S, texelMetres: 1 / px };
}

// ------------------------------------------------------------------------------------------------
// The child's arrow: a pale pine offcut with a wobbly arrow in warm cream paint, chipped and faded, two
// nail heads with rust streaks running down from them.
// ------------------------------------------------------------------------------------------------
// Texture space: x runs along the board (the arrow points toward +x), y up. Returns the same planes as the
// wood sheet. nails: texel positions of the nail heads are returned so the geometry can match them.
export function* paintArrowBoard(seed = 1) {
  const W = STORY_TEX.arrowW;
  const H = STORY_TEX.arrowH;
  const pxPerM = STORY_TEX.arrowPxPerM;
  const sheet = yield* paintWoodSheet({
    w: W,
    h: H,
    pxPerM,
    seed: seed * 23 + 4,
    axis: "u",
    early: mixBytes(TONES.oakEarly, TONES.paintCream, 0.3), // pale pine, an offcut from a fence rail
    late: mixBytes(TONES.oakLate, TONES.oakEarly, 0.35),
    silver: 0.42,
    damp: 0.35,
    lichen: 0.18,
    cracks: 1,
    knots: 1,
  });
  const { rgba, height, rough, ao } = sheet;
  const noise = createNoise(seed * 41 + 7);
  const rng = createRng(seed * 977 + 13);

  // ---- the arrow, drawn the way a child would: a crooked shaft, a head of two unequal strokes ---------------------
  const wob = (k, a) => noise.perlin2(k * 0.07 + 3, a) * 3;
  const shaft = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    shaft.push([26 + t * 178, 44 + 2.5 * t + wob(k, 1) * 0.6, 14.5 - 1.2 * Math.sin(t * 3) + wob(k, 5) * 0.2]);
  }
  const tip = [236, 47];
  const arms = [
    // upper arm: shorter and steeper
    [
      [tip[0], tip[1], 12.5],
      [tip[0] - 15, tip[1] + 11, 12],
      [tip[0] - 30, tip[1] + 19, 11.5],
    ],
    // lower arm: longer, a little bent
    [
      [tip[0], tip[1], 12.5],
      [tip[0] - 17, tip[1] - 9, 12],
      [tip[0] - 36, tip[1] - 20 - 2, 11.5],
    ],
  ];
  const strokes = [{ pts: shaft, depth: 1 }, ...arms.map((a) => ({ pts: a, depth: 1 }))];
  // drips from the underside of the shaft
  for (let d = 0; d < 3; d++) {
    const dx = 50 + rng() * 140;
    const dy = 44 - 6.5;
    strokes.push({
      pts: [
        [dx, dy, 3.2],
        [dx + 0.5, dy - 5 - rng() * 5, 2.2],
      ],
      depth: 1,
    });
  }
  const paintD = new Float32Array(W * H);
  rasterV(paintD, W, H, strokes, { endTaper: 2 });

  const wood = (i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = paintD[i];
      if (d <= 0) continue;
      // brush body: opaque in the middle, soft at the edge, streaky along the stroke
      let a = smoothstep(0.0, 0.3, d);
      const streak = 0.85 + 0.15 * noise.perlin2(x * 0.04, y * 0.8 + 5);
      // chipped and faded: flaked off in patches, thinner toward the board's edges and where it is rubbed
      const chip = smoothstep(0.58, 0.74, noise.fbm2(x * 0.06 + 2, y * 0.09 + 8, 3) * 0.5 + 0.5);
      const fade = 0.22 + 0.4 * (noise.perlin2(x * 0.02, y * 0.03 + 12) * 0.5 + 0.5);
      a *= (1 - chip * 0.9) * (1 - fade * 0.55);
      if (a <= 0.01) continue;
      const pc = mixBytes(TONES.paintWarm, TONES.paintCream, 0.35 + 0.25 * noise.perlin2(x * 0.03, y * 0.05));
      const w = wood(i);
      const o4 = i * 4;
      rgba[o4] = w[0] + (pc[0] * streak - w[0]) * a;
      rgba[o4 + 1] = w[1] + (pc[1] * streak - w[1]) * a;
      rgba[o4 + 2] = w[2] + (pc[2] * streak - w[2]) * a;
      height[i] += 0.00022 * a;
      rough[i] = clamp(rough[i] - 0.18 * a, 0.4, 1); // paint is smoother than the wood
    }
  }
  // ---- two nails with rust streaks down the board ----------------------------------------------------------------------------
  const nails = [
    [13, 47],
    [W - 13, 40],
  ];
  for (const [nx, ny] of nails) {
    for (let t = 0; t < 34; t++) {
      const fall = Math.pow(1 - t / 34, 1.3);
      const sway = noise.perlin2(nx * 0.1, t * 0.12) * 1.2;
      for (let dx = -4; dx <= 4; dx++) {
        const yy = Math.round(ny - t);
        const xx = Math.round(nx + sway + dx);
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const cov = clamp(1 - Math.abs(dx) / 4.2) * fall * 0.7;
        const i = yy * W + xx;
        const o4 = i * 4;
        rgba[o4] += (TONES.rust[0] * 0.7 - rgba[o4]) * cov;
        rgba[o4 + 1] += (TONES.rust[1] * 0.6 - rgba[o4 + 1]) * cov;
        rgba[o4 + 2] += (TONES.rust[2] * 0.6 - rgba[o4 + 2]) * cov;
      }
    }
  }
  return { rgba, height, rough, ao, w: W, h: H, texelMetres: 1 / pxPerM, nails };
}

// ------------------------------------------------------------------------------------------------
// The boot sole: dark rubber with a chevron tread, caked with wet mud in the recesses
// ------------------------------------------------------------------------------------------------
export function* paintSole(seed = 1) {
  const W = STORY_TEX.soleW;
  const H = STORY_TEX.soleH;
  const [mW, mH] = STORY_TEX.soleSquareM;
  const texel = mW / W;
  const noise = createNoise(seed * 17 + 2);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const rough = new Float32Array(W * H);
  const ao = new Float32Array(W * H);
  const wor = createWorley(seed + 8, 7, 14, 0.95);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const i = y * W + x;
      // chevrons: lines of constant (|u - 0.5| * k + v * m), raised ribs 5 mm wide every 11 mm along the sole
      const cu = Math.abs(u - 0.5) * 2; // 0 in the middle, 1 at the edge
      const ph = (v * mH) / 0.011 + cu * 1.7;
      const rf = ph - Math.floor(ph);
      const rib = smoothstep(0.1, 0.25, rf) * (1 - smoothstep(0.5, 0.65, rf));
      // a smooth plain heel and ball zone breaks the pattern (the tread is only under the forefoot and heel)
      const plain = smoothstep(0.52, 0.55, v) * (1 - smoothstep(0.58, 0.62, v));
      const ribK = rib * (1 - plain);
      wor.sample(u * 7 + noise.perlin2(u * 3, v * 3), v * 14);
      // mud: heavy in the recesses, a thinner smear on the ribs, bare rubber where it is worn clean
      const mudN = noise.fbm2(u * 9 + 3, v * 16 + 1, 3) * 0.5 + 0.5;
      const mud = clamp((1 - ribK) * (0.55 + 0.8 * mudN) + ribK * (mudN - 0.55) * 1.2 + 0.25 * (1 - wor.f1) * mudN - 0.18);
      const rubber = mixBytes(TONES.rubberSole, TONES.rubberGreen, 0.12 + 0.2 * ribK);
      const mudC = mixBytes(TONES.soilWet, TONES.soil, 0.4 + 0.5 * mudN);
      const c = mixBytes(rubber, scaleBytes(mudC, 0.9 + 0.3 * wor.id), Math.min(0.96, mud));
      const o4 = i * 4;
      rgba[o4] = c[0];
      rgba[o4 + 1] = c[1];
      rgba[o4 + 2] = c[2];
      rgba[o4 + 3] = 255;
      height[i] = 0.003 * ribK + 0.0025 * mud * (0.5 + 0.8 * wor.id) - 0.001 * (1 - ribK) * (1 - mud);
      rough[i] = clamp(0.5 + 0.45 * mud, 0.3, 1);
      ao[i] = clamp(1 - 0.5 * (1 - ribK) * (1 - mud * 0.6), 0, 1);
    }
  }
  yield;
  return { rgba, height, rough, ao, w: W, h: H, texelMetres: texel };
}
