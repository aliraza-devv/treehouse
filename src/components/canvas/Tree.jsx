"use client";

// The hero tree: a mature English oak built entirely from code.
//
//   Trunk     custom swept tube with organic radius noise, buttress flutes, junction swells
//   Roots     six curved buttress roots plus thin surface roots, seated with groundHeight
//   Branches  the three FORK_BRANCHES the deck rests on, upper limbs with sub-branches,
//             lower thin limbs that carry leaves in front of the cabin, two broken stubs
//   Twigs     cheap 5-sided tubes where leaf clusters attach
//   Canopy    two InstancedMeshes of alpha-cut leaf clusters (oak and small-leaf sprig)
//
// Local frame: the group sits at (TREE.x, 0, TREE.z). The trunk axis passes through the local
// origin at TREE.forkY, so the cabin author can treat x = 0, z = 0 as the trunk there.
// Azimuth is measured from +X toward +Z (90 degrees points at the camera).
//
// Triangle budget (printed on the group as userData.stats): about 9k wood and 11k canopy.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BRAND,
  CAMERA,
  FORK_BRANCHES,
  LIGHT,
  PLATFORM,
  TREE,
  groundHeight,
  trunkRadiusAt,
} from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { clamp, createNoise, mix, smoothstep } from "@/lib/noise";
import { createBarkTextures, createLeafCardTexture } from "@/lib/proceduralTextures";
import {
  buildLeafClusterGeometry,
  makeFoliageDepthMaterial,
  makeFoliageMaterial,
} from "@/lib/foliageMaterial";

// ------------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------------
const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const UP = new V3(0, 1, 0);
const AXIS_X = new V3(1, 0, 0);

const TRUNK_BOTTOM = -0.6; // the trunk starts below ground so no gap ever shows at the base
const TRUNK_RINGS = 40;
const TRUNK_RADIAL = 36;

// Unit XZ direction toward the sun. Bark facing away from it (toward the camera) is the damp,
// mossy side.
const SUN_VEC = new THREE.Vector3(...LIGHT.keyPosition).sub(new THREE.Vector3(...LIGHT.target)).normalize();
const SUN_XZ = new THREE.Vector2(LIGHT.keyPosition[0], LIGHT.keyPosition[2]).normalize();

// Crown envelope: an ellipsoid used to decide what is "outer shell" (bright, dense) and what is
// "interior" (dark, sparse).
const CROWN = { center: new V3(-0.2, 14.8, -0.6), radii: new V3(9.6, 6.8, 8.6) };

// Volume the cabin and its deck occupy (local space, includes the open space under the deck).
// Leaf clusters stay out of it so the treehouse stays visible.
const CABIN_BOX = new THREE.Box3(new V3(-2.2, 5.8, -1.9), new V3(4.8, 13.4, 3.6));

// Clear gaps in the canopy for sky and sun shafts. The first two lie on the line toward the key
// light so sun can reach the cabin roof. There is deliberately NO gap over the trunk leader
// (0.2, 17, 0.5): it used to clear the foliage exactly where the trunk tapers to its tip, which the
// 62 degree portrait FOV exposed as a bare grey spike above the cabin.
const GAPS = [
  { c: new V3(3.5, 14.2, -1.2), r: 1.5 },
  { c: new V3(4.7, 16.5, -2.0), r: 1.7 },
  { c: new V3(-3.2, 15.6, 1.0), r: 1.3 },
  { c: new V3(-5.2, 12.6, -1.0), r: 1.2 },
  { c: new V3(6.2, 12.8, 0.6), r: 1.3 },
];

// Sight-line corridor: a cone from the camera to the cabin (tree-local space). Foliage between the
// lens and the cabin is thinned to a few leaves so the treehouse reads through the canopy
// (roughly 60 to 70 percent visible) instead of hiding behind one big clump.
const VIEW_FROM = new V3(CAMERA.position[0] - TREE.x, CAMERA.position[1], CAMERA.position[2] - TREE.z);
const VIEW_TO = new V3(1.7, 10.9, 0.9);
const VIEW_AXIS = VIEW_TO.clone().sub(VIEW_FROM);
const VIEW_LEN2 = VIEW_AXIS.lengthSq();
const VIEW_RADIUS_END = 3.3; // cone radius at the cabin, about its half width plus roof
function viewCorridor(p, tmpV) {
  // t: position along camera -> cabin, 0 at the lens, 1 at the cabin
  const t = tmpV.copy(p).sub(VIEW_FROM).dot(VIEW_AXIS) / VIEW_LEN2;
  if (t < 0.45 || t > 1.05) return 0;
  const r = 0.4 + (VIEW_RADIUS_END - 0.4) * t;
  const d = tmpV.copy(VIEW_AXIS).multiplyScalar(t).add(VIEW_FROM).sub(p).length();
  return 1 - smoothstep(r * 0.55, r, d); // 1 on the sight line, 0 outside the cone
}

const LEAF_TARGET = { oak: 960, sprig: 760 };
const WIND = { amplitude: 0.07, speed: 1.1 };
// Canopy leaves cast leaf-shaped shadows but do not receive them: interior darkness is baked into
// the per-instance colour, which avoids self-shadow acne and blackened foliage.
const CANOPY_RECEIVES_SHADOW = false;

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------
// Local ground height relative to the group origin (the ground is flat at the tree itself).
const localGround = (x, z) => groundHeight(TREE.x + x, TREE.z + z);

// Gentle lean and S-curve of the trunk axis. Both terms are zero at forkY so the axis passes
// through x = z = 0 where the cabin attaches.
const trunkOffsetX = (y) => 0.2 * Math.sin(0.45 * (y - TREE.forkY));
const trunkOffsetZ = (y) => 0.15 * (Math.sin(0.31 * (y - TREE.forkY) + 0.4) - Math.sin(0.4));
const trunkCenter = (y) => new V3(trunkOffsetX(y), y, trunkOffsetZ(y));

// Smallest signed difference between two angles, in [-PI, PI].
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function randInSphere(rng, out) {
  for (let i = 0; i < 12; i++) {
    out.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (out.lengthSq() <= 1) return out;
  }
  return out.set(0, 0, 0);
}

// ------------------------------------------------------------------------------------------------
// Geometry accumulator and swept tube builder
// ------------------------------------------------------------------------------------------------
function createAccumulator() {
  return { pos: [], nor: [], uv: [], col: [], idx: [] };
}

function accumulatorToGeometry(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
  g.setIndex(acc.idx);
  g.computeBoundingSphere();
  return g;
}

const _col = new THREE.Color();

// Sweeps a closed ring along `curve`.
//   rings, radial     subdivisions along and around the tube
//   radiusAt(ctx)     radius for one vertex. ctx = { u, dist, theta, dir, dUp, centre, aux, ring }
//                     dir is the world-space outward direction in the ring plane and dUp its
//                     component along "up" inside that plane (for flattened root sections).
//   colorAt(ctx, out) vertex colour, called right after radiusAt for the same vertex
//   uRepeat           how many times the bark texture wraps round the circumference (integer so
//                     the seam is invisible)
//   ringU             optional arc-length parameters for the rings (denser spacing where needed)
//   levelRings        keep the rings horizontal (trunk): a leaning axis would otherwise tilt the
//                     tightly spaced base rings into each other
//   cap, tipScale     closes the far end with a short cone, tipScale 0.9 gives a flat cut stub
//
// Frames use parallel transport (no twisting). The texture V coordinate is the integral of
// uRepeat * ds / (2 PI r), so the bark tile stays roughly square in world space as the tube
// tapers (finer bark on thin branches, bigger plates on the buttressed base).
function addTube(acc, curve, o) {
  const { rings, radial, radiusAt, colorAt, uRepeat = 1, cap = true, tipScale = 0.4, ringU = null, levelRings = false } = o;
  const length = curve.getLength();
  const stride = radial + 1; // the last vertex of a ring duplicates the first (UV seam)
  const nVert = (rings + 1) * stride;
  const P = new Float32Array(nVert * 3);
  const C = new Float32Array(nVert * 3);
  const centres = new Float32Array((rings + 1) * 3);
  const means = new Float32Array(rings + 1);
  const vCoord = new Float32Array(rings + 1);
  const ctx = {
    u: 0,
    dist: 0,
    theta: 0,
    dUp: 0,
    ring: 0,
    aux: 0,
    dir: new V3(),
    centre: new V3(),
    pos: new V3(),
  };
  const T = new V3();
  const N = new V3();
  const B = new V3();
  const upIn = new V3();
  const prevN = new V3();
  const prevC = new V3();
  const lastT = new V3();
  let vAcc = 0;

  for (let i = 0; i <= rings; i++) {
    const u = ringU ? ringU[i] : i / rings;
    curve.getPointAt(u, ctx.centre);
    curve.getTangentAt(u, T);
    if (levelRings) T.copy(UP);
    if (i === 0) {
      const ref = Math.abs(T.y) < 0.9 ? UP : AXIS_X;
      N.copy(ref).addScaledVector(T, -T.dot(ref)).normalize();
    } else {
      N.copy(prevN).addScaledVector(T, -T.dot(prevN)).normalize();
    }
    prevN.copy(N);
    B.crossVectors(T, N);
    upIn.copy(UP).addScaledVector(T, -T.y);
    if (upIn.lengthSq() < 1e-4) upIn.copy(N);
    else upIn.normalize();
    ctx.u = u;
    ctx.dist = u * length;
    ctx.ring = i;
    let sum = 0;
    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * TAU;
      ctx.theta = theta;
      ctx.dir.copy(N).multiplyScalar(Math.cos(theta)).addScaledVector(B, Math.sin(theta));
      ctx.dUp = ctx.dir.dot(upIn);
      ctx.pos.copy(ctx.centre);
      const r = radiusAt(ctx);
      ctx.pos.copy(ctx.centre).addScaledVector(ctx.dir, r);
      const k = (i * stride + j) * 3;
      P[k] = ctx.pos.x;
      P[k + 1] = ctx.pos.y;
      P[k + 2] = ctx.pos.z;
      colorAt(ctx, _col);
      C[k] = _col.r;
      C[k + 1] = _col.g;
      C[k + 2] = _col.b;
      if (j < radial) sum += r;
    }
    means[i] = sum / radial;
    centres[i * 3] = ctx.centre.x;
    centres[i * 3 + 1] = ctx.centre.y;
    centres[i * 3 + 2] = ctx.centre.z;
    if (i > 0) {
      const ds = ctx.centre.distanceTo(prevC);
      vAcc += (uRepeat * ds) / (TAU * Math.max(0.5 * (means[i] + means[i - 1]), 0.012));
    }
    vCoord[i] = vAcc;
    prevC.copy(ctx.centre);
    lastT.copy(T);
  }

  // Smooth normals from the vertex grid: cross of the two central differences, wrapping round the
  // ring so the UV seam shares one normal on both sides.
  const normals = new Float32Array(nVert * 3);
  const a = new V3();
  const b = new V3();
  const n = new V3();
  const out = new V3();
  const point = (i, j, target) => {
    const k = (i * stride + (j % radial)) * 3;
    return target.set(P[k], P[k + 1], P[k + 2]);
  };
  const pa = new V3();
  const pb = new V3();
  const rawNormal = (i, j, target) => {
    const jm = (j - 1 + radial) % radial;
    const jp = (j + 1) % radial;
    a.subVectors(point(i, jp, pa), point(i, jm, pb)); // d/dtheta
    const i0 = Math.max(i - 1, 0);
    const i1 = Math.min(i + 1, rings);
    b.subVectors(point(i1, j, pa), point(i0, j, pb)); // d/dt
    return target.crossVectors(a, b);
  };
  // Decide orientation once from a middle ring: is a x b pointing outward?
  const mid = Math.floor(rings / 2);
  let orient = 0;
  for (let j = 0; j < radial; j++) {
    rawNormal(mid, j, n);
    out.set(
      P[(mid * stride + j) * 3] - centres[mid * 3],
      P[(mid * stride + j) * 3 + 1] - centres[mid * 3 + 1],
      P[(mid * stride + j) * 3 + 2] - centres[mid * 3 + 2]
    );
    orient += n.dot(out);
  }
  const sign = orient >= 0 ? 1 : -1;
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= radial; j++) {
      rawNormal(i, j, n);
      n.multiplyScalar(sign);
      const k = (i * stride + j) * 3;
      out.set(P[k] - centres[i * 3], P[k + 1] - centres[i * 3 + 1], P[k + 2] - centres[i * 3 + 2]);
      if (n.lengthSq() < 1e-14) n.copy(out);
      n.normalize();
      // never let a normal point into the tube
      if (n.dot(out) < 0) n.negate();
      normals[k] = n.x;
      normals[k + 1] = n.y;
      normals[k + 2] = n.z;
    }
  }

  const base = acc.pos.length / 3;
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= radial; j++) {
      const k = (i * stride + j) * 3;
      acc.pos.push(P[k], P[k + 1], P[k + 2]);
      acc.nor.push(normals[k], normals[k + 1], normals[k + 2]);
      acc.col.push(C[k], C[k + 1], C[k + 2]);
      acc.uv.push((j / radial) * uRepeat, vCoord[i]);
    }
  }
  // sign > 0 means (a x b) is outward, so the outward-facing triangle is (v, v+1, next ring)
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const v0 = base + i * stride + j;
      const v1 = v0 + 1;
      const v2 = v0 + stride;
      const v3 = v2 + 1;
      if (sign > 0) acc.idx.push(v0, v1, v2, v1, v3, v2);
      else acc.idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  if (cap) {
    const apex = base + nVert;
    const mr = means[rings];
    const l = mr * tipScale;
    const k0 = (rings * stride) * 3;
    acc.pos.push(centres[rings * 3] + lastT.x * l, centres[rings * 3 + 1] + lastT.y * l, centres[rings * 3 + 2] + lastT.z * l);
    acc.nor.push(lastT.x, lastT.y, lastT.z);
    acc.col.push(C[k0], C[k0 + 1], C[k0 + 2]);
    acc.uv.push(uRepeat * 0.5, vCoord[rings] + (l / (TAU * Math.max(mr, 0.012))) * uRepeat);
    for (let j = 0; j < radial; j++) {
      const v0 = base + rings * stride + j;
      if (sign > 0) acc.idx.push(v0, v0 + 1, apex);
      else acc.idx.push(v0, apex, v0 + 1);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Bark colouring. Vertex colours multiply the bark albedo map:
//   lower trunk and shaded sides get damp, darker, mossier tones (moss = brand moss, as a green
//   multiplier on the brown bark), higher bark is lighter and sun dried, crevices go dark.
// ------------------------------------------------------------------------------------------------
function tintBark(out, y, shade, crevice, moss, soil) {
  const dry = smoothstep(2.5, 15, y);
  let r = mix(0.86, 1.4, dry);
  let g = mix(0.78, 1.2, dry);
  let b = mix(0.7, 1.0, dry);
  const m = clamp(moss, 0, 0.9);
  r = mix(r, 0.78, m);
  g = mix(g, 1.5, m);
  b = mix(b, 0.72, m);
  const d = (1 - 0.3 * clamp(crevice, 0, 1)) * (1 - 0.5 * clamp(soil, 0, 1)) * (1 - 0.06 * shade);
  return out.setRGB(r * d, g * d, b * d);
}

// ------------------------------------------------------------------------------------------------
// Trunk
// ------------------------------------------------------------------------------------------------
// Buttress azimuths (degrees) and angular half widths (radians). The root tubes in addRoots use the
// same azimuths so the flutes in the trunk flow straight into the roots.
const BUTTRESS = [
  { az: 24, len: 4.6, r0: 0.6, w: 0.42 },
  { az: 84, len: 4.9, r0: 0.62, w: 0.4 },
  { az: 143, len: 4.2, r0: 0.52, w: 0.38 },
  { az: 212, len: 4.8, r0: 0.6, w: 0.42 },
  { az: 278, len: 3.9, r0: 0.5, w: 0.36 },
  { az: 330, len: 4.4, r0: 0.55, w: 0.4 },
];

// Burls on the trunk: { y, az (deg), amp (relative radius), h (vertical extent m), w (arc m) }
const BURLS = [
  { y: 4.2, az: 95, amp: 0.1, h: 0.55, w: 0.45 },
  { y: 6.0, az: 240, amp: 0.08, h: 0.5, w: 0.4 },
  { y: 2.9, az: 330, amp: 0.09, h: 0.45, w: 0.5 },
];

function addTrunk(acc, noise, swells) {
  const pts = [];
  for (let y = TRUNK_BOTTOM; y < TREE.height + 1.5; y += 1.5) pts.push(trunkCenter(y));
  pts.push(trunkCenter(TREE.height));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  // rings are denser near the base where the buttress flare changes quickly
  const ringU = [];
  for (let i = 0; i <= TRUNK_RINGS; i++) ringU.push(Math.pow(i / TRUNK_RINGS, 1.25));
  const bumps = [...swells, ...BURLS.map((b) => ({ ...b, az: b.az * DEG }))];

  const radiusAt = (ctx) => {
    const y = ctx.centre.y;
    const yy = Math.max(y, 0);
    const az = Math.atan2(ctx.dir.z, ctx.dir.x);
    const cx = Math.cos(az);
    const sz = Math.sin(az);
    let r = trunkRadiusAt(yy);
    // round off the leader at the very top
    r *= 1 - 0.45 * smoothstep(16.4, 18.2, y);
    // three octaves of angular noise: sampled on a circle so it is seamless round the trunk
    const lobes = noise.simplex3(cx * 1.25, sz * 1.25, y * 0.22); // big lobes, slight lean of mass
    const plates = noise.simplex3(cx * 3.6 + 10, sz * 3.6, y * 0.7); // bark plate bumps
    const ridges = noise.simplex3(cx * 8.5, sz * 8.5 + 5, y * 1.6); // fine ridges
    let k = 1 + 0.055 * lobes + 0.028 * plates + 0.012 * ridges;
    // Buttress flutes: gaussian bumps in azimuth that fade with height (e-folding 1.7 m)
    const A = 0.28 * Math.exp(-yy / 1.7);
    for (let i = 0; i < BUTTRESS.length; i++) {
      const d = angDiff(az, BUTTRESS[i].az * DEG) / BUTTRESS[i].w;
      k += A * Math.exp(-d * d);
    }
    // Junction swells and burls: gaussian in height and in arc length round the trunk
    for (let i = 0; i < bumps.length; i++) {
      const bp = bumps[i];
      const dy = (y - bp.y) / bp.h;
      const da = (angDiff(az, bp.az) * r) / bp.w;
      k += bp.amp * Math.exp(-(dy * dy + da * da));
    }
    ctx.aux = clamp(0.5 - plates * 0.9 - ridges * 0.3, 0, 1); // crevice measure, high in the dips
    return r * k;
  };
  const colorAt = (ctx, out) => {
    const p = ctx.pos;
    const shade = 0.5 - 0.5 * (ctx.dir.x * SUN_XZ.x + ctx.dir.z * SUN_XZ.y);
    const mn = 0.5 + 0.5 * noise.simplex3(p.x * 0.55 + 3, p.y * 0.33, p.z * 0.55);
    const mossBase = 0.08 + 0.42 * Math.exp(-Math.max(p.y, 0) / 2.4);
    const moss = mossBase * (0.3 + shade) * (0.5 + 0.9 * mn);
    const soil = smoothstep(0.35, -0.5, p.y);
    return tintBark(out, p.y, shade, ctx.aux, moss, soil);
  };
  addTube(acc, curve, {
    rings: TRUNK_RINGS,
    radial: TRUNK_RADIAL,
    radiusAt,
    colorAt,
    uRepeat: 3,
    cap: true,
    tipScale: 0.5,
    ringU,
    levelRings: true,
  });
}

// ------------------------------------------------------------------------------------------------
// Roots
// ------------------------------------------------------------------------------------------------
function addRoots(acc, noise) {
  const colorFor = (soilFrom) => (ctx, out) => {
    const p = ctx.pos;
    const shade = 0.5 - 0.5 * (ctx.dir.x * SUN_XZ.x + ctx.dir.z * SUN_XZ.y);
    const mn = 0.5 + 0.5 * noise.simplex3(p.x * 0.7 + 20, p.y * 0.5, p.z * 0.7);
    const moss = (0.28 + 0.4 * shade) * (0.5 + 0.8 * mn);
    const soil = smoothstep(soilFrom, 1, ctx.u);
    return tintBark(out, 0.5, shade, ctx.aux, moss, soil);
  };

  BUTTRESS.forEach((br, i) => {
    const az = br.az * DEG;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const pts = [];
    const N = 9;
    const rAt = (t) => br.r0 * (0.14 + 0.86 * Math.pow(1 - t, 1.1));
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = mix(0.4, br.len, t);
      // lateral wander, zero at both ends so the root leaves the trunk where the flute is
      const sway = 0.35 * noise.perlin2(i * 4.1 + 0.3, t * 2.2) * Math.sin(Math.PI * t);
      const x = dx * d - dz * sway;
      const z = dz * d + dx * sway;
      // Profile: drops steeply from y~2 inside the trunk, then flattens onto the ground
      const prof = 2.0 * Math.pow(1 - t, 2.4) + 0.12;
      const rr = rAt(t);
      let y = Math.max(prof, localGround(x, z) + rr * 0.35);
      y -= rr * 1.3 * smoothstep(0.8, 1.0, t); // the tip dives into the soil
      pts.push(new V3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    addTube(acc, curve, {
      rings: 11,
      radial: 8,
      uRepeat: Math.max(1, Math.round((TAU * br.r0) / 1.4)),
      radiusAt: (ctx) => {
        const t = ctx.u;
        const rr = rAt(t) * (1 + 0.07 * noise.simplex3(Math.cos(ctx.theta) * 1.6 + i * 3, Math.sin(ctx.theta) * 1.6, ctx.dist * 0.7));
        // flattened buttress section: taller than wide near the trunk, round further out.
        // Polar form of an ellipse with semi axes rx (sideways) and ry (vertical).
        const flat = 1 - smoothstep(0, 0.7, t);
        const ry = 1 + 0.3 * flat;
        const rx = 1 - 0.22 * flat;
        const du = ctx.dUp;
        ctx.aux = 0.3;
        return rr / Math.sqrt((du / ry) * (du / ry) + ((1 - du * du) / (rx * rx)));
      },
      colorAt: colorFor(0.62),
      cap: true,
      tipScale: 0.5,
    });
  });

  // Thin surface roots creeping over the ground between the buttresses
  [
    { az: 52, len: 3.8 },
    { az: 176, len: 3.5 },
    { az: 300, len: 4.2 },
  ].forEach((sr, i) => {
    const az = sr.az * DEG;
    const pts = [];
    const N = 7;
    const rAt = (t) => 0.13 * (0.22 + 0.78 * (1 - t));
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = mix(1.1, sr.len, t);
      const yaw = az + 0.5 * noise.perlin2(i * 6.3 + 50, t * 3);
      const x = Math.cos(yaw) * d;
      const z = Math.sin(yaw) * d;
      const rr = rAt(t);
      let y = t < 0.1 ? 0.55 : localGround(x, z) + rr * 0.45;
      y -= rr * 1.4 * smoothstep(0.75, 1, t);
      pts.push(new V3(x, y, z));
    }
    addTube(acc, new THREE.CatmullRomCurve3(pts, false, "centripetal"), {
      rings: 8,
      radial: 5,
      uRepeat: 1,
      radiusAt: (ctx) => {
        ctx.aux = 0.25;
        return rAt(ctx.u) * (1 + 0.08 * noise.simplex3(Math.cos(ctx.theta) + i, Math.sin(ctx.theta), ctx.dist));
      },
      colorAt: colorFor(0.5),
      cap: true,
    });
  });
}

// ------------------------------------------------------------------------------------------------
// Branch system
// ------------------------------------------------------------------------------------------------
// Radius profile along a branch (u = 0 at the trunk, 1 at the tip, dist in metres from the start).
// The collar swells the branch where it leaves its parent: exp decay starting at d0 (the trunk
// surface for trunk branches, 0 for sub-branches).
function branchRadius(b, u, dist) {
  const taper = 0.13 + 0.87 * Math.pow(1 - u, 0.95); // slower taper: oak limbs stay stout
  const collar = 1 + b.collar * Math.exp(-Math.max(0, dist - b.d0) / 0.5);
  return b.r0 * taper * collar;
}

const KIND_TUBE = {
  fork: { rings: 14, radial: 9, uRepeat: 2, cap: true, tipScale: 0.45 },
  upper: { rings: 9, radial: 6, uRepeat: 1, cap: true, tipScale: 0.45 },
  sub: { rings: 5, radial: 5, uRepeat: 1, cap: true, tipScale: 0.45 },
  lower: { rings: 9, radial: 5, uRepeat: 1, cap: true, tipScale: 0.45 },
  stub: { rings: 4, radial: 6, uRepeat: 1, cap: true, tipScale: 0.9 },
};

// Grows a branch as a polyline. Heading at fraction s:
//   yaw   = azimuth + slow noise wander
//   pitch = tilt + uplift * s^2 (tips curl toward the light) - droop * sin(PI * min(1, s / 0.6))
// The droop term sags the first 60 percent under its own weight, then the limb recovers: the
// "droop then rise" of a heavy oak limb.
function growBranch(noise, spec) {
  const { id, origin, az, tilt, length, r0, kind, droop = 0.12, uplift = 0.3, wobble = 0.22, d0 = 0, collar = 0.5 } = spec;
  const n = Math.max(4, Math.round(length / 0.9));
  const step = length / n;
  const p = origin.clone();
  const pts = [p.clone()];
  for (let i = 1; i <= n; i++) {
    const s = (i - 0.5) / n;
    const yaw = az * DEG + wobble * noise.perlin2(id * 5.17 + 0.3, s * 2.4);
    const pitch =
      tilt * DEG +
      uplift * s * s -
      droop * Math.sin(Math.PI * Math.min(1, s / 0.6)) +
      0.14 * noise.perlin2(id * 3.9 + 40.0, s * 2.9);
    const cp = Math.cos(pitch);
    p.x += Math.cos(yaw) * cp * step;
    p.y += Math.sin(pitch) * step;
    p.z += Math.sin(yaw) * cp * step;
    pts.push(p.clone());
  }
  return makeBranch(spec.id, kind, pts, r0, d0, collar, spec);
}

function makeBranch(id, kind, pts, r0, d0, collar, extra = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return { id, kind, curve, length: curve.getLength(), r0, d0, collar, front: !!extra.front, children: 0 };
}

// The three FORK_BRANCHES. The contract: the deck rests on them, so the TOP of each branch must
// sit 0.3-0.45 m under PLATFORM.y along the whole deck span. We therefore place the centreline at
//   y(d) = top(d) - radius(d)
// where top(d) is nearly constant (a faint wave so it does not look machined), then lift the last
// 7 percent beyond the deck. Near the trunk the centreline blends from the contract start height.
const FORK_GAP = [0.34, 0.4, 0.44];
function growForkBranch(noise, spec, i) {
  const L = spec.length;
  const c = trunkCenter(spec.y);
  const b = {
    id: 100 + i,
    kind: "fork",
    r0: spec.radius,
    d0: trunkRadiusAt(spec.y) * 0.95,
    collar: 0.55,
    children: 0,
    front: false,
  };
  const az0 = spec.azimuthDeg * DEG;
  const tiltRad = spec.tiltDeg * DEG;
  const pts = [];
  const N = 9;
  for (let k = 0; k <= N; k++) {
    const d = (L * k) / N;
    const rr = branchRadius(b, d / L, d);
    let top = PLATFORM.y - FORK_GAP[i] + 0.03 * Math.sin(1.9 * d + i * 2.1);
    const over = Math.max(0, d - L * 0.93);
    top += over * Math.tan(tiltRad * 2.4) + 0.22 * over * over;
    const y = mix(spec.y, top - rr, smoothstep(0, 0.9, d));
    const yaw = az0 + 0.05 * noise.perlin2(i * 9.1 + 0.2, d * 0.6);
    pts.push(new V3(c.x + Math.cos(yaw) * d, y, c.z + Math.sin(yaw) * d));
  }
  b.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  b.length = b.curve.getLength();
  return b;
}

// Upper limbs (y 11.7 to 15.8). Tilt is at least 34 degrees so every limb climbs clear of the
// cabin envelope (CABIN_BOX top 12.9) within the first couple of metres.
const UPPER = [
  { y: 11.7, az: 193, tilt: 42, len: 6.2, r: 0.25 },
  { y: 12.0, az: 18, tilt: 50, len: 5.6, r: 0.25 },
  { y: 12.4, az: 252, tilt: 38, len: 6.6, r: 0.25 },
  { y: 13.3, az: 142, tilt: 50, len: 5.2, r: 0.18 },
  { y: 13.0, az: 296, tilt: 34, len: 6.4, r: 0.18 },
  { y: 14.2, az: 326, tilt: 44, len: 5.2, r: 0.17 },
  { y: 14.9, az: 64, tilt: 56, len: 4.6, r: 0.15 },
  { y: 15.8, az: 222, tilt: 56, len: 4.0, r: 0.13 },
];

// Side limbs: heavy oak limbs that leave the trunk UNDER the deck, run out beyond the cabin
// envelope, then curl up (large uplift) to carry leaf mass beside and behind the treehouse.
const SIDE = [
  { y: 7.0, az: 12, tilt: 8, len: 7.6, r: 0.27, uplift: 1.8 },
  { y: 7.6, az: 181, tilt: 10, len: 9.4, r: 0.3, uplift: 1.5 },
  { y: 7.0, az: 300, tilt: 12, len: 7.0, r: 0.26, uplift: 1.1 },
];

// Lower thin limbs. They stay under the deck (y < 8.4) while inside its footprint, then rise to
// hold leaf clusters in front of and to the left of the cabin (z 5 to 6.5, x -1 to -5).
const LOWER = [
  { y: 6.3, az: 112, tilt: 17, len: 6.2, r: 0.23, uplift: 0.35 },
  { y: 6.8, az: 76, tilt: 12, len: 5.4, r: 0.17, uplift: 0.4 },
  { y: 7.1, az: 148, tilt: 20, len: 6.4, r: 0.23, uplift: 0.3 },
  { y: 6.0, az: 126, tilt: 22, len: 5.2, r: 0.15, uplift: 0.3 },
  { y: 5.2, az: 176, tilt: 28, len: 5.6, r: 0.16, uplift: 0.25 },
];

// Broken branch stubs on the trunk: weathering detail, no leaves.
const STUBS = [
  { y: 3.4, az: 62, tilt: 24, len: 0.9, r: 0.11 },
  { y: 5.4, az: 215, tilt: 18, len: 1.1, r: 0.1 },
];

function createBranchSystem(noise, rng) {
  const branches = [];
  const swells = []; // trunk junction swells for the trunk geometry
  const anchors = []; // leaf cluster anchors
  const twigSources = [];

  const pushSwell = (y, azDeg, r0) => {
    swells.push({ y, az: azDeg * DEG, amp: (0.45 * r0) / trunkRadiusAt(y), h: 1.6 * r0 + 0.25, w: 1.5 * r0 + 0.25 });
  };
  const anchorsFor = (b, us, ws, spread, extra = {}) => {
    us.forEach((u, k) => {
      const p = b.curve.getPointAt(u);
      anchors.push({ p, w: ws[k] * wScale, spread, front: !!extra.front, scale: extra.scale ?? 1 });
    });
  };

  // wScale re-balances where the leaf budget goes: the upper limbs build the crown that frames the
  // top of the shot, the big left side limb gets less so it reads as a limb with leaves on it and
  // not as a leaf-covered tube.
  let wScale = 1;

  // forks
  FORK_BRANCHES.forEach((spec, i) => {
    const b = growForkBranch(noise, spec, i);
    branches.push(b);
    pushSwell(spec.y, spec.azimuthDeg, spec.radius);
    anchorsFor(b, [0.8, 1.0], [0.5, 0.9], 1.1);
    twigSources.push({ b, s: 0.9, count: 1 });
  });

  // sub-branches grown off a parent at fractions along it
  const growSubs = (parent, count, idBase, climb = 0, front = false) => {
    for (let k = 0; k < count; k++) {
      const s = 0.36 + k * 0.24 + range(rng, -0.04, 0.04);
      const origin = parent.curve.getPointAt(s);
      const T = parent.curve.getTangentAt(s);
      const yawP = Math.atan2(T.z, T.x) / DEG;
      const pitchP = Math.asin(clamp(T.y, -1, 1)) / DEG;
      const side = (k % 2 === 0 ? 1 : -1) * (rng() < 0.2 ? -1 : 1);
      const parentR = branchRadius(parent, s, s * parent.length);
      const sub = growBranch(noise, {
        id: idBase + k,
        kind: "sub",
        origin,
        az: yawP + side * range(rng, 28, 58),
        tilt: pitchP + range(rng, -4, 22) + climb,
        length: parent.length * range(rng, 0.4, 0.55) * (1 - 0.4 * s),
        r0: parentR * 0.6,
        droop: 0.1,
        uplift: 0.25,
        d0: 0,
        collar: 0.4,
      });
      branches.push(sub);
      parent.children++;
      sub.front = front;
      anchorsFor(sub, [0.45, 0.65, 0.85, 1.0], [0.5, 0.8, 1.1, 1.4], front ? 1.0 : 1.4, front ? { front: true, scale: 0.85 } : {});
      twigSources.push({ b: sub, s: 0.92, count: 1 });
    }
  };

  wScale = 1.7;
  UPPER.forEach((spec, i) => {
    const origin = trunkCenter(spec.y);
    const b = growBranch(noise, {
      id: 10 + i,
      kind: "upper",
      origin,
      az: spec.az,
      tilt: spec.tilt,
      length: spec.len,
      r0: spec.r,
      droop: 0.08,
      uplift: 0.15,
      d0: trunkRadiusAt(spec.y) * 0.9,
      collar: 0.5,
    });
    branches.push(b);
    pushSwell(spec.y, spec.az, spec.r);
    anchorsFor(b, [0.35, 0.62, 0.8, 1.0], [0.3, 0.5, 0.9, 1.4], 1.5);
    growSubs(b, 2, 200 + i * 5);
  });

  wScale = 0.5;
  SIDE.forEach((spec, i) => {
    const origin = trunkCenter(spec.y);
    const b = growBranch(noise, {
      id: 80 + i,
      kind: "upper",
      origin,
      az: spec.az,
      tilt: spec.tilt,
      length: spec.len,
      r0: spec.r,
      droop: 0.14,
      uplift: spec.uplift,
      d0: trunkRadiusAt(spec.y) * 0.9,
      collar: 0.55,
    });
    branches.push(b);
    pushSwell(spec.y, spec.az, spec.r);
    anchorsFor(b, [0.5, 0.7, 0.86, 1.0], [0.4, 0.7, 1.0, 1.4], 1.5);
    growSubs(b, 2, 300 + i * 5, 14);
  });

  wScale = 0.8;
  LOWER.forEach((spec, i) => {
    const origin = trunkCenter(spec.y);
    const b = growBranch(noise, {
      id: 40 + i,
      kind: "lower",
      origin,
      az: spec.az,
      tilt: spec.tilt,
      length: spec.len,
      r0: spec.r,
      droop: 0.22,
      uplift: spec.uplift,
      wobble: 0.45,
      d0: trunkRadiusAt(spec.y) * 0.9,
      collar: 0.6,
      front: true,
    });
    branches.push(b);
    pushSwell(spec.y, spec.az, spec.r);
    anchorsFor(b, [0.34, 0.5, 0.68, 0.84, 1.0], [0.3, 0.5, 0.7, 0.9, 1.1], 0.95, { front: true, scale: 0.85 });
    growSubs(b, 1, 400 + i * 5, 6, true);
    twigSources.push({ b, s: 0.7, count: 1 });
    twigSources.push({ b, s: 0.9, count: 1 });
  });

  STUBS.forEach((spec, i) => {
    const origin = trunkCenter(spec.y);
    const b = growBranch(noise, {
      id: 60 + i,
      kind: "stub",
      origin,
      az: spec.az,
      tilt: spec.tilt,
      length: spec.len,
      r0: spec.r,
      droop: 0.05,
      uplift: 0,
      d0: trunkRadiusAt(spec.y) * 0.9,
      collar: 0.6,
    });
    branches.push(b);
    pushSwell(spec.y, spec.az, spec.r);
  });

  wScale = 1;
  // leader: the trunk top carries a leaf mass of its own
  const top = trunkCenter(TREE.height - 0.5);
  anchors.push({ p: top, w: 2.4, spread: 2.2, front: false, scale: 1 });
  anchors.push({ p: trunkCenter(TREE.height + 2.2), w: 1.4, spread: 1.9, front: false, scale: 1 });

  return { branches, swells, anchors, twigSources };
}

function addBranch(acc, noise, b) {
  const t = KIND_TUBE[b.kind];
  const colorAt = (ctx, out) => {
    const p = ctx.pos;
    const shade = 0.5 - 0.5 * (ctx.dir.x * SUN_XZ.x + ctx.dir.z * SUN_XZ.y);
    const mn = 0.5 + 0.5 * noise.simplex3(p.x * 0.6 + 7, p.y * 0.4, p.z * 0.6);
    // moss gathers on the shaded flank and on the upper side of near-horizontal limbs
    const moss = 0.1 * (0.4 + shade) * (0.4 + mn) + 0.1 * smoothstep(0.2, 0.9, ctx.dUp) * mn;
    return tintBark(out, p.y, shade, ctx.aux, moss, 0);
  };
  const radiusAt = (ctx) => {
    const cx = Math.cos(ctx.theta);
    const sz = Math.sin(ctx.theta);
    const knob = noise.simplex3(cx * 1.4 + b.id * 3.1, sz * 1.4, ctx.dist * 0.8);
    const fine = noise.simplex3(cx * 4 + b.id, sz * 4 + 9, ctx.dist * 3);
    ctx.aux = clamp(0.4 - fine * 0.6, 0, 1);
    return branchRadius(b, ctx.u, ctx.dist) * (1 + 0.05 * knob + 0.02 * fine);
  };
  addTube(acc, b.curve, { ...t, radiusAt, colorAt });
}

// Thin twigs: 3 rings x 5 sides each. They end where leaf clusters hang.
function createTwigs(acc, noise, rng, sources, anchors) {
  sources.forEach((src, idx) => {
    const { b, s } = src;
    const origin = b.curve.getPointAt(s);
    const T = b.curve.getTangentAt(s);
    const yaw0 = Math.atan2(T.z, T.x);
    const pitch0 = Math.asin(clamp(T.y, -1, 1));
    const side = idx % 2 === 0 ? 1 : -1;
    const yaw = yaw0 + side * range(rng, 0.35, 0.9);
    const pitch = pitch0 + range(rng, -0.25, 0.35);
    const len = range(rng, 0.9, 1.5);
    const pts = [origin.clone()];
    const p = origin.clone();
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const yw = yaw + 0.3 * noise.perlin2(idx * 2.7 + 0.4, t * 2);
      const pt = pitch - 0.35 * t + 0.25 * noise.perlin2(idx * 2.1 + 9, t * 2); // droops toward the tip
      p.x += Math.cos(yw) * Math.cos(pt) * (len / n);
      p.y += Math.sin(pt) * (len / n);
      p.z += Math.sin(yw) * Math.cos(pt) * (len / n);
      pts.push(p.clone());
    }
    const parentR = branchRadius(b, s, s * b.length);
    const r0 = Math.max(0.025, parentR * 0.45);
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    addTube(acc, curve, {
      rings: 3,
      radial: 5,
      uRepeat: 1,
      radiusAt: (ctx) => {
        ctx.aux = 0.2;
        return r0 * (0.2 + 0.8 * (1 - ctx.u));
      },
      colorAt: (ctx, out) => tintBark(out, ctx.pos.y, 0.4, 0.2, 0.04, 0),
      cap: true,
    });
    anchors.push({ p: p.clone(), w: 0.9, spread: 0.85, front: !!b.front, scale: b.front ? 0.85 : 1 });
  });
}

// ------------------------------------------------------------------------------------------------
// Canopy instances
// ------------------------------------------------------------------------------------------------
const LEAF_DARK = new THREE.Color(0.26, 0.37, 0.32); // interior leaves: deep, cool blue-green shade
const LEAF_LIT = new THREE.Color(1.12, 1.2, 0.88); // outer shell leaves: sun-touched, warm sage
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new V3();

function buildLeafInstances(anchors, rng) {
  const totalW = anchors.reduce((acc, a) => acc + a.w, 0);
  const pick = () => {
    let r = rng() * totalW;
    for (let i = 0; i < anchors.length; i++) {
      r -= anchors[i].w;
      if (r <= 0) return anchors[i];
    }
    return anchors[anchors.length - 1];
  };
  const sets = {
    oak: { matrices: [], colors: [] },
    sprig: { matrices: [], colors: [] },
  };
  const count = { oak: 0, sprig: 0 };
  const jitter = new V3();
  const p = new V3();
  const out = new V3();
  const dirv = new V3();
  const tmp = new V3();
  const col = new THREE.Color();
  const clumpNoise = createNoise(913);
  let attempts = 0;

  while ((count.oak < LEAF_TARGET.oak || count.sprig < LEAF_TARGET.sprig) && attempts < 140000) {
    attempts++;
    const a = pick();
    // random point in a vertically squashed ball around the anchor
    randInSphere(rng, tmp);
    tmp.set(tmp.x, tmp.y * 0.75, tmp.z).multiplyScalar(a.spread);
    // push outward: leaves sit on the outside of the twig bundle, not in its middle
    if (a.front) out.set(a.p.x - trunkOffsetX(a.p.y), 0, a.p.z - trunkOffsetZ(a.p.y)).normalize();
    else out.copy(a.p).sub(CROWN.center).normalize();
    p.copy(a.p).add(tmp).addScaledVector(out, a.spread * 0.25);

    // keep the cabin envelope clear (cards are about 1.5 m across, so keep a margin)
    if (CABIN_BOX.distanceToPoint(p) < 0.6) continue;
    if (rng() < 0.9 * viewCorridor(p, tmp)) continue;
    // Foliage grows in clumps with air between them (low frequency noise), so the canopy reads as
    // many separate leaf masses and gaps instead of one continuous hedge.
    const clump = smoothstep(-0.05, 0.4, clumpNoise.simplex3(p.x * 0.55, p.y * 0.6, p.z * 0.55));
    if (rng() > mix(a.front ? 0.3 : 0.18, 1, clump)) continue;
    // sky and sun gaps
    let inGap = false;
    if (!a.front) {
      for (let g = 0; g < GAPS.length; g++) {
        if (p.distanceTo(GAPS[g].c) < GAPS[g].r) {
          inGap = true;
          break;
        }
      }
    }
    if (inGap) continue;
    if (p.y < localGround(p.x, p.z) + 3) continue;

    // ellipsoid radius: < 0.5 interior, > 0.9 outer shell
    const u = tmp
      .copy(p)
      .sub(CROWN.center)
      .divide(CROWN.radii)
      .length();
    const outer = smoothstep(0.5, 1.0, u);
    if (!a.front) {
      let accept = mix(0.25, 1, outer);
      // thinner foliage on the camera side of the lower crown so light filters through
      const frontness = smoothstep(1, 6.5, p.z) * smoothstep(5, 9, p.y) * (1 - smoothstep(14, 17, p.y));
      accept *= 1 - 0.45 * frontness;
      if (rng() > accept) continue;
    }

    // choose kind: small-leaf sprig gets the very edge (fine ragged silhouette), oak the body
    const pOak = a.front ? 0.5 : mix(0.68, 0.38, smoothstep(0.8, 1.05, u));
    let kind = rng() < pOak ? "oak" : "sprig";
    if (count[kind] >= LEAF_TARGET[kind]) kind = kind === "oak" ? "sprig" : "oak";
    if (count[kind] >= LEAF_TARGET[kind]) continue;

    // orientation: card up-axis follows the outward direction with some gravity droop, then a
    // random spin. The cluster normals are spherical, so shading stays soft whatever the spin.
    dirv.copy(out).add(jitter.set(range(rng, -0.55, 0.55), range(rng, -0.55, 0.45) - 0.25, range(rng, -0.55, 0.55))).normalize();
    _q1.setFromUnitVectors(UP, dirv);
    _q2.setFromAxisAngle(UP, rng() * TAU);
    _q1.multiply(_q2);
    const sc = (kind === "oak" ? 1 : 0.9) * range(rng, 0.78, 1.28) * a.scale;
    _s.set(sc, sc * range(rng, 0.9, 1.1), sc);
    _m.compose(p, _q1, _s);
    sets[kind].matrices.push(..._m.elements);

    // colour: dark interior to lit shell, a little hue and value drift, rare dead leaves
    const top = clamp((p.y - (CROWN.center.y - CROWN.radii.y)) / (2 * CROWN.radii.y), 0, 1);
    let e = a.front ? 0.55 + 0.3 * rng() : clamp(0.15 + 0.55 * outer + 0.2 * top + 0.15 * rng(), 0, 1);
    // Sun side of the crown is brighter and warmer, the far side sinks into cool shade. The
    // canopy does not receive shadows (see CANOPY_RECEIVES_SHADOW), so this baked sky-visibility
    // term is what gives the mass bright sunlit tops and deep blue-green undersides.
    e = clamp(e + 0.26 * out.dot(SUN_VEC), 0, 1);
    col.copy(LEAF_DARK).lerp(LEAF_LIT, e);
    const v = range(rng, 0.9, 1.1);
    col.r *= v * range(rng, 0.94, 1.08);
    col.g *= v;
    col.b *= v * range(rng, 0.92, 1.08);
    const dead = rng();
    if (dead < 0.045) col.setRGB(col.r * 1.45, col.g * 1.15, col.b * 0.5); // yellow olive
    else if (dead < 0.065) col.setRGB(col.r * 1.1, col.g * 0.62, col.b * 0.35); // rusty brown
    sets[kind].colors.push(col.r, col.g, col.b);
    count[kind]++;
  }
  return {
    oak: { matrices: new Float32Array(sets.oak.matrices), colors: new Float32Array(sets.oak.colors), count: count.oak },
    sprig: { matrices: new Float32Array(sets.sprig.matrices), colors: new Float32Array(sets.sprig.colors), count: count.sprig },
  };
}

// ------------------------------------------------------------------------------------------------
// Everything at once. Exported so the build can be inspected or reused (pure, no textures).
// ------------------------------------------------------------------------------------------------
export function buildTreeData() {
  const rng = createRng(1017);
  const noise = createNoise(41);
  const system = createBranchSystem(noise, rng);

  const trunkAcc = createAccumulator();
  addTrunk(trunkAcc, noise, system.swells);

  const rootAcc = createAccumulator();
  addRoots(rootAcc, noise);

  const branchAcc = createAccumulator();
  system.branches.forEach((b) => addBranch(branchAcc, noise, b));

  const twigAcc = createAccumulator();
  createTwigs(twigAcc, noise, rng, system.twigSources, system.anchors);

  const leaves = buildLeafInstances(system.anchors, createRng(2077));
  const tri = (acc) => acc.idx.length / 3;
  const stats = {
    trunk: tri(trunkAcc),
    roots: tri(rootAcc),
    branches: tri(branchAcc),
    twigs: tri(twigAcc),
    leafClusters: leaves.oak.count + leaves.sprig.count,
    leafCards: (leaves.oak.count + leaves.sprig.count) * 3,
    leafTriangles: (leaves.oak.count + leaves.sprig.count) * 6,
  };
  stats.wood = stats.trunk + stats.roots + stats.branches + stats.twigs;
  stats.total = stats.wood + stats.leafTriangles;

  return {
    trunk: accumulatorToGeometry(trunkAcc),
    roots: accumulatorToGeometry(rootAcc),
    branches: accumulatorToGeometry(branchAcc),
    twigs: accumulatorToGeometry(twigAcc),
    leaves,
    stats,
  };
}

// ------------------------------------------------------------------------------------------------
// React components
// ------------------------------------------------------------------------------------------------
function WoodMesh({ geometry, material }) {
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

const Trunk = ({ geometry, material }) => <WoodMesh geometry={geometry} material={material} />;
const Roots = ({ geometry, material }) => <WoodMesh geometry={geometry} material={material} />;
const Branches = ({ geometry, material }) => <WoodMesh geometry={geometry} material={material} />;
const Twigs = ({ geometry, material }) => <WoodMesh geometry={geometry} material={material} />;

function LeafMesh({ set, geometry, material, depthMaterial }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < set.count; i++) {
      mesh.setMatrixAt(i, m.fromArray(set.matrices, i * 16));
      mesh.setColorAt(i, c.fromArray(set.colors, i * 3));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [set]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, set.count]}
      customDepthMaterial={depthMaterial}
      castShadow
      receiveShadow={CANOPY_RECEIVES_SHADOW}
    />
  );
}

function Canopy({ leaves }) {
  const resources = useMemo(() => {
    const oakTex = createLeafCardTexture({ kind: "oak", seed: 3 });
    const sprigTex = createLeafCardTexture({ kind: "sprig", seed: 5 });
    // backlit glow colour: soft leaf green pulled toward the warm light, so the rim reads as sun
    // coming through the leaf rather than as a neon green
    const glow = new THREE.Color(BRAND.greenLight).lerp(new THREE.Color(BRAND.warmLight), 0.35);
    // translucency strength was tuned for a key light of about 2.5
    const translucency = clamp(0.6 * (2.5 / LIGHT.keyIntensity), 0.8, 1.1);
    const make = (tex, width, seed) => ({
      geometry: buildLeafClusterGeometry({
        cards: 3,
        width,
        height: width,
        bend: 0.15,
        segments: [1, 1], // flat cards: 2 triangles each, 6 per cluster
        normalBlend: 0.65, // more leaf-scale shading, less balloon
        pivot: "center",
        seed,
      }),
      material: makeFoliageMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        translucency,
        roughness: 0.72,
        normalScale: 0.8,
        transmissionColor: glow,
        wind: WIND,
      }),
      depth: makeFoliageDepthMaterial({ map: tex.map, alphaTest: 0.5, wind: WIND }),
    });
    return { oak: make(oakTex, 1.5, 11), sprig: make(sprigTex, 1.3, 12) };
  }, []);

  useEffect(
    () => () => {
      [resources.oak, resources.sprig].forEach((r) => {
        r.geometry.dispose();
        r.material.dispose();
        r.depth.dispose();
      });
    },
    [resources]
  );

  // The shared wind clock (FOLIAGE_WIND.uTime) has a single writer, HeroScene's WindClock, which
  // freezes it for prefers-reduced-motion. Do not write it here.

  return (
    <group>
      <LeafMesh set={leaves.oak} geometry={resources.oak.geometry} material={resources.oak.material} depthMaterial={resources.oak.depth} />
      <LeafMesh set={leaves.sprig} geometry={resources.sprig.geometry} material={resources.sprig.material} depthMaterial={resources.sprig.depth} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------
// Tree (default export, no props)
// ------------------------------------------------------------------------------------------------
export default function Tree() {
  const data = useMemo(() => buildTreeData(), []);

  // One bark material shared by trunk, roots, branches and twigs. R = ambient occlusion and
  // G = roughness live in the same map, so it feeds both aoMap and roughnessMap.
  const barkMaterial = useMemo(() => {
    const bark = createBarkTextures({ seed: 7 });
    return new THREE.MeshStandardMaterial({
      map: bark.map,
      normalMap: bark.normalMap,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: bark.roughnessMap,
      aoMap: bark.roughnessMap,
      aoMapIntensity: 1,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
  }, []);

  useEffect(
    () => () => {
      data.trunk.dispose();
      data.roots.dispose();
      data.branches.dispose();
      data.twigs.dispose();
    },
    [data]
  );
  useEffect(() => () => barkMaterial.dispose(), [barkMaterial]);

  return (
    <group name="hero-tree" position={[TREE.x, 0, TREE.z]} userData={{ stats: data.stats }}>
      <Trunk geometry={data.trunk} material={barkMaterial} />
      <Roots geometry={data.roots} material={barkMaterial} />
      <Branches geometry={data.branches} material={barkMaterial} />
      <Twigs geometry={data.twigs} material={barkMaterial} />
      <Canopy leaves={data.leaves} />
    </group>
  );
}
