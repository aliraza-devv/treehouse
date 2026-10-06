import { createRng, range } from "@/lib/random";

// Procedural SVG shapes for the canopy transition, the vine leaves and the award laurels. Everything is seeded and
// every coordinate is formatted to 0.1, so the server render and the client agree (no hydration mismatch: Math.sin and
// Math.cos differ in the last digit between Node and the browser).

// A canopy edge in a 1440 x 420 box: a run of rounded leaf-clump domes of varying width and height along a slowly
// rolling base line, closed along the bottom. `top` is the base line as a fraction of the height, `bump` the tallest
// dome, `wave` how far the base line rolls. A dome's peak is y - hp because a cubic with both controls at y - 1.33 hp
// peaks at 0.75 of that. It is ONE path, so a gradient fill runs across all domes without overlap seams.
export function canopyPath(seed, { width = 1440, height = 420, top = 0.38, bump = 0.24, wave = 0.05, min = 70, max = 170 } = {}) {
  const rng = createRng(seed);
  const phase = rng() * Math.PI * 2;
  const baseY = (x) => height * (top + wave * Math.sin(x / 260 + phase) + wave * 0.5 * Math.sin(x / 90 + phase * 2));
  let x = -60;
  let d = `M${x},${height} L${x},${baseY(x).toFixed(1)}`;
  while (x < width + 60) {
    const w = range(rng, min, max);
    const hp = height * range(rng, bump * 0.4, bump);
    const x1 = x + w;
    const y0 = baseY(x);
    const y1 = baseY(x1);
    const a = range(rng, 0, 0.18); // lean of the dome: how far in each control point sits
    const b = range(rng, 0, 0.18);
    d += ` C${(x + w * a).toFixed(1)},${(y0 - hp * 1.33).toFixed(1)} ${(x1 - w * b).toFixed(1)},${(y1 - hp * 1.33).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    x = x1;
  }
  return `${d} L${x.toFixed(1)},${height} Z`;
}

// One simple leaf outline, about 26 x 12, with its stem at the left (0, 6) and its tip at the right.
export const LEAF_PATH = "M0 6 C6 -2 18 -2 26 6 C18 14 6 14 0 6 Z";
