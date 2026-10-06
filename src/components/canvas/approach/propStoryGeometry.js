// Geometry for the three story props (StoryProps.jsx): a child's wellington boot, a cut stump with a coil of
// hemp rope on it, and a small hand painted arrow nailed to a tree. Pure maths, no canvas: runs under node.
//
// Every prop is placed from the world contract (STORY_PROPS, STUMP, CLOSE_TRUNKS in world.js) and from the
// REAL trunk shapes: the boot and the arrow query createTrunkModel (trunkMath.js) with the same spec and radial
// count the Trunks component builds from, so the board hugs the actual bark and the boot sits clear of the
// actual root flare. If the trunk author changes those, only the constants named in the tuning tables below
// ever need a nudge.

import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { createNoise } from "@/lib/noise";
import { STORY_PROPS, STUMP, atPath } from "@/lib/sections/world";
import { buildTrunkList, createTrunkModel } from "./trunkMath";
import { dirtEdge, locate, rideHeight } from "./pathMath";
import { buildRoots, rootDistance } from "./pathLayout";
import { createBuilder, DEG, TAU, clamp, smoothstep, hash1 } from "./propKit";
import { STORY_TEX } from "./propStoryTextures";
import { TONES, linearOf, mixBytes, scaleBytes } from "./propTones";

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const BOOT = {
  // Where round the trunk the boot lies: an angle off the direction of the dirt (degrees), searched from the
  // smallest that keeps the boot off the worn path, on the side the walker approaches from.
  angleSearchDeg: [45, 140],
  clearance: 0.2, // metres of ground between the trunk's root flare and the boot's centre
  offDirt: -0.04, // dirtEdge the foot and near shaft must stay under (negative: off the worn dirt)
  mouthOnDirt: 0.2, // the mouth end may lie this far onto the ragged dirt fringe (a boot dropped at the trail's edge)
  rootTouch: -0.04, // how far a buttress root of the path author's may overlap the boot's footprint (litter hides it)
  restTiltDeg: -7, // the shaft rests a little raised (on a root or a drift of leaves)
  sinkM: 0.006, // how far it settles into the litter
  segs: 10,
};
export const STUMP_LOOK = {
  segs: 12,
  turns: 6, // coils of rope on the stump (the brief asks for 6 to 9)
  segsPerTurn: 11,
  ropeRadius: 0.0112,
  pitch: 0.019, // how much each coil rises over the last
  coilRadius: 0.142,
};
export const ARROW = {
  length: 0.36,
  height: 0.124,
  thickness: 0.018,
  azimuthOffsetDeg: 0, // turn the board round the trunk (if the ivy ever hides it, nudge this)
  sightSBefore: 0.07, // the board faces the walker as it is at this path fraction BEFORE the tree
  proud: 0.014, // how far the painted face stands off the bark
  swallow: 0.03, // how much deeper one corner is pushed into the bark (it is being swallowed)
  cols: 7,
};

const _spec = {};
function trunkSpec(id) {
  if (!_spec[id]) _spec[id] = buildTrunkList().find((t) => t.id === id);
  return _spec[id];
}
// The same model the Trunks component builds the tube from (close trunks use radial 20).
function trunkModel(id) {
  const spec = trunkSpec(id);
  return { spec, model: createTrunkModel(spec, 20) };
}

// ------------------------------------------------------------------------------------------------
// THE BOOT
// ------------------------------------------------------------------------------------------------
// Upright boot (child's size, foot 21 cm, 27 cm tall): +X toe, +Y up, the leg above the heel. Rings of horizontal
// slices, bottom to top, then in over the rolled lip and down into the dark leg.
//   y, xHeel, xToe, halfWidth, squareness (1 ellipse, below 1 squarer)
const BOOT_RINGS = [
  [0.0, -0.074, 0.136, 0.041, 0.7], // the flat sole
  [0.013, -0.077, 0.14, 0.044, 0.7], // the welt: a lip of rubber a little wider than the sole
  [0.04, -0.073, 0.134, 0.042, 0.82],
  [0.06, -0.07, 0.112, 0.041, 0.92], // the toe cap rolls in
  [0.088, -0.066, 0.07, 0.041, 0.97],
  [0.14, -0.062, 0.04, 0.043, 1.0], // the ankle, the leg begins
  [0.215, -0.06, 0.036, 0.046, 1.0],
  [0.262, -0.063, 0.04, 0.052, 1.0], // the mouth
];

function bootRingPoints(spec, segs, scale = 1, yShift = 0, jitter = null) {
  const [y, xh, xt, hw, e] = spec;
  const cx = (xh + xt) / 2;
  const rx = ((xt - xh) / 2) * scale;
  const rz = hw * scale;
  const pts = [];
  for (let j = 0; j < segs; j++) {
    const th = (j / segs) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    // superellipse: |c|^(2/n) keeps corners where n > 2 and flats where n < 2; with e < 1 it is squarer
    const px = Math.sign(c) * Math.pow(Math.abs(c), e);
    const pz = Math.sign(s) * Math.pow(Math.abs(s), e);
    const k = jitter ? 1 + jitter(j, y) : 1;
    pts.push([cx + px * rx * k, y + yShift, pz * rz * k]);
  }
  return pts;
}

// The path author's buttress roots at the foot of the close trunks (pathLayout.js), as segments, so the boot can keep
// off them. If that module ever changes shape the boot simply ignores the roots.
let _rootSegs = null;
function flareRootSegments() {
  if (_rootSegs) return _rootSegs;
  _rootSegs = [];
  try {
    for (const root of buildRoots().flares) {
      for (let i = 0; i < root.rings.length - 1; i++) {
        const a = root.rings[i];
        const b = root.rings[i + 1];
        _rootSegs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, wa: a.w, wb: b.w });
      }
    }
  } catch {
    _rootSegs = [];
  }
  return _rootSegs;
}
const rootClear = (x, z) => (flareRootSegments().length ? rootDistance(flareRootSegments(), x, z) : 1);

// The dirt side of the world: find a spot beside the trunk, off the worn path and off the roots, on the walker's
// approaching flank. The boot is a footprint of toe axis -0.08..+0.14 and mouth axis 0..0.27 metres from its origin;
// every sample of it must be clear.
function bootPlacement() {
  const { spec, model } = trunkModel(STORY_PROPS.boot.trunkId);
  const pathDir = spec.pathTheta; // from the trunk toward the nearest dirt
  const walk = atPath(spec.s, 0); // the walking direction at the trunk
  const back = [-walk.tx, -walk.tz];
  const dirOf = (a) => [Math.cos(a), Math.sin(a)];
  // the mouth points toward the path, turned back toward the oncoming walker by yawDeg (the data)
  const yaw = STORY_PROPS.boot.yawDeg * DEG;
  const sgnMouth = (() => {
    const a = dirOf(pathDir + yaw);
    const b = dirOf(pathDir - yaw);
    return a[0] * back[0] + a[1] * back[1] > b[0] * back[0] + b[1] * back[1] ? 1 : -1;
  })();
  const mouth = dirOf(pathDir + sgnMouth * yaw);
  const toe = [mouth[1], -mouth[0]]; // after the roll the toe lies 90 degrees from the mouth (see buildBoot)
  const footprint = [];
  for (const a of [-0.08, 0.03, 0.14]) for (const m of [0.0, 0.09, 0.18, 0.27]) footprint.push([a, m]);
  let best = null;
  for (const side of [1, -1]) {
    for (let a = BOOT.angleSearchDeg[0]; a <= BOOT.angleSearchDeg[1]; a += 3) {
      const th = pathDir + side * a * DEG;
      const R = model.radius(0.05, th);
      const d = R + BOOT.clearance;
      const px = spec.x + Math.cos(th) * d;
      const pz = spec.z + Math.sin(th) * d;
      let over = -1e9; // how far the footprint overshoots what it is allowed to cover of the dirt
      let edge = -1e9;
      let root = 1e9;
      let trunk = 1e9;
      for (const [fa, fm] of footprint) {
        const x = px + toe[0] * fa + mouth[0] * fm;
        const z = pz + toe[1] * fa + mouth[1] * fm;
        const l = locate(x, z);
        const e = dirtEdge(l.s, l.lateral);
        edge = Math.max(edge, e);
        // the foot and the near shaft must be off the dirt; the mouth may reach a hand's breadth onto the ragged fringe
        over = Math.max(over, e - (fm <= 0.1 ? BOOT.offDirt : BOOT.mouthOnDirt));
        root = Math.min(root, rootClear(x, z));
        const ang = Math.atan2(z - spec.z, x - spec.x);
        trunk = Math.min(trunk, Math.hypot(x - spec.x, z - spec.z) - model.radius(0.05, ang));
      }
      if (over > 0 || root < BOOT.rootTouch || trunk < 0.03) continue;
      // prefer the flank the walker meets first (its side faces the oncoming walker), then the smaller angle
      const facing = Math.cos(th) * back[0] + Math.sin(th) * back[1];
      const score = a * 0.01 - facing * 0.6 - 0.2 * Math.min(1, root);
      if (!best || score < best.score) best = { px, pz, th, score, edge, root };
    }
  }
  if (!best) {
    // nothing is clear: fall back to the far side of the trunk from the dirt
    const th = pathDir + Math.PI;
    const d = model.radius(0.05, th) + BOOT.clearance;
    best = { px: spec.x + Math.cos(th) * d, pz: spec.z + Math.sin(th) * d, th, score: 0, edge: -1, root: 1 };
  }
  return { ...best, mouth, spec, model };
}

// Returns { rubber, extras, tris, placement } where rubber is one geometry (groups: 0 rubber, 1 sole, 2 yarn)
// already in WORLD space, and extras are { moss, litter } world space geometries.
export function buildBoot() {
  const pl = bootPlacement();
  const rng = createRng(70621);
  const noise = createNoise(7061);
  const SEG = BOOT.segs;
  const b = createBuilder();

  const rubber = linearOf(TONES.rubberGreen);
  const sole = linearOf(TONES.rubberSole);
  const mud = linearOf(TONES.soilWet);
  const mossC = linearOf(TONES.moss);
  const jit = (j, y) => 0.012 * noise.perlin2(j * 1.7, y * 9) + (y < 0.02 ? 0.008 * (hash1(j, 3) - 0.5) : 0);
  // ---- the outside, the lip and the dark inside of the leg, one loft -----------------------------------------------------
  const rings = BOOT_RINGS.map((r) => bootRingPoints(r, SEG, 1, 0, jit));
  const mouth = BOOT_RINGS[BOOT_RINGS.length - 1];
  rings.push(bootRingPoints(mouth, SEG, 0.9, 0.006, jit)); // the rolled lip, folded inward and a little up
  rings.push(bootRingPoints([0.236, mouth[1], mouth[2], mouth[3], 1], SEG, 0.86, 0, jit)); // the inside, going down
  rings.push(bootRingPoints([0.19, mouth[1], mouth[2], mouth[3], 1], SEG, 0.78, 0, jit));
  const nOutside = BOOT_RINGS.length;
  b.loft(rings, {
    group: 0,
    uv: (i, j) => [j / SEG, i / rings.length],
    color: (i, j) => {
      const y = i < nOutside ? BOOT_RINGS[i][0] : 0.26 - (i - nOutside) * 0.03;
      const th = (j / SEG) * TAU;
      const sideZ = Math.sin(th); // +Z is the side that ends up on the ground
      // rubber with a worn, lighter, scuffed look on the toe cap and the heel, a dull bloom elsewhere
      const scuff = clamp(0.5 + 0.9 * noise.perlin2(j * 0.9 + i * 1.3, y * 11)) * (0.7 + 0.3 * Math.cos(th));
      let k = 0.9 + 0.22 * scuff * smoothstep(0.0, 0.1, 0.1 - Math.abs(y - 0.06) * 0.5 + 0.02);
      if (i >= nOutside) k *= 0.12; // the inside of the leg is nearly black
      let c = [rubber[0] * k, rubber[1] * k, rubber[2] * k];
      // rubber welt and sole edge are darker
      if (i <= 1) c = [sole[0] * 1.25, sole[1] * 1.25, sole[2] * 1.25];
      // mud splashed up from the sole, heavier on the ground side
      const mudK = clamp((1 - smoothstep(0.0, 0.07, y)) * (0.55 + 0.45 * sideZ) + 0.25 * (1 - smoothstep(0.0, 0.2, y)) * noise.perlin2(j, y * 8));
      if (i < nOutside) c = [c[0] + (mud[0] * 1.3 - c[0]) * mudK, c[1] + (mud[1] * 1.3 - c[1]) * mudK, c[2] + (mud[2] * 1.3 - c[2]) * mudK];
      // a dusting of green: algae on the side that faces the sky (-Z)
      const green = i < nOutside ? clamp(-sideZ * 0.5 + 0.1) * smoothstep(0.03, 0.2, y) * 0.5 : 0;
      return [c[0] + (mossC[0] * 1.4 - c[0]) * green, c[1] + (mossC[1] * 1.6 - c[1]) * green, c[2] + (mossC[2] * 1.2 - c[2]) * green];
    },
  });
  // ---- the sole plate (group 1, its own tread texture): a fan under the first ring -------------------------------------------
  {
    const ring0 = rings[0];
    const cx = (BOOT_RINGS[0][1] + BOOT_RINGS[0][2]) / 2;
    const [mW, mH] = STORY_TEX.soleSquareM;
    const uvOf = (p) => [(p[2] + mW / 2) / mW, (p[0] - (cx - mH / 2)) / mH];
    const c0 = b.vert([cx, -0.0005, 0], [0, -1, 0], 0.5, 0.5, [1, 1, 1]);
    const ids = ring0.map((p) => {
      const t = uvOf(p);
      return b.vert([p[0], -0.0005, p[2]], [0, -1, 0], t[0], t[1], [1, 1, 1]);
    });
    for (let j = 0; j < SEG; j++) b.triHint(c0, ids[j], ids[(j + 1) % SEG], [0, -1, 0], 1);
  }
  // ---- a loop of sock yarn caught in the mouth and hanging over the lip ---------------------------------------------------------
  const yarn = linearOf(TONES.sock);
  b.tube(
    [
      [-0.012, 0.19, 0.012],
      [-0.016, 0.25, 0.018],
      [-0.006, 0.282, 0.034],
      [0.016, 0.276, 0.056],
      [0.03, 0.244, 0.062],
    ],
    [0.0105, 0.0105, 0.0105, 0.0098, 0.009],
    4,
    { group: 2, color: yarn, vPerM: 30, capEnd: true },
  );
  const geo = b.toGeometry();

  // ---- the world transform: roll the boot onto its side, mouth along +Z, then yaw it to point at the path -------------------------
  // Rx(90 + tilt): local +Y (the leg) -> +Z, local +Z (the side) -> -Y (down onto the ground).
  const m = new THREE.Matrix4();
  const yawA = Math.atan2(pl.mouth[0], pl.mouth[1]); // Ry maps +Z to (sin, cos) in (x, z)
  const roll = new THREE.Matrix4().makeRotationX((90 + BOOT.restTiltDeg) * DEG);
  const toeTurn = new THREE.Matrix4().makeRotationY(0);
  m.makeRotationY(yawA).multiply(roll).multiply(toeTurn);
  geo.applyMatrix4(m);
  // settle: the lowest point rests in the litter at the ground under the boot's middle
  geo.computeBoundingBox();
  const g = rideHeight(pl.px, pl.pz);
  const lift = g - BOOT.sinkM - geo.boundingBox.min.y;
  geo.translate(pl.px, lift, pl.pz);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  // ---- the leaf litter and the moss, in world space, on the boot's upward facing skin -------------------------------------------------
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const ups = [];
  for (let i = 0; i < pos.count; i++) if (nor.getY(i) > 0.6 && pos.getY(i) > g + 0.02) ups.push(i);
  const pickUp = (k) => ups[Math.floor(hash1(k, 91) * ups.length) % Math.max(1, ups.length)];
  const mossB = createBuilder();
  const litB = createBuilder();
  const litter = [TONES.litter, mixBytes(TONES.litter, TONES.rust, 0.5), scaleBytes(TONES.litter, 0.7)];
  // moss cushion on the heel side of the leg, where the damp collects
  if (ups.length) {
    const i = pickUp(2);
    const c = [pos.getX(i), pos.getY(i) - 0.004, pos.getZ(i)];
    mossB.blob(c, [0.05, 0.022, 0.04], 2, 7, (dx, dy, dz) => 1 + 0.25 * noise.perlin2(dx * 3 + 7, dz * 3), {
      phiEnd: Math.PI / 2,
      color: [0.9 + mossC[0], 0.95 + mossC[1], 0.85 + mossC[2]],
      uv: (ri, j) => [Math.cos((j / 7) * TAU) * 0.3 * (ri / 2 + 0.3) + c[0] * 2, Math.sin((j / 7) * TAU) * 0.3 * (ri / 2 + 0.3) + c[2] * 2],
    });
  }
  // leaves: two lying on the boot, two on the ground beside it. A leaf is a kite with a midrib bend: 4 triangles.
  const leaf = (c, n, ang, size, col) => {
    const up = new THREE.Vector3(n[0], n[1], n[2]).normalize();
    const ax = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    ax.addScaledVector(up, -ax.dot(up)).normalize();
    const sd = new THREE.Vector3().crossVectors(up, ax).normalize();
    const P = (a, s, lift) => [c[0] + ax.x * a + sd.x * s + up.x * lift, c[1] + ax.y * a + sd.y * s + up.y * lift, c[2] + ax.z * a + sd.z * s + up.z * lift];
    const L = size;
    const W = size * 0.42;
    const base = litB.vert(P(-L * 0.5, 0, 0), [up.x, up.y, up.z], 0, 0, col);
    const lm = litB.vert(P(-L * 0.05, -W, 0.004), [up.x, up.y, up.z], 0, 0, col);
    const rm = litB.vert(P(-L * 0.05, W, 0.004), [up.x, up.y, up.z], 0, 0, col);
    const mid = litB.vert(P(L * 0.12, 0, 0.007), [up.x, up.y, up.z], 0, 0, col.map((v) => v * 1.12));
    const tip = litB.vert(P(L * 0.5, 0, 0.001), [up.x, up.y, up.z], 0, 0, col);
    litB.triHint(base, lm, mid, up.toArray(), 0);
    litB.triHint(base, mid, rm, up.toArray(), 0);
    litB.triHint(lm, tip, mid, up.toArray(), 0);
    litB.triHint(mid, tip, rm, up.toArray(), 0);
  };
  const lc = (k) => linearOf(litter[k % litter.length]);
  if (ups.length) {
    for (let k = 0; k < 2; k++) {
      const i = pickUp(10 + k * 5);
      leaf([pos.getX(i), pos.getY(i) + 0.003, pos.getZ(i)], [nor.getX(i), nor.getY(i), nor.getZ(i)], rng() * TAU, range(rng, 0.075, 0.1), lc(k));
    }
  }
  for (let k = 0; k < 2; k++) {
    const a = rng() * TAU;
    const d = range(rng, 0.14, 0.26);
    const x = pl.px + Math.cos(a) * d;
    const z = pl.pz + Math.sin(a) * d;
    leaf([x, rideHeight(x, z) + 0.004, z], [0.05 * (rng() - 0.5), 1, 0.05 * (rng() - 0.5)], rng() * TAU, range(rng, 0.08, 0.11), lc(k + 1));
  }
  const mossG = mossB.toGeometry();
  const litG = litB.toGeometry();
  return {
    geometry: geo,
    moss: mossG,
    litter: litG,
    tris: { boot: b.triangles, moss: mossB.triangles, litter: litB.triangles },
    placement: { x: pl.px, z: pl.pz, y: g, trunk: pl.spec.id, mouth: pl.mouth },
  };
}

// ------------------------------------------------------------------------------------------------
// THE STUMP AND ITS COIL OF ROPE
// ------------------------------------------------------------------------------------------------
export function buildStump() {
  const p = atPath(STUMP.s, STUMP.lateral);
  const cx = p.x;
  const cz = p.z;
  const rng = createRng(40411);
  const noise = createNoise(4041);
  const SEG = STUMP_LOOK.segs;
  const R0 = STUMP.r;
  const H = STUMP.h;
  const gC = rideHeight(cx, cz);
  const yTop = gC + H;

  // buttress lobes at the foot (an oak stump keeps its root flare), a lumpy trunk above
  const lobes = [];
  const nL = 4;
  const ph = rng() * TAU;
  for (let i = 0; i < nL; i++) lobes.push({ a: ph + (i / nL) * TAU + range(rng, -0.4, 0.4), w: range(rng, 0.3, 0.5), amp: range(rng, 0.18, 0.4) });
  const angD = (a, b2) => {
    let d = (a - b2) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  // radius at height y above the stump's own ground and azimuth th
  const radius = (y, th) => {
    let r = R0 * (1 + 0.3 * Math.exp(-Math.max(0, y) / 0.1)); // flare
    for (const l of lobes) {
      const d = angD(th, l.a) / l.w;
      r += R0 * l.amp * Math.exp(-Math.max(0, y) / 0.2) * Math.exp(-d * d);
    }
    r *= 1 + 0.06 * noise.perlin2(Math.cos(th) * 1.5 + 5, Math.sin(th) * 1.5 + y * 2) + 0.025 * noise.perlin2(th * 5, y * 6);
    r *= 1 - 0.05 * smoothstep(H - 0.12, H, y); // weathered, rounded cut edge
    return r;
  };
  const yRel = [-0.07, 0.0, 0.1, 0.25, 0.42, H - 0.018, H];
  const rings = yRel.map((yr) => {
    const t = smoothstep(0.1, 0.6, yr / H);
    const ring = [];
    for (let j = 0; j < SEG; j++) {
      const th = (j / SEG) * TAU + 0.01;
      const r = radius(yr, th);
      const x = cx + Math.cos(th) * r;
      const z = cz + Math.sin(th) * r;
      // base rings follow the slope under each vertex; the cut top is level
      const yv = (1 - t) * (rideHeight(x, z) + yr) + t * (gC + yr);
      ring.push([x, yv, z]);
    }
    return ring;
  });
  const b = createBuilder();
  const mossC = linearOf(TONES.moss);
  const circ = TAU * R0;
  const shade = rng() * TAU; // the damp, mossy side
  b.loft(rings, {
    group: 0,
    uv: (i, j) => [j / SEG, (yRel[i] + 0.2) / circ],
    color: (i, j) => {
      const th = (j / SEG) * TAU;
      const y = yRel[i];
      const side = 0.5 + 0.5 * Math.cos(th - shade);
      const foot = 1 - smoothstep(0.0, 0.3, y);
      const mossK = clamp((0.15 + 0.8 * side) * (0.25 + 0.75 * foot) + 0.2 * foot) * (0.5 + 0.5 * (noise.perlin2(j * 0.9, y * 5) * 0.5 + 0.5));
      // weathered bark: warm brown, bare grey sapwood where it has slipped, a dark foot
      const peel = smoothstep(0.55, 0.8, noise.perlin2(j * 0.7 + 4, y * 7)) * 0.4;
      // a multiplier on the bark texture (like the hero trunk's tint): damp and dark at the foot, paler where the bark
      // has slipped, and a green multiplier (less red and blue) where moss grows
      const k = (0.95 + 0.4 * peel) * (1 - 0.4 * foot);
      const m = mossK * 0.75;
      return [k * (1 - 0.22 * m), k * (1 + 0.5 * m), k * (1 - 0.28 * m)];
    },
  });
  // ---- the sawn top: a fan, with the ring texture mapped from the disc's bounding square -------------------------------------------
  const topRing = rings[rings.length - 1];
  const sq = STORY_TEX.stumpSquareM;
  const dish = -0.008; // the top is a touch dished where water has stood
  const c0 = b.vert([cx, yTop + dish, cz], [0, 1, 0], 0.5, 0.5, [1, 1, 1]);
  const topIds = topRing.map((q) => b.vert([q[0], q[1], q[2]], [0, 1, 0], 0.5 + (q[0] - cx) / sq, 0.5 - (q[2] - cz) / sq, [1, 1, 1]));
  for (let j = 0; j < SEG; j++) b.triHint(c0, topIds[j], topIds[(j + 1) % SEG], [0, 1, 0], 1);

  // ---- two shelves of bracket fungus on the shaded flank, flattened half discs ------------------------------------------------------
  const fungus = linearOf(TONES.fungus);
  const fungusP = linearOf(TONES.fungusPale);
  for (let k = 0; k < 2; k++) {
    const th = shade + (k === 0 ? 0.25 : -0.5);
    const y = k === 0 ? 0.3 : 0.18;
    const r = radius(y, th);
    const sx = cx + Math.cos(th) * (r - 0.012);
    const sz = cz + Math.sin(th) * (r - 0.012);
    const sy = (rideHeight(sx, sz)) + y;
    const size = k === 0 ? 0.075 : 0.055;
    b.blob([sx, sy, sz], [size, size * 0.3, size * 0.8], 2, 7, (dx, dy, dz) => 1 + 0.15 * noise.perlin2(dx * 3 + k * 9, dz * 3), {
      group: 3,
      phiEnd: Math.PI / 2,
      color: (i) => (i === 2 ? fungusP : fungus), // the pale rim, the warmer top
    });
  }
  // ---- moss cushions on the top rim, shaded side (group 2 uses the hero moss texture) --------------------------------------------------
  for (let k = 0; k < 2; k++) {
    const th = shade + (k === 0 ? 0.15 : -0.55);
    const rr = radius(H, th) * (k === 0 ? 0.82 : 0.9);
    const mx = cx + Math.cos(th) * rr;
    const mz = cz + Math.sin(th) * rr;
    b.blob([mx, yTop - 0.004, mz], [0.085, 0.032, 0.07], 2, 7, (dx, dy, dz) => 1 + 0.3 * noise.perlin2(dx * 3 + 21 + k, dz * 3), {
      group: 2,
      phiEnd: Math.PI / 2,
      color: [0.95 + mossC[0] * 0.8, 1.0 + mossC[1] * 0.8, 0.9 + mossC[2] * 0.8],
      uv: (ri, j) => [Math.cos((j / 7) * TAU) * 0.35 * (ri / 2 + 0.3) + mx * 2, Math.sin((j / 7) * TAU) * 0.35 * (ri / 2 + 0.3) + mz * 2],
    });
  }
  // ---- new shoots: two slim epicormic stems with a few small leaves, growing from the flank --------------------------------------------
  const stem = linearOf(mixBytes(TONES.oakLate, TONES.moss, 0.35));
  const leafCol = linearOf(mixBytes(TONES.moss, TONES.lichenYellow, 0.28));
  for (let k = 0; k < 2; k++) {
    const th = shade + (k === 0 ? 2.2 : 3.6);
    const y0 = k === 0 ? 0.2 : 0.12;
    const r = radius(y0, th);
    const ox = cx + Math.cos(th) * (r - 0.01);
    const oz = cz + Math.sin(th) * (r - 0.01);
    const oy = rideHeight(ox, oz) + y0;
    const len = k === 0 ? 0.55 : 0.4;
    const pts = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      pts.push([ox + Math.cos(th) * (0.06 * t + 0.03 * Math.sin(t * 3)), oy + len * t - 0.02 * t * t, oz + Math.sin(th) * (0.06 * t) + 0.03 * t * (k ? 1 : -1)]);
    }
    b.tube(pts, [0.0085, 0.0065, 0.0045, 0.003], 4, { group: 4, color: stem, vPerM: 10, capEnd: 'point' });
    // leaves along the stem (kite shaped, two triangles each)
    for (let i = 1; i <= 4; i++) {
      const t = i / 4.2;
      const q = [ox + Math.cos(th) * (0.06 * t + 0.03 * Math.sin(t * 3)), oy + len * t, oz + Math.sin(th) * 0.06 * t + 0.03 * t * (k ? 1 : -1)];
      const a = th + (i % 2 ? 1 : -1) * (0.8 + 0.5 * hash1(i + k * 7, 5));
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const s = 0.05 + 0.025 * hash1(i * 3 + k, 7);
      const tint = 0.8 + 0.4 * hash1(i * 5 + k, 2);
      const col = [leafCol[0] * tint, leafCol[1] * tint, leafCol[2] * tint];
      const n = [0, 1, 0];
      const v0 = b.vert(q, n, 0, 0, col);
      const v1 = b.vert([q[0] + dx * s * 0.5 - dz * s * 0.22, q[1] + 0.01, q[2] + dz * s * 0.5 + dx * s * 0.22], n, 0, 0, col);
      const v2 = b.vert([q[0] + dx * s, q[1] - 0.012, q[2] + dz * s], n, 0, 0, col);
      const v3 = b.vert([q[0] + dx * s * 0.5 + dz * s * 0.22, q[1] + 0.012, q[2] + dz * s * 0.5 - dx * s * 0.22], n, 0, 0, col);
      b.triHint(v0, v1, v2, n, 4);
      b.triHint(v0, v2, v3, n, 4);
    }
  }

  // ---- the rope: a coil of weathered manila on the cut top, and a loose end trailing over the edge ------------------------------------
  const rope = createBuilder();
  const L = STUMP_LOOK;
  const ropeR = L.ropeRadius;
  // a tint on the rope texture (which carries the manila colour): weathered, a little grey
  const rc = [0.86, 0.83, 0.76];
  const turns = L.turns;
  const N = turns * L.segsPerTurn;
  const th0 = rng() * TAU;
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;
  const ctr = [cx + (rng() - 0.5) * 0.04, cz + (rng() - 0.5) * 0.04];
  const coil = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const th = th0 + (k / L.segsPerTurn) * TAU;
    const loopI = k / L.segsPerTurn;
    // radius: each loop its own size, alternately in and out so they nest, a cone tendency, a wobble
    const loopK = Math.floor(loopI);
    const rad = L.coilRadius * (1 - 0.09 * t) + 0.034 * (hash1(loopK, 11) - 0.5) * 2 + 0.011 * Math.sin(loopI * 2.3 + ph1) + 0.007 * noise.perlin2(k * 0.4, 4) + 0.007 * Math.sin(th * 2 + ph2);
    // each loop sits a little off the last (a hand flaked the rope down, it was never wound on a drum)
    const dx = (t - 0.5) * 0.03 + 0.03 * (hash1(loopK, 12) - 0.5);
    const dzz = 0.03 * (hash1(loopK, 13) - 0.5);
    const x = ctr[0] + dx + Math.cos(th) * rad * 1.07;
    const z = ctr[1] - dx * 0.5 + dzz + Math.sin(th) * rad * 0.93;
    // loops lean a little (each its own tilt) and the pile settles unevenly
    const tilt = 0.014 * (hash1(loopK, 14) - 0.3) * Math.sin(th + hash1(loopK, 15) * TAU);
    const y = yTop + ropeR * 1.02 + L.pitch * loopI + 0.0035 * Math.sin(th * 3 + ph2) + tilt;
    coil.push([x, y, z]);
  }
  // the loose end: off the top of the pile, over the rim, down the flank, curling on the ground and fraying
  const last = coil[coil.length - 1];
  const thEnd = Math.atan2(last[2] - cz, last[0] - cx);
  const thTail = thEnd + 0.5;
  const tail = [];
  const rimR = radius(H, thTail);
  tail.push([last[0] + Math.cos(thEnd + 0.9) * 0.02, last[1] - 0.006, last[2] + Math.sin(thEnd + 0.9) * 0.02]);
  tail.push([cx + Math.cos(thEnd + 0.4) * (rimR * 0.72), yTop + ropeR * 1.3 + 0.012, cz + Math.sin(thEnd + 0.4) * (rimR * 0.72)]);
  tail.push([cx + Math.cos(thTail) * (rimR + ropeR * 0.7), yTop - 0.012, cz + Math.sin(thTail) * (rimR + ropeR * 0.7)]);
  for (const yr of [H * 0.78, H * 0.46, H * 0.18]) {
    const rr = radius(yr, thTail + 0.1 * (1 - yr / H));
    const a = thTail + 0.1 * (1 - yr / H);
    const x = cx + Math.cos(a) * (rr + ropeR * 0.8);
    const z = cz + Math.sin(a) * (rr + ropeR * 0.8);
    tail.push([x, rideHeight(x, z) + yr, z]);
  }
  // on the ground: a lazy S away from the stump
  let ga = thTail + 0.15;
  let gx = cx + Math.cos(ga) * (radius(0.05, ga) + 0.1);
  let gz = cz + Math.sin(ga) * (radius(0.05, ga) + 0.1);
  for (let i = 0; i < 3; i++) {
    ga += (i % 2 ? -1 : 1) * 0.5;
    gx += Math.cos(ga) * 0.13;
    gz += Math.sin(ga) * 0.13;
    tail.push([gx, rideHeight(gx, gz) + ropeR * 0.9, gz]);
  }
  const all = [...coil, ...tail];
  const radiiFn = (t, i) => (i >= all.length - 2 ? ropeR * (i === all.length - 1 ? 0.78 : 0.95) : ropeR);
  rope.tube(all, radiiFn, 3, { group: 0, color: rc, vPerM: 1 / 0.24, uRep: 1, capStart: true, capEnd: 'point' });
  return {
    geometry: b.toGeometry(),
    rope: rope.toGeometry(),
    tris: { stump: b.triangles, rope: rope.triangles },
    placement: { x: cx, z: cz, yTop, ground: gC, radius: R0, height: H },
  };
}

// ------------------------------------------------------------------------------------------------
// THE ARROW NAILED TO THE TREE
// ------------------------------------------------------------------------------------------------
// A short pine offcut bent a little round the bark and nailed through at both ends. The board's face is turned
// to look at the walker as it is a few metres before the tree, so the arrow reads as the camera approaches; the arrow
// points along the walking direction (the way round the trunk that runs with the walk). The grid of the face is
// laid ON the real trunk model, one vertex per (angle, height), so it hugs every lump; one corner is pushed into
// the bark and is being swallowed.
export function buildArrow() {
  const { spec, model } = trunkModel(STORY_PROPS.arrow.trunkId);
  const walk = atPath(spec.s, 0);
  const cam = atPath(Math.max(0, spec.s - ARROW.sightSBefore), 0);
  const thN = Math.atan2(cam.z - spec.z, cam.x - spec.x) + ARROW.azimuthOffsetDeg * DEG;
  const h0 = STORY_PROPS.arrow.height;
  const R = model.radius(h0, thN);
  // which way round the trunk is "forward"? d(theta) positive runs along (-sin, cos); pick the sign that follows the walk
  const along = -Math.sin(thN) * walk.tx + Math.cos(thN) * walk.tz;
  const dir = along >= 0 ? 1 : -1;
  const cols = ARROW.cols;
  const rows = 2;
  const b = createBuilder();
  const rng = createRng(90909);
  const warpSeed = rng() * 5;
  const noise = createNoise(9091);
  // the surface point of the board at (u, v) in [0, 1]; u runs along the arrow
  const at = (u, v, offset) => {
    const th = thN + dir * (u - 0.5) * (ARROW.length / R) + (v - 0.5) * 0.06 * (u - 0.5); // the board is a little warped: sheared
    const h = h0 + (v - 0.5) * ARROW.height + 0.006 * Math.sin(u * 2.4 + warpSeed) * (v - 0.5) * 2;
    const s = model.surface(h, th);
    // the swallowed corner: the far lower corner is pulled into the bark
    const sw = smoothstep(0.62, 1.0, u) * (1 - smoothstep(0.0, 0.75, v));
    // a hint of cupping (the board has dried and curled) and a slight lift of the near end
    const cup = 0.004 * Math.sin(Math.PI * u) * (0.5 + noise.perlin2(u * 2, warpSeed)) + 0.003 * (1 - u);
    const off = offset === "front" ? ARROW.proud + cup - ARROW.swallow * sw : -0.004 - ARROW.swallow * sw * 0.2;
    return { p: [s.p.x + s.n.x * off, s.p.y + s.n.y * off, s.p.z + s.n.z * off], n: [s.n.x, s.n.y, s.n.z] };
  };
  const white = [1, 1, 1];
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      const f = at(u, v, "front");
      row.push(b.vert(f.p, f.n, u, v, white));
    }
    grid.push(row);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = at((c + 0.5) / cols, (r + 0.5) / rows, "front").n;
      b.triHint(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], n, 0);
      b.triHint(grid[r][c], grid[r + 1][c + 1], grid[r + 1][c], n, 0);
    }
  }
  // the edges: a thin wall from the front face back into the bark, on all four sides
  const edge = (pts, outward) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const c2 = pts[i + 1];
      const fa = at(a.u, a.v, "front");
      const fc = at(c2.u, c2.v, "front");
      const ba = at(a.u, a.v, "back");
      const bc = at(c2.u, c2.v, "back");
      const i0 = b.vert(fa.p, outward, a.u, a.v, [0.85, 0.82, 0.76]);
      const i1 = b.vert(fc.p, outward, c2.u, c2.v, [0.85, 0.82, 0.76]);
      const i2 = b.vert(bc.p, outward, c2.u, c2.v, [0.7, 0.68, 0.62]);
      const i3 = b.vert(ba.p, outward, a.u, a.v, [0.7, 0.68, 0.62]);
      b.triHint(i0, i1, i2, outward, 0);
      b.triHint(i0, i2, i3, outward, 0);
    }
  };
  // outward direction of an edge: away from the board's middle (the walls are tiny, an approximate direction is enough)
  const sideN = (u, v) => {
    const a = at(u, v, "front").p;
    const m = at(0.5, 0.5, "front").p;
    return [a[0] - m[0], a[1] - m[1], a[2] - m[2]];
  };
  const bottom = [];
  const top = [];
  for (let c = 0; c <= cols; c++) {
    bottom.push({ u: c / cols, v: 0 });
    top.push({ u: c / cols, v: 1 });
  }
  const left = [];
  const right = [];
  for (let r = 0; r <= rows; r++) {
    left.push({ u: 0, v: r / rows });
    right.push({ u: 1, v: r / rows });
  }
  const dn = (list) => {
    const mid = list[Math.floor(list.length / 2)];
    return sideN(mid.u, mid.v);
  };
  edge(bottom, dn(bottom));
  edge(top, dn(top));
  edge(left, dn(left));
  edge(right, dn(right));
  // ---- two nail heads, matching the rust streaks painted in the texture (group 1) ---------------------------------------------------
  const W = STORY_TEX.arrowW;
  const Ht = STORY_TEX.arrowH;
  const nailsUV = [
    [13 / W, 47 / Ht],
    [(W - 13) / W, 40 / Ht],
  ];
  for (const [u, v] of nailsUV) {
    const f = at(u, v, "front");
    const rr = 0.0072;
    const nrm = f.n;
    const up = new THREE.Vector3(0, 1, 0);
    const nv = new THREE.Vector3(...nrm);
    const t1 = new THREE.Vector3().crossVectors(up, nv).normalize();
    const t2 = new THREE.Vector3().crossVectors(nv, t1).normalize();
    const apex = b.vert([f.p[0] + nrm[0] * 0.0045, f.p[1] + nrm[1] * 0.0045, f.p[2] + nrm[2] * 0.0045], nrm, 0.5, 0.5, [1, 1, 1]);
    const ring = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const px = f.p[0] + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * rr + nrm[0] * 0.001;
      const py = f.p[1] + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * rr + nrm[1] * 0.001;
      const pz = f.p[2] + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * rr + nrm[2] * 0.001;
      ring.push(b.vert([px, py, pz], [nrm[0] * 0.7 + (px - f.p[0]) * 20, nrm[1] * 0.7 + (py - f.p[1]) * 20, nrm[2] * 0.7 + (pz - f.p[2]) * 20], 0.5, 0.5, [1, 1, 1]));
    }
    for (let k = 0; k < 6; k++) b.triHint(apex, ring[k], ring[(k + 1) % 6], nrm, 1);
  }
  return {
    geometry: b.toGeometry(),
    tris: b.triangles,
    placement: { trunk: spec.id, azimuthDeg: (thN / DEG + 360) % 360, height: h0, forwardSign: dir, radius: R },
  };
}
