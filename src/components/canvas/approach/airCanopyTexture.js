import * as THREE from "three";
import { createNoise, smoothstep } from "@/lib/noise";
import { createRng, range } from "@/lib/random";

// The alpha mask of the shadow only canopy cards.
//
// Why not the hero leaf cards? createLeafCardTexture paints a single twig with 8 to 14 leaves per card, which
// is only 10 to 20 percent opaque. To shade about half of the path with those, the canopy would need three
// times as many cards, and each leaf would have to be 40 to 60 cm long to fill the gaps. Dapples in a real
// wood come from MANY SMALL leaves layered into a mass with irregular holes, so this file paints exactly that:
// a leaf mat, 55 to 65 percent opaque, leaves 12 to 17 percent of the card long (about 25 to 45 cm on a 2.5 m
// card, softened by the shadow penumbra to a natural dapple), grouped on radiating twigs so the holes are
// clumped rather than uniform. Only the ALPHA matters (the card never renders colour), so the RGB is a flat
// leaf green (it is never seen).
//
// Pure typed array code (no canvas): it runs in node for tuning and costs about 4 ms at 256 px.

const TAU = Math.PI * 2;

// Returns the alpha as a Uint8Array (size * size, row 0 = v 0) and its coverage in 0..1.
// Leaves are dart thrown (no two centres closer than `spacing`) with an acceptance rate driven by a smooth
// density field (so the mat has dense clumps and open holes), then painted as pointed, lobed ellipses.
export function paintLeafMat({ seed = 1, size = 256, leaves = 190, spacing = 0.04, leafLen = [0.1, 0.15], holes = 0.5 } = {}) {
  const rng = createRng(seed * 7121 + 17);
  const noise = createNoise(seed * 31 + 5);
  const a = new Float32Array(size * size);
  const items = [];
  let guard = 0;
  while (items.length < leaves && guard++ < leaves * 60) {
    const x = range(rng, 0.07, 0.93);
    const y = range(rng, 0.07, 0.93);
    // Density: low frequency fbm picks clumps (1 at the peaks) and a soft window thins the card toward its edge.
    const d = noise.fbm2(x * 3.2, y * 3.2, 2, 0, 0, 0.5) * 0.5 + 0.5;
    const edge = Math.min(1, Math.min(x, 1 - x, y, 1 - y) / 0.2);
    if (rng() > smoothstep(holes - 0.18, holes + 0.2, d) * edge) continue;
    if (items.some((o) => (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y) < spacing * spacing)) continue;
    items.push({ x, y, ang: rng() * TAU, len: range(rng, leafLen[0], leafLen[1]) });
  }
  for (const it of items) {
    const half = it.len * 0.5 * size;
    const halfW = half * range(rng, 0.5, 0.62);
    const lobes = 4 + Math.floor(rng() * 3);
    const lobePhase = rng() * TAU;
    const cx = it.x * size;
    const cy = it.y * size;
    const c = Math.cos(it.ang);
    const s = Math.sin(it.ang);
    const r = Math.ceil(half * 1.15) + 1;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const lx = dx * c + dy * s; // along the leaf
        const ly = -dx * s + dy * c; // across the leaf
        // Pointed ellipse with shallow lobes (an oak leaf margin): radius modulated by the angle.
        const th = Math.atan2(ly, lx);
        const lobe = 1 + 0.1 * Math.sin(lobes * th + lobePhase);
        const taper = 1 - 0.35 * Math.max(0, lx / half); // narrower toward the tip
        const q = (lx * lx) / (half * half * lobe * lobe) + (ly * ly) / (halfW * halfW * taper * taper * lobe * lobe);
        if (q <= 1) a[y * size + x] = 1;
      }
    }
  }
  const out = new Uint8Array(size * size);
  let cover = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] > 0 ? 255 : 0;
    cover += a[i];
  }
  return { alpha: out, coverage: cover / out.length };
}

// A DataTexture whose alpha is the leaf mat (RGB is a flat green, never visible). No mipmaps: the card is seen
// by the shadow camera at about 1:1 (a 256 px card of 2.5 m is 10 mm per texel against a 7 mm shadow texel),
// and averaged mip alpha would shift the alphaTest 0.5 coverage. Linear filtering softens the leaf edges.
export function makeLeafMatTexture(options) {
  const size = options?.size ?? 256;
  const { alpha, coverage } = paintLeafMat(options);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < alpha.length; i++) {
    data[i * 4] = 70;
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 55;
    data[i * 4 + 3] = alpha[i];
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.userData.coverage = coverage;
  return tex;
}
