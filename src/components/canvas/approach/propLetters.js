// Hand cut lettering for the signposts, as STROKES, not as a font.
//
// Why strokes: a font would make the carving depend on whatever the visitor's machine has installed (the
// scene must be identical on every load), and a V-groove needs a distance to the stroke centre line, which
// strokes give exactly. Each letter is a handful of centre lines with a width along them (surface width of
// the cut, in em units, cap height = 1). A chisel cut Roman capital has thick stems, thin hair lines, and
// little foot serifs; the round letters are thick at the sides and thin at the top and bottom. The depth of
// the groove at a pixel is 1 on the centre line falling linearly to 0 at the edge of the stroke: a V.
//
// layoutWord() sets a word as "small capitals" (the initial a full capital, the rest 80 percent), with the
// small faults of a human hand: each letter its own tiny rotation, baseline wander, size and spacing, each
// stroke its own width and depth, centre lines wobbled a fraction of a millimetre, cuts that taper where
// the chisel stops. rasterV() then turns strokes into a depth field.

import { createRng } from "@/lib/random";
import { createNoise } from "@/lib/noise";
import { clamp, smoothstep } from "./propKit";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// Stroke construction helpers (em units, y up, baseline 0, cap height 1)
// ------------------------------------------------------------------------------------------------
const T = 0.15; // thick stem
const t = 0.065; // hair line
const SER = 0.05; // serif cut

// Uniform Catmull-Rom through control triples [x, y, w], n samples per span. Open or closed.
function spline(pts, n = 5, closed = false) {
  const out = [];
  const m = pts.length;
  const P = (i) => (closed ? pts[((i % m) + m) % m] : pts[Math.max(0, Math.min(m - 1, i))]);
  const spans = closed ? m : m - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let k = 0; k < n; k++) {
      const s = k / n;
      const s2 = s * s;
      const s3 = s2 * s;
      const q = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        q[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * s + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * s2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * s3);
      }
      out.push(q);
    }
  }
  if (!closed) out.push([...P(m - 1)]);
  else out.push([...out[0]]);
  return out;
}
// A straight cut (three points so a hand wobble can bend it).
const line = (x0, y0, x1, y1, w0, w1 = w0) => [
  [x0, y0, w0],
  [(x0 + x1) / 2, (y0 + y1) / 2, (w0 + w1) / 2],
  [x1, y1, w1],
];
const serif = (x, y, half = 0.12) => line(x - half, y, x + half, y, SER);
// An elliptical arc, thick at the sides, thin at top and bottom. angles in degrees, counter clockwise from +X.
function ellipse(cx, cy, rx, ry, a0, a1, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    const w = 0.062 + 0.098 * Math.pow(Math.abs(Math.cos(a - 0.12)), 1.5);
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, w]);
  }
  return pts;
}

// ------------------------------------------------------------------------------------------------
// The alphabet that is carved: S U R E Y L A K C O M Q B H (Surrey, Lake Como, Quebec, Seychelles)
// ------------------------------------------------------------------------------------------------
const GLYPHS = {
  S: {
    adv: 0.64,
    strokes: [
      spline(
        [
          [0.55, 0.8, 0.05],
          [0.47, 0.94, 0.075],
          [0.32, 0.995, 0.09],
          [0.17, 0.95, 0.1],
          [0.1, 0.8, 0.11],
          [0.16, 0.65, 0.12],
          [0.32, 0.54, 0.14],
          [0.48, 0.43, 0.145],
          [0.56, 0.3, 0.13],
          [0.51, 0.12, 0.11],
          [0.37, 0.015, 0.09],
          [0.21, 0.0, 0.075],
          [0.08, 0.07, 0.06],
          [0.03, 0.2, 0.05],
        ],
        4,
      ),
    ],
  },
  U: {
    adv: 0.74,
    strokes: [
      line(0.1, 1.0, 0.1, 0.36, T, 0.14),
      spline(
        [
          [0.1, 0.36, 0.14],
          [0.14, 0.17, 0.12],
          [0.28, 0.04, 0.085],
          [0.42, 0.0, 0.07],
          [0.56, 0.04, 0.07],
          [0.64, 0.17, 0.065],
          [0.65, 0.32, 0.065],
        ],
        4,
      ),
      line(0.65, 1.0, 0.65, 0.3, t),
      serif(0.1, 1.0, 0.13),
      serif(0.65, 1.0, 0.11),
    ],
  },
  R: {
    adv: 0.7,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      spline(
        [
          [0.1, 0.985, 0.065],
          [0.34, 0.985, 0.07],
          [0.5, 0.93, 0.1],
          [0.58, 0.78, 0.13],
          [0.53, 0.62, 0.11],
          [0.39, 0.53, 0.08],
          [0.1, 0.515, 0.06],
        ],
        4,
      ),
      line(0.3, 0.52, 0.64, 0.0, 0.1, 0.14),
      serif(0.1, 1.0, 0.13),
      serif(0.1, 0.0, 0.13),
      serif(0.66, 0.0, 0.12),
    ],
  },
  E: {
    adv: 0.6,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      line(0.1, 0.97, 0.53, 0.97, 0.06),
      line(0.53, 0.97, 0.53, 0.8, 0.045),
      line(0.1, 0.52, 0.43, 0.52, 0.055),
      line(0.43, 0.52, 0.43, 0.63, 0.04),
      line(0.1, 0.03, 0.55, 0.03, 0.06),
      line(0.55, 0.03, 0.55, 0.22, 0.045),
      serif(0.1, 1.0, 0.12),
      serif(0.1, 0.0, 0.12),
    ],
  },
  Y: {
    adv: 0.72,
    strokes: [
      line(0.05, 1.0, 0.36, 0.45, 0.07, 0.14),
      line(0.67, 1.0, 0.38, 0.45, 0.05, 0.06),
      line(0.37, 0.45, 0.37, 0.0, 0.14),
      serif(0.05, 1.0, 0.1),
      serif(0.67, 1.0, 0.1),
      serif(0.37, 0.0, 0.12),
    ],
  },
  L: {
    adv: 0.54,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      line(0.1, 0.03, 0.49, 0.03, 0.06),
      line(0.49, 0.03, 0.49, 0.22, 0.045),
      serif(0.1, 1.0, 0.12),
      serif(0.1, 0.0, 0.12),
    ],
  },
  A: {
    adv: 0.8,
    strokes: [
      line(0.4, 1.0, 0.05, 0.0, 0.045, 0.06),
      line(0.4, 1.0, 0.73, 0.0, 0.05, 0.15),
      line(0.18, 0.32, 0.6, 0.32, 0.05),
      serif(0.05, 0.0, 0.11),
      serif(0.73, 0.0, 0.12),
    ],
  },
  K: {
    adv: 0.68,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      line(0.61, 1.0, 0.1, 0.42, 0.06, 0.065),
      line(0.27, 0.58, 0.63, 0.0, 0.1, 0.14),
      serif(0.1, 1.0, 0.12),
      serif(0.1, 0.0, 0.12),
      serif(0.6, 1.0, 0.1),
      serif(0.65, 0.0, 0.11),
    ],
  },
  C: {
    adv: 0.74,
    strokes: [
      ellipse(0.42, 0.5, 0.34, 0.49, 42, 318, 30),
      line(0.65, 0.84, 0.65, 0.68, 0.05),
      line(0.65, 0.16, 0.65, 0.32, 0.05),
    ],
  },
  O: {
    adv: 0.86,
    strokes: [ellipse(0.43, 0.5, 0.37, 0.49, 0, 360, 36)],
  },
  M: {
    adv: 0.96,
    strokes: [
      line(0.09, 0.0, 0.09, 1.0, 0.06),
      line(0.09, 1.0, 0.48, 0.0, 0.07, 0.15),
      line(0.48, 0.0, 0.87, 1.0, 0.06),
      line(0.87, 1.0, 0.87, 0.0, 0.15),
      serif(0.09, 1.0, 0.1),
      serif(0.09, 0.0, 0.1),
      serif(0.87, 0.0, 0.13),
      serif(0.87, 1.0, 0.1),
    ],
  },
  Q: {
    adv: 0.86,
    strokes: [
      ellipse(0.43, 0.5, 0.37, 0.49, 0, 360, 36),
      spline(
        [
          [0.46, 0.16, 0.06],
          [0.6, 0.0, 0.09],
          [0.76, -0.1, 0.07],
        ],
        4,
      ),
    ],
  },
  B: {
    adv: 0.68,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      spline(
        [
          [0.1, 0.985, 0.06],
          [0.33, 0.985, 0.065],
          [0.47, 0.93, 0.09],
          [0.52, 0.78, 0.12],
          [0.45, 0.62, 0.1],
          [0.32, 0.535, 0.07],
          [0.1, 0.52, 0.055],
        ],
        4,
      ),
      spline(
        [
          [0.1, 0.52, 0.055],
          [0.38, 0.52, 0.07],
          [0.56, 0.45, 0.11],
          [0.63, 0.27, 0.14],
          [0.53, 0.09, 0.11],
          [0.37, 0.015, 0.075],
          [0.1, 0.02, 0.06],
        ],
        4,
      ),
      serif(0.1, 1.0, 0.12),
      serif(0.1, 0.0, 0.12),
    ],
  },
  H: {
    adv: 0.84,
    strokes: [
      line(0.1, 1.0, 0.1, 0.0, T),
      line(0.72, 1.0, 0.72, 0.0, 0.1),
      line(0.1, 0.5, 0.72, 0.5, 0.05),
      serif(0.1, 1.0, 0.12),
      serif(0.1, 0.0, 0.12),
      serif(0.72, 1.0, 0.1),
      serif(0.72, 0.0, 0.1),
    ],
  },
};

// Small decorations, drawn in the same units (1 = the decoration's height).
// An oak leaf: a lobed outline, a mid rib and a short stalk.
const LEAF = {
  adv: 0.62,
  strokes: [
    spline(
      [
        [0.3, 0.98, 0.07],
        [0.4, 0.88, 0.07],
        [0.5, 0.84, 0.07],
        [0.46, 0.72, 0.07],
        [0.6, 0.66, 0.07],
        [0.52, 0.54, 0.07],
        [0.62, 0.42, 0.07],
        [0.5, 0.32, 0.07],
        [0.4, 0.14, 0.07],
        [0.3, 0.14, 0.07],
        [0.2, 0.32, 0.07],
        [0.0, 0.42, 0.07],
        [0.08, 0.54, 0.07],
        [0.0, 0.66, 0.07],
        [0.14, 0.72, 0.07],
        [0.1, 0.84, 0.07],
        [0.2, 0.88, 0.07],
      ],
      3,
      true,
    ),
    line(0.3, 0.9, 0.3, 0.12, 0.055),
    line(0.3, 0.14, 0.33, -0.06, 0.07),
    line(0.3, 0.64, 0.5, 0.74, 0.04),
    line(0.3, 0.5, 0.1, 0.62, 0.04),
  ],
};
// A bird in flight (a swift or a tern): a plump tapered body, two long swept wings and a forked tail. Thick
// cuts, because at the size of a hand it has to read as a bird from a few metres.
const BIRD = {
  adv: 1.2,
  strokes: [
    // body: beak to tail root, plump in the middle
    spline(
      [
        [0.1, 0.52, 0.05],
        [0.28, 0.5, 0.2],
        [0.5, 0.49, 0.25],
        [0.74, 0.46, 0.17],
        [0.92, 0.43, 0.08],
      ],
      4,
    ),
    // the up wing sweeps up and back
    spline(
      [
        [0.4, 0.56, 0.16],
        [0.5, 0.74, 0.16],
        [0.68, 0.9, 0.11],
        [0.92, 1.0, 0.05],
      ],
      4,
    ),
    // the down wing sweeps down and back
    spline(
      [
        [0.42, 0.44, 0.16],
        [0.52, 0.26, 0.15],
        [0.68, 0.1, 0.1],
        [0.9, 0.02, 0.05],
      ],
      4,
    ),
    // forked tail
    line(0.9, 0.46, 1.18, 0.6, 0.1, 0.045),
    line(0.9, 0.42, 1.18, 0.28, 0.1, 0.045),
    // beak
    line(0.12, 0.52, 0.0, 0.56, 0.06, 0.03),
  ],
};
export const DECOR = { leaf: LEAF, bird: BIRD };

// ------------------------------------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------------------------------------
// Sets `word` (letters, spaces) as small capitals and returns the strokes in METRES with the origin at
// the left end of the baseline. { strokes: [{ pts: [[x, y, w]], depth }], width, capHeight, smallHeight }.
//   cap, small   cap height of the initial and of the other letters (metres)
//   seed         the hand: every letter and stroke differs a little
//   track        extra spacing between letters (metres)
export function layoutWord(word, { cap = 0.14, small = 0.112, seed = 1, track = 0.012, wobble = 1 } = {}) {
  const rng = createRng(seed * 7919 + 17);
  const noise = createNoise(seed * 31 + 5);
  const out = [];
  let x = 0;
  let first = true;
  for (const ch of word.toUpperCase()) {
    if (ch === " ") {
      x += small * 0.42 + track;
      first = true; // each word begins with a full capital
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) throw new Error(`propLetters: no glyph for "${ch}"`);
    const size = (first ? cap : small) * (1 + (rng() - 0.5) * 0.05);
    const rot = (rng() - 0.5) * 0.045; // about 1.3 degrees either way
    const baseShift = (rng() - 0.5) * 0.012 * size + noise.perlin2(x * 6, 3.3) * 0.004 * wobble;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const midX = g.adv / 2;
    for (const stroke of g.strokes) {
      const wMul = 0.9 + rng() * 0.22;
      const depth = 0.78 + rng() * 0.3;
      const pts = stroke.map(([px, py, pw], k) => {
        // wobble the centre line a fraction of a millimetre, rotate the whole letter a hair about its centre
        const jx = noise.perlin2(px * 4 + x * 9, py * 4 + k * 0.3) * 0.006 * wobble;
        const jy = noise.perlin2(px * 4 + 20, py * 4 + x * 9) * 0.006 * wobble;
        const lx = px + jx - midX;
        const ly = py + jy - 0.5;
        const rx = lx * c - ly * s + midX;
        const ry = lx * s + ly * c + 0.5;
        return [x + rx * size, baseShift + ry * size, Math.max(0.018, pw * size * wMul * (0.95 + 0.1 * noise.perlin2(k * 0.7, px * 3 + 40)))];
      });
      out.push({ pts, depth });
    }
    x += g.adv * size + track + (rng() - 0.5) * 0.008;
    first = false;
  }
  return { strokes: out, width: x - track, capHeight: cap, smallHeight: small };
}

// A decoration (leaf or bird) of height `size` metres, left end at x0, baseline at y0, rotated by `rot`.
export function layoutDecor(kind, size, { seed = 1, rot = 0 } = {}) {
  const g = DECOR[kind];
  const rng = createRng(seed * 977 + 3);
  const noise = createNoise(seed * 13 + 7);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const strokes = g.strokes.map((stroke, si) => ({
    depth: 0.85 + rng() * 0.2,
    pts: stroke.map(([px, py, pw], k) => {
      const jx = noise.perlin2(px * 5 + si, py * 5) * 0.012;
      const jy = noise.perlin2(px * 5, py * 5 + si + 9) * 0.012;
      const lx = px + jx - g.adv / 2;
      const ly = py + jy - 0.5;
      return [(lx * c - ly * s + g.adv / 2) * size, (lx * s + ly * c + 0.5) * size, Math.max(0.02 * size, pw * size * (kind === "bird" ? 0.8 : 0.58) * (1 + 0.1 * noise.perlin2(k, si * 3)))];
    }),
  }));
  return { strokes, width: g.adv * size, height: size };
}

// ------------------------------------------------------------------------------------------------
// Rasteriser: strokes in PIXELS -> V groove depth field (0 outside, 1 on the centre line)
// ------------------------------------------------------------------------------------------------
// field: Float32Array(w * h), row 0 = bottom. stroke: { pts: [[x, y, widthPx]], depth }. Depth is kept as the
// max over strokes. endTaper (px): a chisel stop cut starts shallow, so the groove deepens over this distance
// from each end of a stroke. ids (optional Uint16Array) receives (stroke index + 1) where the stroke wins.
export function rasterV(field, w, h, strokes, { endTaper = 3, ids = null, idBase = 0 } = {}) {
  strokes.forEach((st, si) => {
    const pts = st.pts;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(total);
    }
    const dmul = st.depth ?? 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, w0] = pts[i];
      const [x1, y1, w1] = pts[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l2 = dx * dx + dy * dy;
      const wm = Math.max(w0, w1) / 2 + 1;
      const xa = Math.max(0, Math.floor(Math.min(x0, x1) - wm));
      const xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + wm));
      const ya = Math.max(0, Math.floor(Math.min(y0, y1) - wm));
      const yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + wm));
      for (let y = ya; y <= yb; y++) {
        const row = y * w;
        for (let x = xa; x <= xb; x++) {
          const px = x + 0.5 - x0;
          const py = y + 0.5 - y0;
          const u = l2 > 1e-9 ? clamp((px * dx + py * dy) / l2) : 0;
          const ex = px - dx * u;
          const ey = py - dy * u;
          const d = Math.sqrt(ex * ex + ey * ey);
          const hw = (w0 + (w1 - w0) * u) / 2;
          if (d >= hw) continue;
          const along = cum[i] + u * Math.sqrt(l2);
          const taper = endTaper > 0 ? smoothstep(0, endTaper, along) * smoothstep(0, endTaper, total - along) * 0.7 + 0.3 : 1;
          const depth = (1 - d / hw) * dmul * taper;
          const k = row + x;
          if (depth > field[k]) {
            field[k] = depth;
            if (ids) ids[k] = idBase + si + 1;
          }
        }
      }
    }
  });
  return field;
}

export const TWO_PI = TAU;
