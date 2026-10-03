// Pure maths for the approach trunks: the trunk list, the trunk body model (axis, radius, surface
// queries), vertex shading, and the clearance tests that keep foliage out of the walker's way and
// out of the line of sight to the treehouse. No canvas and no React: it can run under plain node.

import * as THREE from "three";
import { CAMERA, TREE, groundHeight } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { clamp, createNoise, smoothstep } from "@/lib/noise";
import {
  CLOSE_TRUNKS,
  EYE_HEIGHT,
  EYE_HEIGHT_END,
  GLIMPSES,
  MID_TRUNKS,
  TREEHOUSE_CENTER,
  atPath,
  pathAt,
  toPath,
} from "@/lib/sections/world";
import { CLOSE_SPECIES, MID_SPECIES_MIX, SPECIES, TRUNK_TUNING } from "./trunkTones";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ------------------------------------------------------------------------------------------------
// The walker. Mirrors src/lib/sections/approach.js (weaveLateral amplitude 0.4, eyeHeight). It is
// duplicated on purpose (approach.js imports the scene lazily, importing it here would be circular).
// If the camera author changes the weave or the eye height, change these constants too.
// ------------------------------------------------------------------------------------------------
const WEAVE_AMPLITUDE = 0.4;
const S_END = 0.94;

function eyeAt(s) {
  const rise = smoothstep(0, 0.14, s);
  const walking = CAMERA.position[1] + (EYE_HEIGHT - CAMERA.position[1]) * rise;
  return walking + (EYE_HEIGHT_END - EYE_HEIGHT) * smoothstep(0.45, S_END, s);
}

// The tube the camera moves in: 5 lateral lines (the weave is +-0.4 m) sampled every 0.01 of the path.
const CAMERA_TUBE = (() => {
  const pts = [];
  for (let i = 0; i <= 94; i++) {
    const s = i / 100;
    const eye = eyeAt(s);
    for (const lat of [-WEAVE_AMPLITUDE, -WEAVE_AMPLITUDE / 2, 0, WEAVE_AMPLITUDE / 2, WEAVE_AMPLITUDE]) {
      const p = atPath(s, lat);
      pts.push(new THREE.Vector3(p.x, p.y + eye, p.z));
    }
  }
  return pts;
})();
const _v = new THREE.Vector3();

// Smallest distance (m) from a world point to anywhere the camera can be.
export function cameraDistance(x, y, z) {
  _v.set(x, y, z);
  let best = Infinity;
  for (let i = 0; i < CAMERA_TUBE.length; i++) {
    const d = _v.distanceToSquared(CAMERA_TUBE[i]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ------------------------------------------------------------------------------------------------
// Line of sight to the treehouse. A leaf cluster or crown that would hide the cabin at a glimpse is
// rejected: the clear radius around each camera -> cabin segment grows with how much of the cabin
// that glimpse is meant to show.
// ------------------------------------------------------------------------------------------------
const SIGHT = GLIMPSES.map((g) => {
  const p = pathAt(g.s);
  return { a: new THREE.Vector3(p.x, p.y + eyeAt(g.s), p.z), clear: 0.9 + 2.2 * g.visible };
});
// The cabin and its deck, in world space, plus a margin (CABIN_BOX in Tree.jsx is tree-local).
const CABIN_BOX = new THREE.Box3(
  new THREE.Vector3(TREE.x - 2.2, 5.8, TREE.z - 1.9),
  new THREE.Vector3(TREE.x + 4.8, 13.4, TREE.z + 3.6),
);
const _seg = new THREE.Vector3();
const _ap = new THREE.Vector3();

function distToSegment(p, a, b) {
  _seg.subVectors(b, a);
  _ap.subVectors(p, a);
  const t = clamp(_ap.dot(_seg) / _seg.lengthSq(), 0, 1);
  _ap.addScaledVector(_seg, -t);
  return _ap.length();
}

// True when something of radius `pad` at (x, y, z) would hide the treehouse or sit inside it.
export function blocksCabin(x, y, z, pad = 0) {
  _v.set(x, y, z);
  if (CABIN_BOX.distanceToPoint(_v) < 1.2 + pad) return true;
  for (const s of SIGHT) {
    if (distToSegment(_v, s.a, TREEHOUSE_CENTER) < s.clear + pad) return true;
  }
  return false;
}

// 2D version for trunks (a trunk is a vertical line): horizontal distance to every sight line.
export function blocksCabinGround(x, z, pad = 0) {
  for (const s of SIGHT) {
    const ax = s.a.x;
    const az = s.a.z;
    const bx = TREEHOUSE_CENTER.x;
    const bz = TREEHOUSE_CENTER.z;
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 1.1 + pad) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------
// The trunk list: close, mid (near and far of the path) with species and the data the builders need.
// ------------------------------------------------------------------------------------------------
function assignMidSpecies(trunks) {
  const rng = createRng(4411);
  const total = Object.values(MID_SPECIES_MIX).reduce((a, b) => a + b, 0);
  const bag = [];
  for (const [id, n] of Object.entries(MID_SPECIES_MIX)) {
    for (let i = 0; i < Math.round((n * trunks.length) / total); i++) bag.push(id);
  }
  while (bag.length < trunks.length) bag.push("beech");
  bag.length = trunks.length;
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  // birch is a slim tree: swap it off any fat trunk
  for (let i = 0; i < bag.length; i++) {
    if (bag[i] !== "birch" || trunks[i].r <= 0.5) continue;
    const j = bag.findIndex((id, k) => id !== "birch" && trunks[k].r <= 0.5);
    if (j >= 0) [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function buildTrunkList() {
  const out = [];
  CLOSE_TRUNKS.forEach((c, i) => {
    const p = atPath(c.s, c.lateral);
    out.push({
      ...c,
      cls: "close",
      species: CLOSE_SPECIES[i % CLOSE_SPECIES.length],
      x: p.x,
      y: p.y,
      z: p.z,
    });
  });
  const speciesBag = assignMidSpecies(MID_TRUNKS);
  const rng = createRng(9091);
  const near = MID_TRUNKS.map((t, i) => (Math.abs(t.lateral) <= TRUNK_TUNING.midNearLateral ? i : -1)).filter((i) => i >= 0);
  // a few trunks not flagged ivy get a small patch too (the brief: "and a few more"): the thickest near ones
  const extra = near
    .filter((i) => !MID_TRUNKS[i].ivy && MID_TRUNKS[i].r >= 0.36)
    .sort((a, b) => MID_TRUNKS[b].r - MID_TRUNKS[a].r)
    .slice(0, TRUNK_TUNING.ivyExtraTrunks);
  MID_TRUNKS.forEach((t, i) => {
    const sp = speciesBag[i];
    // birch is white and slim: keep its height modest so it is not a 30 m pole
    out.push({
      ...t,
      cls: Math.abs(t.lateral) <= TRUNK_TUNING.midNearLateral ? "mid-near" : "mid-far",
      species: sp,
      ivy: t.ivy || extra.includes(i),
      ivyExtra: !t.ivy && extra.includes(i),
      // moss and lichen vary a lot from trunk to trunk: some are green sleeves, some are almost bare
      mossK: range(rng, 0.55, 1.35),
      lichenK: range(rng, 0.5, 1.4),
    });
  });
  // direction (radians from +X toward +Z) from each trunk to the nearest dirt: stubs, ivy and moss
  // favour the side the walker sees.
  for (const t of out) {
    const loc = toPath(t.x, t.z);
    const p = pathAt(loc.s);
    t.pathTheta = Math.atan2(p.z - t.z, p.x - t.x);
    t.pathDist = loc.dist;
    if (t.mossK === undefined) {
      t.mossK = range(rng, 0.7, 1.3);
      t.lichenK = range(rng, 0.7, 1.3);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// The trunk body
// ------------------------------------------------------------------------------------------------
// createTrunkModel(spec, radial) returns the analytic shape every builder (the tube, the stubs, the ivy,
// the crown limbs) queries, so they all agree:
//   centre(h)            axis point at height h above the trunk's ground (lean, then a gentle S curve)
//   radius(h, theta)     radius of the cross section: breast height radius r, taper, low frequency knobs,
//                        optional fluting, and the root flare with buttress lobes near the ground
//   pointAt(h, theta, o) world point on the surface. Near the ground the height follows the REAL ground
//                        under the vertex (groundHeight at that x, z) so a flare on a slope never floats
//   surface(h, theta)    { p, n, up } point, outward normal and the direction "up the bark"
// theta is the azimuth from +X toward +Z (the repo convention), so +Z (theta = 90 degrees) is NORTH, the
// mossy side that faces the walker.
export function createTrunkModel(spec, radial = 12) {
  const sp = SPECIES[spec.species];
  const rng = createRng(spec.seed * 7919 + 13);
  const noise = createNoise(spec.seed * 3 + 101);
  const y0 = groundHeight(spec.x, spec.z);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  const hTop = spec.cls === "close" ? 18 : 15;

  // axis: straight lean from the data plus a slow S. Both terms are zero at the ground.
  const A = sp.curve * range(rng, 0.6, 1.4);
  const f1 = range(rng, 0.2, 0.36);
  const f2 = f1 * range(rng, 2.1, 2.7);
  const sx = Math.sin(ph[0]);
  const sz = Math.sin(ph[2]);
  const sx2 = Math.sin(ph[1]);
  const sz2 = Math.sin(ph[3]);
  const centre = (h, out = new THREE.Vector3()) => {
    const hh = Math.max(h, 0);
    out.x = spec.x + spec.lean[0] * hh + A * (Math.sin(hh * f1 + ph[0]) - sx) + 0.35 * A * (Math.sin(hh * f2 + ph[1]) - sx2);
    out.z = spec.z + spec.lean[1] * hh + A * (Math.sin(hh * f1 * 0.93 + ph[2]) - sz) + 0.35 * A * (Math.sin(hh * f2 * 1.1 + ph[3]) - sz2);
    out.y = y0 + h;
    return out;
  };

  // buttress lobes: 4 to 6 around the foot, irregularly spaced, each its own width and strength
  const nB = 4 + Math.floor(rng() * 3);
  const base = rng() * TAU;
  const buttresses = [];
  for (let i = 0; i < nB; i++) {
    buttresses.push({
      az: base + (i * TAU) / nB + range(rng, -0.4, 0.4),
      w: range(rng, 0.28, 0.5),
      a: sp.buttress * range(rng, 0.35, 1.0),
    });
  }
  // fluting: at most about one lobe per 2.6 vertices round the ring, or it would alias into noise
  const lobeCount = Math.max(2, Math.min(sp.lobes.count, Math.floor(radial / 2.6)));
  const off = rng() * 10;

  const radius = (h, theta) => {
    const hh = Math.max(h, 0);
    const cx = Math.cos(theta);
    const sn = Math.sin(theta);
    // radius at breast height is r; it tapers by sp.taper over 22 m; closes in over the top 3 m
    let r = spec.r * (1.04 - sp.taper * Math.min(hh / 22, 1.2));
    r *= 1 - 0.35 * smoothstep(hTop - 3, hTop, h);
    // organic lumpiness: circle embedded noise (seamless round the trunk), one big and one small octave
    let k =
      1 +
      sp.knob * noise.simplex3(cx * 1.3 + off, sn * 1.3, h * 0.33) +
      0.35 * sp.knob * noise.simplex3(cx * 4 + 9, sn * 4, h * 1.1);
    k += sp.lobes.amp * Math.cos(lobeCount * theta + ph[0] + sp.lobes.twist * h) * (1 - 0.5 * smoothstep(6, 14, h));
    // root flare: a general widening plus the lobes that run out into roots, both dying with height
    let fl = sp.flare * Math.exp(-hh / 0.55);
    const e = Math.exp(-hh / 0.85);
    for (let i = 0; i < buttresses.length; i++) {
      const b = buttresses[i];
      const d = angDiff(theta, b.az) / b.w;
      fl += b.a * e * Math.exp(-d * d);
    }
    return r * (k + fl);
  };

  const _c = new THREE.Vector3();
  const pointAt = (h, theta, out = new THREE.Vector3()) => {
    centre(h, _c);
    const r = radius(h, theta);
    out.x = _c.x + r * Math.cos(theta);
    out.z = _c.z + r * Math.sin(theta);
    // follow the real ground at the foot: weight 1 underground, fading out by 1.2 m
    const w = h <= 0 ? 1 : 1 - smoothstep(0, 1.2, h);
    out.y = y0 + h + (w > 0 ? (groundHeight(out.x, out.z) - y0) * w : 0);
    return out;
  };

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const surface = (h, theta) => {
    const p = pointAt(h, theta, new THREE.Vector3());
    pointAt(h + 0.05, theta, _a);
    pointAt(h, theta + 0.02, _b);
    _a.sub(p); // up the bark
    _b.sub(p); // round the trunk
    const n = _p.crossVectors(_a, _b).normalize().clone();
    return { p, n, up: _a.clone().normalize() };
  };

  return {
    spec,
    sp,
    id: spec.id,
    x: spec.x,
    z: spec.z,
    y0,
    r: spec.r,
    hTop,
    centre,
    radius,
    pointAt,
    surface,
    mossK: spec.mossK ?? 1,
    lichenK: spec.lichenK ?? 1,
    valueK: range(rng, 0.88, 1.12), // overall brightness of this trunk's bark
    rng, // the model's own stream (builders draw stub and ivy choices from it, in a fixed order)
    noise,
  };
}

// ------------------------------------------------------------------------------------------------
// Vertex shading for bark: tint (vertex colour multiplier) and wear (attribute aWear for the shader).
//   wear.x moss   north side (+Z) and the foot, thick in crevices (the shader adds the crevice term)
//   wear.y lichen pale crust on the ridge tops, not near the ground
//   wear.z fresh wood (splintered ends), set by the stub builder only
//   wear.w damp   darkening at the foot (soil splash) and a little on the north flank
// ------------------------------------------------------------------------------------------------
export function shadeBark(model, h, nx, nz, outTint, outWear) {
  const sp = model.sp;
  const hh = Math.max(h, 0);
  const north = smoothstep(-0.3, 0.9, nz);
  const foot = Math.exp(-hh / 0.9);
  const moss = clamp(
    model.mossK * sp.moss * ((0.1 + 0.72 * north) * (0.35 + 0.65 * Math.exp(-hh / 7)) + 0.6 * foot),
    0,
    1,
  );
  const lichenNoise = 0.5 + 0.5 * model.noise.simplex3(nx * 2.3 + 5, nz * 2.3, h * 0.45);
  const lichen = clamp(model.lichenK * sp.lichen * (0.35 + 0.65 * lichenNoise) * smoothstep(0.4, 2, h), 0, 1);
  const damp = clamp(0.55 * Math.exp(-hh / 0.5) + 0.12 * north, 0, 1);
  // sunlit (south, -Z) flank is drier and warmer, the north flank cooler and darker
  const sunK = smoothstep(0.2, -0.8, nz);
  const T = TRUNK_TUNING;
  const dry = smoothstep(2.5, 14, h);
  let r = (1 - sunK) * T.shadeTint[0] + sunK * T.sunTint[0];
  let g = (1 - sunK) * T.shadeTint[1] + sunK * T.sunTint[1];
  let b = (1 - sunK) * T.shadeTint[2] + sunK * T.sunTint[2];
  const lift = 1 + 0.1 * dry;
  r *= lift;
  g *= lift;
  b *= lift;
  if (sp.darkBase) {
    // old birch: black fissured bark for the first metre or so
    const k = 0.42 + 0.58 * smoothstep(0.15, 1.7, h);
    r *= k;
    g *= k;
    b *= k;
  }
  const v = model.valueK;
  outTint[0] = r * v * sp.tint[0];
  outTint[1] = g * v * sp.tint[1];
  outTint[2] = b * v * sp.tint[2];
  outWear[0] = moss;
  outWear[1] = lichen;
  outWear[2] = 0;
  outWear[3] = damp;
}
