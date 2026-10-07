// The loader's drawing, as data: the hero's own treehouse (a gabled house with a porthole window, a string of lights under
// the eave, a lantern on the deck, a ladder against the trunk), drawn the way a person would sketch it, not as an icon: the
// lines are not quite straight, the rungs are not quite level, there is a little shading on the trunk, and the strong lines
// are gone over twice. Every coordinate is placed by hand in a 360 x 420 box and rounded to 0.1, so the server and the browser
// agree.
//
// Each line draws itself (Preloader.jsx, with the CSS in globals.css): `at` is when it starts and `dur` how long it takes, in
// seconds, on a clock that begins when the loader first paints. The whole drawing is done by DRAW_SECONDS. `tone` picks the
// pencil: main (strong), soft (shading and detail) or leaf (the crown, in the brand's light green).
// Every time below is written on the original 1.05 second clock and played at SPEED of it (the Preloader scales them), so the
// whole drawing takes DRAW_SECONDS. The drawing itself is untouched.
export const SPEED = 0.78;
export const DRAW_SECONDS = Math.round(1.05 * SPEED * 1000) / 1000;

const r1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;

// The ladder: two rails leaning on the deck, nine rungs that are each a little off level
const RAIL_L = [
  [76, 382],
  [100, 208],
];
const RAIL_R = [
  [106, 382],
  [130, 208],
];
const WOBBLE = [
  [0.9, -0.7],
  [-0.6, 0.8],
  [0.7, 0.4],
  [-0.9, -0.6],
  [0.4, 0.9],
  [-0.7, 0.3],
  [0.8, -0.8],
  [-0.3, 0.7],
  [0.6, -0.4],
];
const RUNGS = WOBBLE.map(([a, b], i) => {
  const t = 0.07 + (i / (WOBBLE.length - 1)) * 0.86;
  const xl = lerp(RAIL_L[0][0], RAIL_L[1][0], t);
  const yl = lerp(RAIL_L[0][1], RAIL_L[1][1], t);
  const xr = lerp(RAIL_R[0][0], RAIL_R[1][0], t);
  const yr = lerp(RAIL_R[0][1], RAIL_R[1][1], t);
  return { d: `M${r1(xl + a)} ${r1(yl + b)} L${r1(xr - a)} ${r1(yr + a)}`, at: 0.34 + i * 0.045, dur: 0.17 };
});

// The string of lights: a wire sagging under the eave, a bulb at seven points along it
const WIRE = { from: [122, 150], control: [185, 172], to: [248, 150] };
export const BULBS = Array.from({ length: 7 }, (_, i) => {
  const t = 0.08 + (i / 6) * 0.84;
  const u = 1 - t;
  return {
    x: r1(u * u * WIRE.from[0] + 2 * u * t * WIRE.control[0] + t * t * WIRE.to[0]),
    y: r1(u * u * WIRE.from[1] + 2 * u * t * WIRE.control[1] + t * t * WIRE.to[1]),
    at: 0.9 + i * 0.015,
  };
});

// The crown: [x, y, rotation in degrees, scale], leaf outlines round the roof top
export const LEAVES = [
  [132, 86, -152, 1.5],
  [112, 112, -122, 1.3],
  [238, 84, -28, 1.5],
  [258, 110, 8, 1.3],
  [160, 60, -110, 1.4],
  [212, 58, -70, 1.4],
  [186, 46, -90, 1.2],
].map(([x, y, rotation, scale], i) => ({ x, y, rotation, scale, at: 0.78 + i * 0.03, dur: 0.22 }));

export const LINES = [
  // the ground, a few blades and two stones
  { d: "M12 380 C60 373 100 385 150 379 S250 372 348 381", tone: "main", w: 2.4, at: 0, dur: 0.38 },
  { d: "M44 378 L41 369 M51 377 L53 366 M58 378 L62 370 M292 378 L290 369 M299 378 L302 368 M306 379 L305 371", tone: "soft", w: 1.9, at: 0.12, dur: 0.3, double: false },
  { d: "M82 383 C84 379 92 379 94 383 C92 386 84 386 82 383 M318 384 C320 381 326 381 328 384", tone: "soft", w: 1.7, at: 0.2, dur: 0.25, double: false },

  // the trunk: two edges, the roots, bark, a knot, and shade down the right side
  { d: "M150 380 C152 336 145 288 151 238 C155 204 149 176 154 140 C156 112 152 90 156 72 C150 60 142 52 134 44", tone: "main", w: 2.8, at: 0.04, dur: 0.58 },
  { d: "M214 380 C212 338 220 290 214 240 C210 206 217 178 211 142 C209 114 214 92 210 74 C216 62 224 54 232 46", tone: "main", w: 2.8, at: 0.1, dur: 0.58 },
  { d: "M150 380 C140 382 130 385 116 384 M214 380 C224 383 236 386 252 384 M184 381 C180 384 172 387 164 388", tone: "soft", w: 2.1, at: 0.42, dur: 0.25, double: false },
  { d: "M170 340 C173 328 172 318 169 308 M193 312 C190 300 191 288 194 278 M176 262 C178 252 178 244 176 236", tone: "soft", w: 1.8, at: 0.5, dur: 0.3, double: false },
  { d: "M178 356 C173 353 173 345 178 342 C183 345 183 353 178 356", tone: "soft", w: 1.6, at: 0.58, dur: 0.18, double: false },
  { d: "M205 338 L211 329 M206 314 L212 305 M206 290 L212 281 M205 266 L211 258 M205 242 L210 235", tone: "soft", w: 1.6, at: 0.55, dur: 0.3, double: false },

  // the ladder
  { d: `M${RAIL_L[0][0]} ${RAIL_L[0][1]} L${RAIL_L[1][0]} ${RAIL_L[1][1]}`, tone: "main", w: 3, at: 0.15, dur: 0.46 },
  { d: `M${RAIL_R[0][0]} ${RAIL_R[0][1]} L${RAIL_R[1][0]} ${RAIL_R[1][1]}`, tone: "main", w: 3, at: 0.2, dur: 0.46 },
  ...RUNGS.map((rung) => ({ ...rung, tone: "main", w: 2.7, double: false })),

  // the deck and what holds it up, and a short railing at the right end
  { d: "M88 207 C140 204 220 209 280 205", tone: "main", w: 3, at: 0.5, dur: 0.22 },
  { d: "M94 214 C150 212 214 216 272 213", tone: "soft", w: 2, at: 0.56, dur: 0.2, double: false },
  { d: "M118 216 L148 240 M250 214 L222 240", tone: "soft", w: 2.2, at: 0.62, dur: 0.2, double: false },
  { d: "M256 205 V184 M268 205 V184 M252 184 L272 184", tone: "soft", w: 2.2, at: 0.66, dur: 0.2, double: false },

  // the house: walls, the boards, the porthole window (its fill is separate, see the Preloader)
  { cover: "house" },
  { d: "M122 205 C121 184 123 162 122 140 M248 140 C249 162 247 184 248 205", tone: "main", w: 3, at: 0.62, dur: 0.26 },
  { d: "M144 150 C145 170 143 190 144 205 M164 150 C163 172 165 190 164 205 M206 150 C207 170 205 188 206 205 M226 150 C225 172 227 190 226 205", tone: "soft", w: 1.6, at: 0.74, dur: 0.22, double: false },
  { cover: "window" },
  { d: "M185 167 A15 15 0 1 1 184.9 167 Z", tone: "main", w: 2.4, at: 0.84, dur: 0.2, double: false },
  { d: "M185 167 V197 M170 182 H200", tone: "soft", w: 1.7, at: 0.94, dur: 0.1, double: false },

  // the roof, drawn over the house
  { d: "M102 144 L144 113 L185 84 L227 115 L268 144", tone: "main", w: 3.2, at: 0.7, dur: 0.3 },
  { d: "M113 144 L150 119 L185 95 L222 120 L257 144", tone: "soft", w: 2, at: 0.78, dur: 0.24, double: false },

  // the wire the lights hang on, and the lantern's cord, cap and body
  { d: `M${WIRE.from[0]} ${WIRE.from[1]} Q${WIRE.control[0]} ${WIRE.control[1]} ${WIRE.to[0]} ${WIRE.to[1]}`, tone: "soft", w: 1.6, at: 0.82, dur: 0.22, double: false },
  { d: "M280 205 V218 M273 226 L280 218 L287 226 M273 226 H287 V246 H273 Z", tone: "main", w: 2.2, at: 0.86, dur: 0.2, double: false },
];

// The two covers (the { cover } entries in LINES, which fade in at the point of the drawing where they are listed): the house
// hides the trunk behind it, and the porthole hides the boards behind the glass.
// What is behind the house, so the trunk does not show through it
export const HOUSE_COVER = "M122 205 V140 L185 96 L248 140 V205 Z";
// The porthole's pane and the lantern's pane, which light when the page is ready
export const WINDOW = { cx: 185, cy: 182, r: 14.2 };
export const LANTERN = { x: 274, y: 227, w: 12, h: 18 };
export const GLOW = { cx: 185, cy: 182, r: 92 };
