"use client";

// Foreground framing: a handful of large, dark, backlit leaf and fern shapes very close to the lens
// (2.5 to 6 units away) at the edges and bottom of the frame, plus two thin branches crossing the
// upper corners. They are real geometry built from the procedural leaf cards, so the depth of
// field stage turns them into soft cinematic shapes and the foliage material makes their edges
// glow when the sun comes through them.
//
// How the pieces are placed
//   Each item has an anchor given in normalised screen coordinates (ndc x, ndc y) and a distance
//   along that view ray. viewToWorld() turns it into a world position for the BASE camera, using
//   the real canvas aspect (clamped) so edge items stay at the edges on any screen.
//   The item group is rotated with lookAt so its local +Z points at the camera. Everything inside
//   is then authored in a flat "screen plane" frame: +X right, +Y up, +Z toward the viewer.
//
// Composition rules (hero text sits in the lower left, treehouse is upper right of centre)
//   bottom right   large fern, three fronds, the main depth cue
//   bottom left    low, dark fern, two fronds, only a tip reaches into the text zone
//   left edge      beech spray rising from outside the frame, above the text zone
//   right edge     oak spray hanging in from the right
//   upper corners  two thin branches with side twigs and leaf sprays, kept clear of the cabin
//
// Wind: every item swings a few hundredths of a radian about its anchor with its own period and
// phase (no allocation per frame, frozen under prefers-reduced-motion).
//
// Triangle cost is about 2k (see userData.triangles on the group).
//
// This file also exports the small mesh builders (createMesher, addTube, meshToGeometry) that
// ForestEnvironment reuses for trunks, branches and logs.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BRAND, CAMERA, PALETTE } from "@/lib/sceneConfig";
import { getRigPose } from "@/hooks/useIdle";
import { createRng, range } from "@/lib/random";
import { clamp } from "@/lib/noise";
import useReducedMotion from "@/hooks/useReducedMotion";
import {
  createBarkTextures,
  createFernFrondTexture,
  createLeafCardTexture,
} from "@/lib/proceduralTextures";
import { makeFoliageMaterial } from "@/lib/foliageMaterial";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Texture resolution of the foreground cards. They are blurred by depth of field, so 512 is
// plenty; raise to 768 or 1024 if the DoF stage is ever switched off.
const FG_TEX_SIZE = 512;

// ------------------------------------------------------------------------------------------------
// Shared mesh building helpers (also used by ForestEnvironment)
// ------------------------------------------------------------------------------------------------

// Plain growing arrays. Turned into one BufferGeometry by meshToGeometry.
export function createMesher() {
  return { pos: [], nor: [], uv: [], col: [], idx: [] };
}

export function meshToGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(m.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(m.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(m.col, 3));
  g.setIndex(m.idx);
  g.computeBoundingSphere();
  return g;
}

// One flat disc closing the end of a tube. Normal is +/-T, fan around the centre.
function addCap(m, centre, T, N, B, radius, towardT, col, radial) {
  const base = m.pos.length / 3;
  const s = towardT ? 1 : -1;
  m.pos.push(centre.x, centre.y, centre.z);
  m.nor.push(T.x * s, T.y * s, T.z * s);
  m.uv.push(0.5, 0.5);
  m.col.push(col[0], col[1], col[2]);
  for (let j = 0; j <= radial; j++) {
    const a = (j / radial) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    m.pos.push(
      centre.x + (N.x * ca + B.x * sa) * radius,
      centre.y + (N.y * ca + B.y * sa) * radius,
      centre.z + (N.z * ca + B.z * sa) * radius
    );
    m.nor.push(T.x * s, T.y * s, T.z * s);
    m.uv.push(0.5 + 0.5 * ca, 0.5 + 0.5 * sa);
    m.col.push(col[0], col[1], col[2]);
  }
  for (let j = 0; j < radial; j++) {
    if (towardT) m.idx.push(base, base + 1 + j, base + 2 + j);
    else m.idx.push(base, base + 2 + j, base + 1 + j);
  }
}

// Sweeps a ring of vertices along a polyline to make a smooth tube with analytic normals.
//   points      THREE.Vector3[] centre line
//   baseRadius  number[] per ring, the smooth radius profile (drives taper slope and bark uv)
//   radiusAt    optional (ring, angle) => radius, for flutes and lumps on top of baseRadius
//   colorAt     optional (ring, angle, x, y, z) => [r, g, b] vertex colour (linear)
//   capStart / capEnd  optional [r, g, b] colour: close that end with a disc
// UV: u runs once round the circumference, v advances by (length / circumference) so a bark
// texture keeps square proportions along a tapering trunk. Frames use parallel transport so the
// ring never twists along curved paths.
export function addTube(
  m,
  points,
  { radial = 8, baseRadius, radiusAt = null, uOffset = 0, vOffset = 0, colorAt = null, capStart = null, capEnd = null }
) {
  const n = points.length;
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const first = m.pos.length / 3;
  let v = vOffset;
  const keep = { T: new THREE.Vector3(), N: new THREE.Vector3(), B: new THREE.Vector3() };
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const pPrev = points[Math.max(i - 1, 0)];
    const pNext = points[Math.min(i + 1, n - 1)];
    T.subVectors(pNext, pPrev);
    const span = Math.max(T.length(), 1e-6);
    T.divideScalar(span);
    if (i === 0) {
      // any starting normal that is not parallel to the tangent
      if (Math.abs(T.y) < 0.9) N.set(0, 1, 0);
      else N.set(1, 0, 0);
    }
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    if (i === 0) {
      keep.T.copy(T);
      keep.N.copy(N);
      keep.B.copy(B);
    }
    const rb = baseRadius[i];
    // radius change per unit length, used to tilt normals along a taper or flare
    const slope = (baseRadius[Math.min(i + 1, n - 1)] - baseRadius[Math.max(i - 1, 0)]) / span;
    if (i > 0) v += p.distanceTo(points[i - 1]) / (TAU * 0.5 * (rb + baseRadius[i - 1]));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      dir.set(N.x * ca + B.x * sa, N.y * ca + B.y * sa, N.z * ca + B.z * sa);
      const r = radiusAt ? radiusAt(i, a) : rb;
      const px = p.x + dir.x * r;
      const py = p.y + dir.y * r;
      const pz = p.z + dir.z * r;
      m.pos.push(px, py, pz);
      // surface normal = radial - slope * T - (dr/da / r) * (unit vector round the ring)
      nrm.copy(dir).addScaledVector(T, -slope);
      if (radiusAt) {
        const e = 0.06;
        const ra = (radiusAt(i, a + e) - radiusAt(i, a - e)) / (2 * e) / Math.max(r, 1e-4);
        nrm.x -= ra * (-N.x * sa + B.x * ca);
        nrm.y -= ra * (-N.y * sa + B.y * ca);
        nrm.z -= ra * (-N.z * sa + B.z * ca);
      }
      nrm.normalize();
      m.nor.push(nrm.x, nrm.y, nrm.z);
      m.uv.push(uOffset + j / radial, v);
      const c = colorAt ? colorAt(i, a, px, py, pz) : [1, 1, 1];
      m.col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = first + i * (radial + 1) + j;
      const b = a + 1;
      const c = a + (radial + 1);
      const d = c + 1;
      // (a, b, c): edge b-a runs along +B, edge c-a along +T, so the normal is B x T = N (outward)
      m.idx.push(a, b, c, b, d, c);
    }
  }
  if (capStart) addCap(m, points[0], keep.T, keep.N, keep.B, baseRadius[0], false, capStart, radial);
  if (capEnd) addCap(m, points[n - 1], T, N, B, baseRadius[n - 1], true, capEnd, radial);
}

// ------------------------------------------------------------------------------------------------
// Bent leaf card (a fern frond or a leaf spray as one smooth, slightly twisted ribbon)
// ------------------------------------------------------------------------------------------------
const _R = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// Appends one card to the mesher. The card is l long (along +Y from its base) and w wide, its
// base point sits at u = baseU of the texture. Placement happens in the item's screen-plane frame.
//   roll    radians about Z: 0 points the card up the screen, positive turns it counter-clockwise
//   pitch   radians about X (tips the card toward or away from the viewer)
//   yaw     radians about Y
//   curl    total bend of the midrib over its length, radians (positive bows the tip toward +Z)
//   twist   total rotation of the card about its own midrib from base to tip, radians
//   cup     sideways cup across the width (fraction of the width), gives the leaf a trough shape
//   flip    -1 mirrors the card (the texture frond arches to the right, flipped it arches left)
function addBentCard(m, c) {
  const {
    w,
    l,
    baseU = 0.5,
    segW = 3,
    segH = 8,
    curl = 0,
    twist = 0,
    cup = 0,
    flip = 1,
    pos = [0, 0, 0],
    roll = 0,
    pitch = 0,
    yaw = 0,
  } = c;
  // matrix = Rz * Ry * Rx: tilt first, then yaw, then roll in the screen plane
  _R.makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll, "ZYX"));
  const base = m.pos.length / 3;
  const k = curl / l; // curvature in radians per unit length
  for (let j = 0; j <= segH; j++) {
    const s = j / segH;
    const y = s * l;
    const phi = k * y;
    // midrib is a circular arc in the YZ plane (integral of the tangent (0, cos phi, sin phi))
    const cy = Math.abs(k) < 1e-5 ? y : Math.sin(phi) / k;
    const cz = Math.abs(k) < 1e-5 ? 0 : (1 - Math.cos(phi)) / k;
    const tau = twist * s;
    const ct = Math.cos(tau);
    const st = Math.sin(tau);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    // twisted width axis X' and normal N' (rotation of (e_x, N0) about the tangent by tau)
    const xx = ct;
    const xy = -st * sp;
    const xz = st * cp;
    const nx0 = -st;
    const ny0 = -ct * sp;
    const nz0 = ct * cp;
    for (let i = 0; i <= segW; i++) {
      const u = i / segW;
      const x = (u - baseU) * w * flip;
      const cupOff = (cup * x * x) / w;
      _v.set(x * xx + cupOff * nx0, cy + x * xy + cupOff * ny0, cz + x * xz + cupOff * nz0);
      // normal of the cupped surface: N' - (dz/dx) X'
      const dz = (2 * cup * x) / w;
      _n.set(nx0 - dz * xx, ny0 - dz * xy, nz0 - dz * xz).normalize();
      _v.applyMatrix4(_R);
      _n.transformDirection(_R);
      // The foliage material shades both faces alike, so the normal must face the viewer (+Z)
      // or the card would catch the sun on the wrong side. Flip, then lean toward the camera.
      if (_n.z < 0) _n.negate();
      _n.set(_n.x * 0.7, _n.y * 0.7 + 0.08, _n.z * 0.7 + 0.3).normalize();
      m.pos.push(_v.x + pos[0], _v.y + pos[1], _v.z + pos[2]);
      m.nor.push(_n.x, _n.y, _n.z);
      m.uv.push(u, s);
      m.col.push(1, 1, 1);
    }
  }
  for (let j = 0; j < segH; j++) {
    for (let i = 0; i < segW; i++) {
      const a = base + j * (segW + 1) + i;
      const b = a + 1;
      const d = a + (segW + 1);
      const e = d + 1;
      m.idx.push(a, b, d, b, e, d);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Item definitions
// ------------------------------------------------------------------------------------------------
// ndc: anchor in normalised screen space, dist: units from the camera along that ray (2.5 to 6).
// Sizes are authored as if the item sat 4 units in front of the lens (REF_DEPTH): there one unit
// spans 0.51 of the screen height and 0.29 of the screen width at 16:9. Placement scales each
// group by its real depth / REF_DEPTH, so these numbers stay true at the frame edges, where the
// ray is longer than the depth. Angles are degrees (roll), wind amp is radians, period seconds.
const REF_DEPTH = 4;
// Backlit glow of foreground leaves: brand light green pulled toward the warm light (same recipe as
// the canopy), instead of a lime yellow.
const LEAF_GLOW = new THREE.Color(BRAND.greenLight).lerp(new THREE.Color(BRAND.warmLight), 0.35);
// Leaf albedo multiplier for an item: brand light green scaled by `shade`, with a touch of warm
// light so the foreground is not one flat mid green.
const tintFor = (shade, warm = 0.1) =>
  new THREE.Color(PALETTE.leafHighlight).lerp(new THREE.Color(BRAND.warmLight), warm).multiplyScalar(shade);
const ITEMS = [
  {
    id: "fern-bottom-right",
    kind: "fern",
    ndc: [0.78, -1.2],
    dist: 3.7,
    shade: 0.87,
    translucency: 1.5,
    wind: { amp: 0.045, period: 7.2, phase: 0.4 },
    // three fronds fanning up and to the left out of the bottom right corner, tips stay below
    // ndc y of about -0.4 so the trunk base and the cabin remain clear
    cards: [
      { l: 1.75, roll: 36, pitch: 0.25, yaw: 0.1, curl: 0.5, twist: 0.25, flip: 1, pos: [0, 0, 0] },
      { l: 1.5, roll: 62, pitch: -0.2, yaw: -0.25, curl: 0.4, twist: -0.3, flip: -1, pos: [0.2, 0.05, -0.3] },
      { l: 1.3, roll: 10, pitch: 0.4, yaw: 0.3, curl: -0.3, twist: 0.35, flip: 1, pos: [-0.25, 0.05, 0.2] },
    ],
  },
  {
    id: "fern-bottom-left",
    kind: "fern",
    ndc: [-0.95, -1.22],
    dist: 3.0,
    shade: 0.61, // darker and lower: this corner sits under the hero text
    translucency: 1.2,
    wind: { amp: 0.035, period: 8.6, phase: 2.1 },
    // only the tips of two low fronds enter the text zone, both below ndc y of -0.7
    cards: [
      { l: 1.25, roll: -62, pitch: 0.2, yaw: -0.15, curl: 0.45, twist: -0.2, flip: -1, pos: [0, 0, 0] },
      { l: 1.0, roll: -36, pitch: -0.15, yaw: 0.2, curl: 0.3, twist: 0.3, flip: 1, pos: [0.12, 0.04, -0.25] },
    ],
  },
  {
    id: "spray-left",
    kind: "beech",
    ndc: [-1.14, 0.15],
    dist: 3.4,
    shade: 0.78,
    translucency: 1.3,
    wind: { amp: 0.06, period: 5.1, phase: 4.0 },
    // leaves rising in from beyond the left edge, kept above the text zone (ndc y over -0.25). Only
    // three cards: the left side is deliberately sparser than the right so the frame is not a
    // symmetric pair of leaf walls
    // thick stub entering from beyond the left edge, so the leaves hang from a branch, not in air
    stub: { angle: 172, length: 2.6, r0: 0.09, r1: 0.035, bow: 0.12 },
    cards: [
      { l: 1.5, roll: -80, pitch: 0.3, yaw: 0.2, curl: 0.6, twist: 0.3, flip: 1, pos: [0, 0, 0] },
      { l: 1.25, roll: -55, pitch: -0.25, yaw: -0.3, curl: 0.45, twist: -0.4, flip: -1, pos: [0.05, 0.4, -0.3] },
      { l: 1.35, roll: -100, pitch: 0.5, yaw: 0.1, curl: 0.5, twist: 0.2, flip: 1, pos: [0, -0.05, 0.25] },
    ],
  },
  {
    id: "spray-right",
    kind: "oak",
    ndc: [1.14, -0.2],
    dist: 4.0,
    shade: 0.82,
    translucency: 1.3,
    wind: { amp: 0.07, period: 6.3, phase: 1.2 },
    // the heavy branch the oak spray grows from, crossing the right edge
    stub: { angle: 8, length: 2.8, r0: 0.11, r1: 0.04, bow: -0.1 },
    cards: [
      { l: 1.4, roll: 84, pitch: 0.25, yaw: -0.2, curl: 0.55, twist: -0.3, flip: -1, pos: [0, 0, 0] },
      { l: 1.15, roll: 112, pitch: -0.3, yaw: 0.25, curl: 0.4, twist: 0.35, flip: 1, pos: [0, -0.25, -0.3] },
      { l: 1.25, roll: 58, pitch: 0.4, yaw: 0.1, curl: 0.45, twist: 0.2, flip: -1, pos: [-0.05, 0.35, 0.2] },
      { l: 1.0, roll: 96, pitch: 0.05, yaw: -0.35, curl: -0.35, twist: -0.4, flip: 1, pos: [0.1, 0.1, -0.5] },
    ],
  },
  {
    id: "twig-top-right",
    kind: "oak",
    ndc: [1.1, 1.08],
    dist: 4.8,
    shade: 0.78,
    translucency: 1.3,
    wind: { amp: 0.04, period: 4.4, phase: 5.3 },
    // thin branch coming over the corner and falling down the right edge, clear of the cabin
    // (the cabin occupies about ndc x 0 to 0.57, y 0.65 up)
    twig: { angle: 235, length: 1.6, bow: 0.15, droop: 0.25, zArc: 0.3, r0: 0.11, r1: 0.026, leaves: 5, leafSize: [0.7, 1.0], seed: 21 },
  },
  {
    id: "twig-top-left",
    kind: "beech",
    ndc: [-1.12, 1.06],
    dist: 4.2,
    shade: 0.7,
    translucency: 1.2,
    wind: { amp: 0.05, period: 8.1, phase: 3.3 },
    twig: { angle: 335, length: 1.7, bow: -0.2, droop: 0.22, zArc: -0.3, r0: 0.1, r1: 0.024, leaves: 5, leafSize: [0.75, 1.05], seed: 33 },
  },
];

// Builds the wood and the leaf geometry of a branch item. The branch is a smooth tapering tube
// starting outside the frame; two thin side twigs and a terminal spray give it believable structure.
function buildTwigItem(spec) {
  const t = spec.twig;
  const rng = createRng(t.seed);
  const a = t.angle * DEG;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // control points of the main branch in the screen plane (anchor is the origin, 0.9 outside first)
  const ctrl = [];
  for (let i = 0; i <= 5; i++) {
    const s = i / 5;
    const along = -0.9 + (t.length + 0.9) * s;
    const bow = t.bow * Math.sin(Math.PI * s); // sideways arc so it is not a straight stick
    ctrl.push(
      new THREE.Vector3(
        dx * along - dy * bow,
        dy * along + dx * bow - t.droop * s * s, // gravity droop, strongest at the tip
        t.zArc * Math.sin(Math.PI * s) + range(rng, -0.05, 0.05)
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, "catmullrom", 0.5);
  const RINGS = 16;
  const pts = curve.getPoints(RINGS);
  const radii = pts.map((_, i) => THREE.MathUtils.lerp(t.r0, t.r1, Math.pow(i / RINGS, 0.8)));
  const wood = createMesher();
  const tone = (i) => 0.7 + 0.1 * Math.sin(i * 1.7);
  addTube(wood, pts, {
    radial: 8,
    baseRadius: radii,
    uOffset: range(rng, 0, 1),
    colorAt: (i) => [tone(i), tone(i) * 0.93, tone(i) * 0.85],
  });
  const leaves = createMesher();
  const addLeaf = (p, ang, size, jitter) => {
    // card +Y points along `ang` (screen plane angle); roll 0 means up the screen (ang = 90 deg)
    addBentCard(leaves, {
      w: size,
      l: size,
      segW: 3,
      segH: 6,
      pos: [p.x, p.y, p.z],
      roll: ang - Math.PI / 2,
      pitch: jitter * range(rng, -0.7, 0.7),
      yaw: jitter * range(rng, -0.6, 0.6),
      curl: range(rng, -0.6, 0.6),
      twist: range(rng, -0.45, 0.45),
      flip: rng() < 0.5 ? 1 : -1,
    });
  };
  // side twigs: thin tubes leaving the branch at about 40 degrees, each ending in a leaf spray
  const sides = [0.5, 0.72];
  sides.forEach((s, k) => {
    const p0 = curve.getPointAt(s);
    const tan = curve.getTangentAt(s);
    const side = k % 2 === 0 ? 1 : -1;
    const ang = Math.atan2(tan.y, tan.x) + side * range(rng, 38, 52) * DEG;
    const len = range(rng, 0.6, 0.95);
    const q1 = new THREE.Vector3(p0.x + Math.cos(ang) * len * 0.5, p0.y + Math.sin(ang) * len * 0.5 - 0.03, p0.z + range(rng, -0.1, 0.1));
    const q2 = new THREE.Vector3(p0.x + Math.cos(ang) * len, p0.y + Math.sin(ang) * len - 0.08, p0.z + range(rng, -0.15, 0.15));
    const sc = new THREE.CatmullRomCurve3([p0.clone(), q1, q2]);
    const sp = sc.getPoints(6);
    addTube(wood, sp, {
      radial: 5,
      baseRadius: sp.map((_, i) => THREE.MathUtils.lerp(0.045, 0.015, i / 6)),
      uOffset: rng(),
      colorAt: () => [0.62, 0.57, 0.5],
    });
    addLeaf(q2, ang, range(rng, t.leafSize[0], t.leafSize[1]) * 0.9, 1);
  });
  // leaf sprays distributed along the second half of the main branch
  for (let i = 0; i < t.leaves; i++) {
    const s = i === t.leaves - 1 ? 1 : 0.32 + (0.62 * i) / Math.max(t.leaves - 2, 1) + range(rng, -0.04, 0.04);
    const p = curve.getPointAt(Math.min(s, 1));
    const tan = curve.getTangentAt(Math.min(s, 1));
    const baseAng = Math.atan2(tan.y, tan.x);
    const side = i % 2 === 0 ? 1 : -1;
    // the last spray continues along the branch, the others leave at an angle
    const ang = i === t.leaves - 1 ? baseAng : baseAng + side * range(rng, 30, 62) * DEG;
    addLeaf(p, ang, range(rng, t.leafSize[0], t.leafSize[1]), 1);
  }
  return { wood: meshToGeometry(wood), leaves: meshToGeometry(leaves) };
}

// Builds the leaf geometry of a card item (fern or spray).
function buildCardItem(spec) {
  const m = createMesher();
  let wood = null;
  if (spec.stub) {
    // A tapering branch from outside the frame to the anchor (the origin of the item), bowed a
    // little so it is not a straight stick. Radius at the tip is at least 0.035 (about 3 px at
    // 4 m) so it never reads as a hairline wire.
    const st = spec.stub;
    const a = st.angle * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const ctrl = [];
    for (let i = 0; i <= 4; i++) {
      const s = i / 4;
      const along = st.length * (1 - s);
      const bow = st.bow * Math.sin(Math.PI * s);
      ctrl.push(new THREE.Vector3(dx * along - dy * bow, dy * along + dx * bow, -0.15 * Math.sin(Math.PI * s)));
    }
    const pts = new THREE.CatmullRomCurve3(ctrl).getPoints(12);
    const w = createMesher();
    addTube(w, pts, {
      radial: 7,
      baseRadius: pts.map((_, i) => THREE.MathUtils.lerp(st.r0, st.r1, Math.pow(i / 12, 0.8))),
      uOffset: 0.3,
      colorAt: (i) => {
        const t = 0.7 + 0.08 * Math.sin(i * 1.3);
        return [t, t * 0.92, t * 0.84];
      },
      capEnd: [0.6, 0.55, 0.48],
    });
    wood = meshToGeometry(w);
  }
  for (const c of spec.cards) {
    const fern = spec.kind === "fern";
    addBentCard(m, {
      w: c.l,
      l: c.l,
      // the fern frond texture has its base at 40 percent of the card width
      baseU: fern ? 0.4 : 0.5,
      segW: fern ? 4 : 3,
      segH: fern ? 10 : 6,
      pos: c.pos,
      roll: c.roll * DEG,
      pitch: c.pitch,
      yaw: c.yaw,
      curl: c.curl,
      twist: c.twist,
      cup: fern ? 0.12 : 0.06,
      flip: c.flip,
    });
  }
  return { wood, leaves: meshToGeometry(m) };
}

function countTriangles(geo) {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

// ------------------------------------------------------------------------------------------------
// Component
// ------------------------------------------------------------------------------------------------

export default function ForegroundLeaves() {
  const reduced = useReducedMotion();
  const size = useThree((s) => s.size);
  // Real viewport aspect (ultra wide screens are capped). Portrait phones get their own camera pose
  // from the rig, and the items are anchored to THAT frame.
  const aspect = clamp(size.width / Math.max(size.height, 1), 0.3, 2.4);

  // Geometry and materials do not depend on the screen shape.
  const resources = useMemo(() => {
    const fern = createFernFrondTexture({ seed: 8, size: FG_TEX_SIZE });
    const oak = createLeafCardTexture({ kind: "oak", seed: 3, size: FG_TEX_SIZE });
    const beech = createLeafCardTexture({ kind: "beech", seed: 4, size: FG_TEX_SIZE });
    const bark = createBarkTextures({ seed: 7 });
    const textures = { fern, oak, beech };
    // Backlit leaf colour: soft green pulled toward the warm light so the rim reads as sun
    const wood = new THREE.MeshStandardMaterial({
      map: bark.map,
      normalMap: bark.normalMap,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: bark.roughnessMap,
      aoMap: bark.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      color: new THREE.Color(PALETTE.bark).lerp(new THREE.Color(PALETTE.stone), 0.35),
    });
    const items = ITEMS.map((spec) => {
      const tex = textures[spec.kind];
      const material = makeFoliageMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        tint: tintFor(spec.shade, spec.warm),
        translucency: spec.translucency,
        roughness: 0.5, // damp, slightly glossy leaves
        normalScale: 0.9,
        transmissionColor: LEAF_GLOW,
        wind: { amplitude: 0.03, speed: 1.3 },
      });
      if (spec.twig) {
        const g = buildTwigItem(spec);
        return { spec, material, wood: g.wood, leaves: g.leaves };
      }
      const g = buildCardItem(spec);
      return { spec, material, wood: g.wood, leaves: g.leaves };
    });
    let triangles = 0;
    for (const it of items) triangles += countTriangles(it.leaves) + (it.wood ? countTriangles(it.wood) : 0);
    return { items, wood, triangles };
  }, []);

  useEffect(
    () => () => {
      resources.wood.dispose();
      for (const it of resources.items) {
        it.material.dispose();
        it.leaves.dispose();
        if (it.wood) it.wood.dispose();
      }
    },
    [resources]
  );

  // World placement (depends on the screen aspect only). Each group is scaled by depth / REF_DEPTH
  // (depth = distance along the view axis, shorter than the ray length toward the frame edges) so
  // the sizes authored in the ITEMS table keep their intended share of the screen.
  const placements = useMemo(() => {
    const o = new THREE.Object3D();
    const pose = getRigPose(aspect);
    const cam = new THREE.PerspectiveCamera(pose.fov, aspect, CAMERA.near, CAMERA.far);
    cam.position.copy(pose.position);
    cam.lookAt(pose.target);
    cam.updateMatrixWorld(true);
    const forward = pose.target.clone().sub(pose.position).normalize();
    // Authored sizes assume the base field of view; a wider portrait FOV shrinks everything on
    // screen, and the narrow portrait frame needs smaller leaves to leave the subject visible.
    const fovScale = Math.tan((pose.fov / 2) * DEG) / Math.tan((CAMERA.fov / 2) * DEG);
    const portraitScale = 1 - 0.45 * pose.portrait;
    return ITEMS.map((spec) => {
      const p = new THREE.Vector3(spec.ndc[0], spec.ndc[1], 0.5).unproject(cam);
      p.sub(pose.position).normalize().multiplyScalar(spec.dist).add(pose.position);
      const depth = p.clone().sub(pose.position).dot(forward);
      o.position.copy(p);
      o.up.set(0, 1, 0);
      o.lookAt(pose.position); // local +Z now points at the camera
      return { position: p.toArray(), quaternion: o.quaternion.toArray(), scale: ((depth * fovScale) / REF_DEPTH) * portraitScale };
    });
  }, [aspect]);

  const pivots = useRef([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const list = pivots.current;
    for (let i = 0; i < ITEMS.length; i++) {
      const pivot = list[i];
      if (!pivot) continue;
      if (reduced) {
        pivot.rotation.set(0, 0, 0);
        continue;
      }
      const w = ITEMS[i].wind;
      const k = TAU / w.period;
      // three incommensurate frequencies so the sway never repeats visibly
      pivot.rotation.z = w.amp * Math.sin(k * t + w.phase);
      pivot.rotation.x = w.amp * 0.5 * Math.sin(k * 0.71 * t + w.phase * 1.9);
      pivot.rotation.y = w.amp * 0.35 * Math.sin(k * 1.27 * t + w.phase * 0.7);
    }
  });

  return (
    <group name="foreground-leaves" userData={{ triangles: resources.triangles }}>
      {resources.items.map((it, i) => (
        <group key={it.spec.id} position={placements[i].position} quaternion={placements[i].quaternion} scale={placements[i].scale}>
          <group
            ref={(el) => {
              pivots.current[i] = el;
            }}
          >
            <mesh geometry={it.leaves} material={it.material} />
            {it.wood ? <mesh geometry={it.wood} material={resources.wood} /> : null}
          </group>
        </group>
      ))}
    </group>
  );
}
