// Geometry builders for the approach trunks. Pure three.js maths (no canvas, no React).
//
//   createAcc / accToGeometry     growable vertex arrays and the BufferGeometry made from them
//   addTrunkTube                  the trunk: a swept tube with organic radius, root flare, bark UVs, vertex
//                                 tint and the aWear attribute that drives moss, lichen and fresh wood
//   planStubs / addStub           snapped low branches: collar swell, bark flaps peeling back, a jagged,
//                                 splintered, pale fibrous end, dead twigs
//   addBranchTube                 any thin curved limb (crown limbs, the overhang spray branches)
//   planIvy                       ivy patches: card matrices, hugging runner stems, flowering umbels
//   buildFarTrunkGeometry         the one slim trunk geometry the far trunks instance
//
// Winding conventions are in the comments where they matter: they are what keeps faces from vanishing.

import * as THREE from "three";
import { range } from "@/lib/random";
import { clamp } from "@/lib/noise";
import { DEG, TAU, cameraDistance, shadeBark } from "./trunkMath";
import { IVY_LOOK, TRUNK_TUNING } from "./trunkTones";

const V3 = THREE.Vector3;

// ------------------------------------------------------------------------------------------------
// Accumulator
// ------------------------------------------------------------------------------------------------
export function createAcc() {
  return { pos: [], nor: [], uv: [], col: [], wear: [], idx: [] };
}
export const accTriangles = (acc) => acc.idx.length / 3;
export const accHasData = (acc) => acc.idx.length > 0;

export function accToGeometry(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
  g.setAttribute("aWear", new THREE.Float32BufferAttribute(acc.wear, 4));
  g.setIndex(acc.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function pushV(acc, p, n, u, v, tint, wear) {
  acc.pos.push(p.x, p.y, p.z);
  acc.nor.push(n.x, n.y, n.z);
  acc.uv.push(u, v);
  acc.col.push(tint[0], tint[1], tint[2]);
  acc.wear.push(wear[0], wear[1], wear[2], wear[3]);
  return acc.pos.length / 3 - 1;
}

// ------------------------------------------------------------------------------------------------
// THE TRUNK
// ------------------------------------------------------------------------------------------------
// rings are heights above the trunk's ground (first one below ground). radial is the vertex count round.
// Winding: the ring parameter theta runs from +X toward +Z, so round the trunk we go +X -> +Z while
// climbing +Y, and (up) x (round) = outward. Quads are (v0, v2, v1) and (v1, v2, v3) with v0 = (ring i,
// vertex j), v1 = (i, j+1), v2 = (i+1, j), v3 = (i+1, j+1).
export function addTrunkTube(acc, model, rings, radial, rng) {
  const nR = rings.length;
  const stride = radial + 1; // the last vertex of a ring repeats the first (UV seam)
  const P = new Float32Array(nR * stride * 3);
  const tmp = new V3();
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j <= radial; j++) {
      model.pointAt(rings[i], (j / radial) * TAU, tmp);
      const k = (i * stride + j) * 3;
      P[k] = tmp.x;
      P[k + 1] = tmp.y;
      P[k + 2] = tmp.z;
    }
  }
  // normals from the vertex grid: cross of the central differences, wrapping round the ring
  const get = (i, j, out) => {
    const k = (i * stride + (j % radial)) * 3;
    return out.set(P[k], P[k + 1], P[k + 2]);
  };
  const a = new V3();
  const b = new V3();
  const t1 = new V3();
  const t2 = new V3();
  const n = new V3();
  const N = new Float32Array(P.length);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j <= radial; j++) {
      const jj = j % radial;
      a.subVectors(get(i, (jj + 1) % radial, t1), get(i, (jj - 1 + radial) % radial, t2)); // round
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, nR - 1);
      b.subVectors(get(i1, jj, t1), get(i0, jj, t2)); // up
      n.crossVectors(b, a).normalize();
      const th = (j / radial) * TAU;
      if (n.x * Math.cos(th) + n.z * Math.sin(th) < 0) n.negate(); // never point into the trunk
      const k = (i * stride + j) * 3;
      N[k] = n.x;
      N[k + 1] = n.y;
      N[k + 2] = n.z;
    }
  }

  // UVs: U wraps round the trunk an integer number of times (invisible seam); V is the integral of
  // uRepeat * ds / circumference so a bark tile stays about square as the trunk tapers and flares.
  const uRep = Math.max(1, Math.round((TAU * model.r * 1.1) / model.sp.tileW));
  const u0 = rng();
  const v0 = rng();
  const c0 = new V3();
  const c1 = new V3();
  let prevR = 0;
  let vAcc = 0;
  const tint = [1, 1, 1];
  const wear = [0, 0, 0, 0];
  const normal = new V3();
  const pos = new V3();
  const base = acc.pos.length / 3;
  let meanR = 0;
  for (let i = 0; i < nR; i++) {
    model.centre(rings[i], c1);
    let sumR = 0;
    for (let j = 0; j < radial; j++) {
      const k = (i * stride + j) * 3;
      sumR += Math.hypot(P[k] - c1.x, P[k + 2] - c1.z);
    }
    meanR = sumR / radial;
    if (i > 0) vAcc += (uRep * c1.distanceTo(c0)) / (TAU * Math.max(0.5 * (meanR + prevR), 0.05));
    c0.copy(c1);
    prevR = meanR;
    for (let j = 0; j <= radial; j++) {
      const k = (i * stride + j) * 3;
      pos.set(P[k], P[k + 1], P[k + 2]);
      normal.set(N[k], N[k + 1], N[k + 2]);
      shadeBark(model, rings[i], normal.x, normal.z, tint, wear);
      pushV(acc, pos, normal, (j / radial) * uRep + u0, vAcc + v0, tint, wear);
    }
  }
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const v0i = base + i * stride + j;
      const v1i = v0i + 1;
      const v2i = v0i + stride;
      const v3i = v2i + 1;
      acc.idx.push(v0i, v2i, v1i, v1i, v2i, v3i);
    }
  }
  // closing cone over the top ring (the crown leaves hide it; this just means no open tube)
  model.centre(rings[nR - 1], c1);
  const apexPos = new V3(c1.x, c1.y + meanR * 0.45, c1.z);
  shadeBark(model, rings[nR - 1], 0, 0, tint, wear);
  const apex = pushV(acc, apexPos, new V3(0, 1, 0), u0 + uRep * 0.5, vAcc + v0 + 0.1, tint, wear);
  for (let j = 0; j < radial; j++) {
    const vi = base + (nR - 1) * stride + j;
    acc.idx.push(vi, apex, vi + 1); // (v0, apex, v1): outward, same sense as the side quads
  }
}

// ------------------------------------------------------------------------------------------------
// FRAMES for tubes that run along an arbitrary axis: E1 x E2 = axis (right handed)
// ------------------------------------------------------------------------------------------------
function frameOf(axis, e1Out, e2Out) {
  const ref = Math.abs(axis.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  e1Out.crossVectors(ref, axis).normalize();
  e2Out.crossVectors(axis, e1Out);
}

// Tube winding along +axis with phi from E1 toward E2: quad (v0, v1, v2) and (v1, v3, v2) face outward.
// (phi-hat) x (axis) = outward when (E1, E2, axis) is right handed.

// ------------------------------------------------------------------------------------------------
// BROKEN BRANCH STUBS
// ------------------------------------------------------------------------------------------------
// Direction of a stub's axis (the same formula addStub uses).
function stubAxis(yaw, pitch, out = new V3()) {
  return out.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
}

// A stub must never reach into the walker's weave tube (the camera passes close to the close trunks, and
// a snapped limb at head height pointing at the path would be in the lens). Each candidate is tested at
// its tip and midpoint: neither may be closer to the camera than TRUNK_TUNING.stubClearance, nor closer
// than the stub's own root already is (so a stub pointing sideways or away is always fine).
function stubClear(model, st) {
  const base = model.pointAt(st.h, st.theta, new V3());
  const D = stubAxis(st.yaw, st.pitch);
  const rootD = cameraDistance(base.x, base.y, base.z);
  // the tip and the twigs that grow off the shaft reach a little beyond the points tested: a margin of 12 cm
  const need = Math.min(Math.max(TRUNK_TUNING.stubClearance, rootD - 0.02) + 0.12, 1.0);
  for (const k of [0.5, 1.0, 1.25]) {
    const p = base.clone().addScaledVector(D, st.L * k);
    if (cameraDistance(p.x, p.y, p.z) < need) return false;
  }
  return true;
}

export function planStubs(model, count, rng) {
  const close = model.spec.cls === "close";
  const out = [];
  const hs = [];
  let tries = 0;
  while (out.length < count && tries++ < 60) {
    const h = range(rng, 0.65, 3.0);
    if (hs.some((x) => Math.abs(x - h) < 0.5)) continue;
    // a few candidates per stub: the first that clears the walker wins (mostly on the side the walker sees)
    let st = null;
    for (let a = 0; a < 10 && !st; a++) {
      const spread = (close ? 1.3 : 2.1) + 0.12 * a; // widens when the path side is too tight
      const theta = model.spec.pathTheta + range(rng, -spread, spread);
      const rb = range(rng, 0.032, 0.078) * (0.75 + 0.5 * model.r);
      const cand = {
        h,
        theta,
        pitch: range(rng, -14, 38) * DEG,
        yaw: theta + range(rng, -0.28, 0.28) + (a >= 3 ? (rng() < 0.5 ? -1 : 1) * range(rng, 0.4, 1.1) : 0),
        L: (close ? range(rng, 0.5, 1.1) : range(rng, 0.32, 0.92)) * (a >= 5 ? 0.7 : 1),
        rb,
        flaps: close ? 2 : rb > 0.05 ? 1 : 0,
        twigs: 2 + Math.floor(rng() * 2),
        lichen: rng() < 0.36,
        ivyStrand: false,
        high: close,
      };
      if (stubClear(model, cand)) st = cand;
    }
    if (!st) continue; // nowhere to put this one without poking the walker: leave the trunk with one fewer
    hs.push(h);
    out.push(st);
  }
  return out;
}

// Make every triangle of acc from firstTriangle on agree with its vertex normals. The splintered ends are
// built from ragged rings whose winding can flip where a long splinter sits beside a short one; flipping
// the odd triangle (rather than drawing both sides) keeps the bark flaps, whose back faces carry their own
// opposite normals, from z fighting.
export function orientToNormals(acc, firstTriangle = 0) {
  const A = new V3();
  const B = new V3();
  const C = new V3();
  const n = new V3();
  const vn = new V3();
  for (let t = firstTriangle; t < acc.idx.length / 3; t++) {
    const a = acc.idx[t * 3];
    const b = acc.idx[t * 3 + 1];
    const c = acc.idx[t * 3 + 2];
    A.fromArray(acc.pos, a * 3);
    B.fromArray(acc.pos, b * 3);
    C.fromArray(acc.pos, c * 3);
    n.crossVectors(B.sub(A), C.sub(A));
    vn.set(
      acc.nor[a * 3] + acc.nor[b * 3] + acc.nor[c * 3],
      acc.nor[a * 3 + 1] + acc.nor[b * 3 + 1] + acc.nor[c * 3 + 1],
      acc.nor[a * 3 + 2] + acc.nor[b * 3 + 2] + acc.nor[c * 3 + 2],
    );
    if (n.dot(vn) < 0) {
      acc.idx[t * 3 + 1] = c;
      acc.idx[t * 3 + 2] = b;
    }
  }
}

const wearScratch = [0, 0, 0, 0];
const tintScratch = [1, 1, 1];

// Builds one stub into `acc`. Returns { base, tip, dir, up } for skirts and strands.
export function addStub(acc, model, st, rng) {
  const N = st.high ? 7 : 6;
  const surf = model.surface(st.h, st.theta);
  const D = stubAxis(st.yaw, st.pitch);
  const base = surf.p.clone().addScaledVector(surf.n, -0.07); // buried: the stub grows out of the bark
  const E1 = new V3();
  const E2 = new V3();
  frameOf(D, E1, E2);
  const L = st.L;
  const rb = st.rb;

  // rings along the stub: collar swell at the trunk, (a middle ring on the big ones), the shaft end
  const rings = [{ a: 0, r: rb * 1.6, z: 0 }];
  if (st.high) rings.push({ a: L * 0.45, r: rb * 1.08, z: 0 });
  rings.push({ a: L, r: rb * 0.8, z: 0.35 });

  const uo = rng();
  const vo = rng();
  const stride = N + 1;
  const first = acc.pos.length / 3;
  const dirOut = new V3();
  const p = new V3();
  const n = new V3();
  const addRing = (a, r, zWood, slope) => {
    for (let j = 0; j <= N; j++) {
      const phi = (j / N) * TAU;
      dirOut.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
      const rr = r * (1 + 0.07 * Math.sin(phi * 3 + st.h * 9));
      p.copy(base).addScaledVector(D, a).addScaledVector(dirOut, rr);
      n.copy(dirOut).addScaledVector(D, -slope).normalize();
      shadeBark(model, st.h, n.x, n.z, tintScratch, wearScratch);
      // stubs are mossier on their upper side and carry less lichen
      wearScratch[0] = clamp(wearScratch[0] * 0.6 + 0.3 * Math.max(0, n.y), 0, 1);
      wearScratch[1] *= 0.6;
      wearScratch[2] = zWood;
      pushV(acc, p, n, (j / N) * 1 + uo, a / (TAU * rb) + vo, tintScratch, wearScratch);
    }
  };
  const nr = rings.length;
  rings.forEach((rg, k) => {
    const prev = rings[Math.max(0, k - 1)];
    const next = rings[Math.min(nr - 1, k + 1)];
    const slope = next.a > prev.a ? (next.r - prev.r) / (next.a - prev.a) : 0;
    addRing(rg.a, rg.r, rg.z, slope);
  });
  for (let k = 0; k < nr - 1; k++) {
    for (let j = 0; j < N; j++) {
      const v0 = first + k * stride + j;
      const v1 = v0 + 1;
      const v2 = v0 + stride;
      const v3 = v2 + 1;
      acc.idx.push(v0, v1, v2, v1, v3, v2);
    }
  }

  // the break: a jagged ring of splinters, alternately long and short, pulled toward the axis, pale wood
  const jagFirst = acc.pos.length / 3;
  const jag = [];
  for (let j = 0; j < N; j++) {
    const long = j % 2 === 0;
    jag.push({
      da: rb * (long ? range(rng, 0.9, 1.9) : range(rng, 0.18, 0.7)),
      shrink: long ? range(rng, 0.2, 0.42) : range(rng, 0.4, 0.7),
      dphi: range(rng, -0.18, 0.18),
    });
  }
  jag.push(jag[0]); // seam vertex
  for (let j = 0; j <= N; j++) {
    const jg = jag[j];
    const phi = (j / N) * TAU + jg.dphi;
    dirOut.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
    p.copy(base).addScaledVector(D, L + jg.da).addScaledVector(dirOut, rb * 0.8 * jg.shrink);
    n.copy(dirOut).multiplyScalar(0.55).addScaledVector(D, 0.85).normalize();
    shadeBark(model, st.h, n.x, n.z, tintScratch, wearScratch);
    wearScratch[2] = 1;
    wearScratch[0] *= 0.2;
    pushV(acc, p, n, (j / N) * 1 + uo, (L + jg.da) / (TAU * rb) + vo, tintScratch, wearScratch);
  }
  const lastRing = first + (nr - 1) * stride;
  for (let j = 0; j < N; j++) {
    const a0 = lastRing + j;
    const b0 = jagFirst + j;
    acc.idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
  }
  // apex: the central splinter, the longest point of the break
  const apexLen = L + rb * range(rng, 1.3, 2.3);
  p.copy(base).addScaledVector(D, apexLen).addScaledVector(E1, range(rng, -0.01, 0.01));
  shadeBark(model, st.h, D.x, D.z, tintScratch, wearScratch);
  wearScratch[2] = 1;
  const apex = pushV(acc, p, D, 0.5 + uo, apexLen / (TAU * rb) + vo, tintScratch, wearScratch);
  for (let j = 0; j < N; j++) acc.idx.push(jagFirst + j, jagFirst + j + 1, apex);

  // bark peeling back: flaps standing off the shaft near the break. Front = bark, back = pale inner bark.
  for (let f = 0; f < st.flaps; f++) {
    const a0 = L * range(rng, 0.5, 0.82);
    const phi0 = range(rng, 0, TAU);
    const dphi = range(rng, 0.45, 0.8);
    const len = range(rng, 0.1, 0.22) * (0.6 + L);
    const ang = range(rng, 0.6, 1.05); // how far it has curled off the shaft
    const rAt = rb * (1.0 - 0.2 * (a0 / L));
    const mk = (phi, along, lift, out) => {
      dirOut.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
      return out.copy(base).addScaledVector(D, along).addScaledVector(dirOut, rAt + lift);
    };
    const b0 = mk(phi0 - dphi, a0, 0.003, new V3());
    const b1 = mk(phi0 + dphi, a0, 0.003, new V3());
    const t0 = mk(phi0 - dphi * 0.75, a0 + len * Math.cos(ang) * 0.9, len * Math.sin(ang), new V3());
    const t1 = mk(phi0 + dphi * 0.75, a0 + len * Math.cos(ang) * 0.9, len * Math.sin(ang), new V3());
    // face normal, forced to point away from the shaft
    const fn = new V3().crossVectors(b1.clone().sub(b0), t0.clone().sub(b0)).normalize();
    dirOut.copy(E1).multiplyScalar(Math.cos(phi0)).addScaledVector(E2, Math.sin(phi0));
    if (fn.dot(dirOut) < 0) fn.negate();
    shadeBark(model, st.h, fn.x, fn.z, tintScratch, wearScratch);
    const tf = [tintScratch[0] * 0.8, tintScratch[1] * 0.8, tintScratch[2] * 0.8];
    // front face
    wearScratch[2] = 0;
    wearScratch[0] *= 0.3;
    const fa = pushV(acc, b0, fn, 0.1 + uo, 0.2 + vo, tf, wearScratch);
    const fb = pushV(acc, b1, fn, 0.45 + uo, 0.2 + vo, tf, wearScratch);
    const fc = pushV(acc, t0, fn, 0.12 + uo, 0.5 + vo, tf, wearScratch);
    const fd = pushV(acc, t1, fn, 0.43 + uo, 0.5 + vo, tf, wearScratch);
    // (b0, b1, t0): for the face normal fn = (b1 - b0) x (t0 - b0) this is the front-facing order
    // when fn is not flipped, and fn was flipped only if it pointed inward, so test the real winding
    const geo = new V3().crossVectors(b1.clone().sub(b0), t0.clone().sub(b0));
    if (geo.dot(fn) >= 0) acc.idx.push(fa, fb, fc, fb, fd, fc);
    else acc.idx.push(fa, fc, fb, fb, fc, fd);
    // back face: opposite winding, opposite normal, pale
    const bn = fn.clone().negate();
    wearScratch[2] = 0.75;
    const ba = pushV(acc, b0, bn, 0.1 + uo, 0.2 + vo, tf, wearScratch);
    const bb = pushV(acc, b1, bn, 0.45 + uo, 0.2 + vo, tf, wearScratch);
    const bc = pushV(acc, t0, bn, 0.12 + uo, 0.5 + vo, tf, wearScratch);
    const bd = pushV(acc, t1, bn, 0.43 + uo, 0.5 + vo, tf, wearScratch);
    if (geo.dot(fn) >= 0) acc.idx.push(ba, bc, bb, bb, bc, bd);
    else acc.idx.push(ba, bb, bc, bb, bd, bc);
  }

  // dead twigs: 3 triangle spikes (a three sided cone each) off the shaft
  for (let t = 0; t < st.twigs; t++) {
    const a = L * range(rng, 0.25, 0.95);
    const phi = range(rng, 0, TAU);
    dirOut.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
    const rr = rb * (1.05 - 0.2 * (a / L));
    const origin = base.clone().addScaledVector(D, a).addScaledVector(dirOut, rr * 0.8);
    const dir = D.clone()
      .multiplyScalar(range(rng, 0.4, 0.9))
      .addScaledVector(dirOut, range(rng, 0.5, 1.2))
      .add(new V3(0, range(rng, -0.25, 0.4), 0))
      .normalize();
    addTwig(acc, origin, dir, range(rng, 0.14, 0.42), range(rng, 0.006, 0.012), rng);
  }

  return { base, dir: D.clone(), L, tip: base.clone().addScaledVector(D, L), rb, E1, E2 };
}

// A thin dead twig: base ring of 3 vertices, one apex. 3 triangles.
export function addTwig(acc, origin, dir, len, r0, rng) {
  const E1 = new V3();
  const E2 = new V3();
  frameOf(dir, E1, E2);
  const first = acc.pos.length / 3;
  const tint = [0.86, 0.84, 0.82];
  const wear = [0, 0, 0, 0.35];
  const p = new V3();
  const n = new V3();
  const uo = rng();
  for (let j = 0; j < 3; j++) {
    const phi = (j / 3) * TAU + 0.4;
    const out = E1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
    p.copy(origin).addScaledVector(out, r0);
    n.copy(out).addScaledVector(dir, r0 / len).normalize();
    pushV(acc, p, n, j / 3 + uo, 0, tint, wear);
  }
  // the tip droops a little: dead twigs are brittle and bent
  p.copy(origin).addScaledVector(dir, len);
  p.y -= len * 0.08;
  const apex = pushV(acc, p, dir, 0.5 + uo, len / (TAU * r0 * 1.5), tint, wear);
  acc.idx.push(first, first + 1, apex, first + 1, first + 2, apex, first + 2, first, apex);
}

// ------------------------------------------------------------------------------------------------
// GENERIC THIN BRANCH TUBE (crown limbs, spray branches)
// ------------------------------------------------------------------------------------------------
// pts: Vector3 polyline, radii: radius per point. `model` supplies the species and the wear noise.
// heightOf(p) gives the height above ground used for the moss gradient.
export function addBranchTube(acc, model, pts, radii, radial, rng, { uRepeat = 1, mossBoost = 0.25 } = {}) {
  const n = pts.length;
  const stride = radial + 1;
  const first = acc.pos.length / 3;
  const T = new V3();
  const E1 = new V3();
  const E2 = new V3();
  const dirOut = new V3();
  const p = new V3();
  const nor = new V3();
  const tint = [1, 1, 1];
  const wear = [0, 0, 0, 0];
  const uo = rng();
  const vo = rng();
  let vAcc = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (i === 0) frameOf(T, E1, E2);
    else {
      E1.addScaledVector(T, -E1.dot(T)).normalize();
      E2.crossVectors(T, E1);
    }
    if (i > 0) vAcc += (uRepeat * pts[i].distanceTo(pts[i - 1])) / (TAU * Math.max(0.5 * (radii[i] + radii[i - 1]), 0.012));
    const slope = i < n - 1 ? (radii[i + 1] - radii[i]) / Math.max(pts[i + 1].distanceTo(pts[i]), 1e-4) : (radii[i] - radii[i - 1]) / Math.max(pts[i].distanceTo(pts[i - 1]), 1e-4);
    for (let j = 0; j <= radial; j++) {
      const phi = (j / radial) * TAU;
      dirOut.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
      p.copy(pts[i]).addScaledVector(dirOut, radii[i]);
      nor.copy(dirOut).addScaledVector(T, -slope).normalize();
      shadeBark(model, Math.max(0, pts[i].y - model.y0), nor.x, nor.z, tint, wear);
      wear[0] = clamp(wear[0] * 0.5 + mossBoost * Math.max(0, nor.y), 0, 1);
      pushV(acc, p, nor, (j / radial) * uRepeat + uo, vAcc + vo, tint, wear);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const v0 = first + i * stride + j;
      const v1 = v0 + 1;
      const v2 = v0 + stride;
      const v3 = v2 + 1;
      acc.idx.push(v0, v1, v2, v1, v3, v2);
    }
  }
  // end cone
  T.subVectors(pts[n - 1], pts[n - 2]).normalize();
  p.copy(pts[n - 1]).addScaledVector(T, radii[n - 1] * 1.6);
  shadeBark(model, Math.max(0, pts[n - 1].y - model.y0), T.x, T.z, tint, wear);
  const apex = pushV(acc, p, T, 0.5 + uo, vAcc + vo + 0.1, tint, wear);
  const lastRing = first + (n - 1) * stride;
  for (let j = 0; j < radial; j++) acc.idx.push(lastRing + j, lastRing + j + 1, apex);
}

// ------------------------------------------------------------------------------------------------
// IVY
// ------------------------------------------------------------------------------------------------
// Returns { cards, runners, umbels } for one trunk. Cards: { m: Matrix4 elements (16), c: [r, g, b] }.
// Cards are 1 x 1 planes with their pivot at the bottom edge centre (see trunkBuild), scaled to width x
// 1.25 width, stood 1 cm off the bark with the leaf tips lifting away. runners: arrays of ribbon points.
// umbels: { p: Vector3, s: size, c: [r, g, b] } (the flowering heads at the top of a mature patch).
//
// The ivy is grown VINE by VINE, the way it really climbs: each patch is a few sinuous woody stems that
// climb the bark in a lazy spiral (thick and brown at the foot, thin at the tip), with a short side shoot
// here and there, and the leaf sprigs sit ON the vines (denser low down, thinning toward the top, with
// bare bark between the clumps). So the leaves read as attached to stems, not as stickers.
const _m = new THREE.Matrix4();
const _X = new V3();
const _Y = new V3();
const _Z = new V3();
const _p = new V3();
const CARD_CLEAR = 0.42;

// One vine: points (h, theta) climbing from (h0, th0) to about h1, wandering sideways. Returns [{ h, th }].
function vinePath(rng, h0, th0, h1, wander, segs) {
  const pts = [];
  const ph = rng() * TAU;
  const drift = range(rng, -0.05, 0.05); // overall lean round the trunk per segment (radians)
  let th = th0;
  for (let k = 0; k <= segs; k++) {
    const h = h0 + ((h1 - h0) * k) / segs;
    pts.push({ h, th });
    // a lazy S plus jitter: ivy never climbs a ruler line
    th += drift + wander * Math.sin(k * 1.25 + ph) + range(rng, -0.05, 0.05);
  }
  return pts;
}

export function planIvy(model, cls, rng, { flowering = false } = {}) {
  const spec = model.spec;
  const close = cls === "close";
  const patches = close ? 2 : spec.r > 0.55 ? 2 : 1;
  const cards = [];
  const runners = [];
  const umbels = [];
  const W = TRUNK_TUNING.ivyCardWidth;
  const nPer = close ? TRUNK_TUNING.ivyCardsClose : TRUNK_TUNING.ivyCardsMid;
  const SEGS = 7; // ribbon segments per vine (each is 2 triangles: the runners cost as much as the leaves)
  for (let pi = 0; pi < patches; pi++) {
    const theta0 = spec.pathTheta + range(rng, -1.1, 1.1);
    const omega = range(rng, 0.4, 0.85); // angular half width of the patch
    const h0 = range(rng, 0.15, 1.2);
    const tall = flowering && pi === 0;
    const height = tall ? range(rng, 5.4, 6.4) : close ? range(rng, 2.2, 4.4) : range(rng, 2.4, 5.0);
    const nVines = (close ? 3 : 2) + (rng() < 0.5 ? 1 : 0) + (tall ? 1 : 0);
    const count = Math.round(nPer * range(rng, 0.8, 1.25) * (tall ? 1.15 : 1));
    const seed = rng() * 50;
    const vines = [];
    const tips = [];
    for (let v = 0; v < nVines; v++) {
      const hs = h0 + range(rng, -0.25, 0.2);
      const hEnd = h0 + height * range(rng, 0.62, 1.0);
      const vine = vinePath(rng, hs, theta0 + range(rng, -omega, omega) * 0.8, hEnd, range(rng, 0.05, 0.1), SEGS);
      const w0 = range(rng, 0.05, 0.078) * (close ? 1.1 : 1);
      vines.push({ pts: vine, w0 });
      tips.push(vine[SEGS]);
      // a short side shoot off the lower part of the vine, going out and up
      if (rng() < 0.7) {
        const k = 2 + Math.floor(rng() * 3);
        const root = vine[k];
        const dir = rng() < 0.5 ? -1 : 1;
        const shoot = vinePath(rng, root.h, root.th, root.h + range(rng, 0.7, 1.5), 0.04, 3).map((q, i) => ({ h: q.h, th: q.th + dir * 0.13 * i }));
        vines.push({ pts: shoot, w0: w0 * 0.55 });
      }
    }
    // runner ribbons: the vines themselves, hugging the bark 8 mm off it
    for (const vine of vines) {
      const n = vine.pts.length;
      runners.push(
        vine.pts.map((q, k) => {
          const surf = model.surface(q.h, q.th);
          const t = k / Math.max(1, n - 1);
          return { p: surf.p.clone().addScaledVector(surf.n, 0.008), n: surf.n, up: surf.up, w: vine.w0 * (1 - 0.62 * t) };
        }),
      );
    }
    // leaf sprigs on the vines: pick a point along a random vine (lower points more likely), a little off the stem
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < count * 10) {
      const vine = vines[Math.floor(rng() * vines.length)];
      const n = vine.pts.length;
      const u = Math.pow(rng(), 1.45); // denser low down, thinning toward the top
      const f = u * (n - 1);
      const k = Math.min(n - 2, Math.floor(f));
      const a = vine.pts[k];
      const b = vine.pts[k + 1];
      const h = a.h + (b.h - a.h) * (f - k) + range(rng, -0.08, 0.08);
      const th = a.th + (b.th - a.th) * (f - k) + range(rng, -0.1, 0.1);
      // clumps with bare vine between: a noise gate that gets stricter with height
      const clump = model.noise.simplex3(th * 2.6 + seed, h * 0.85, seed * 0.3);
      if (clump < -0.55 + 0.7 * u + 0.1 * rng()) continue;
      const surf = model.surface(h, th);
      // the leaf direction: mostly up the bark, sometimes sideways or even hanging
      const side = _X.crossVectors(surf.up, surf.n).normalize(); // tangent round the trunk
      const psi = rng() < 0.14 ? range(rng, -2.4, 2.4) : range(rng, -0.85, 0.85);
      const inPlane = surf.up.clone().multiplyScalar(Math.cos(psi)).addScaledVector(side, Math.sin(psi)).normalize();
      const tilt = range(rng, 0.14, 0.5); // the tip lifts off the bark
      _Y.copy(inPlane).multiplyScalar(Math.cos(tilt)).addScaledVector(surf.n, Math.sin(tilt)).normalize();
      _Z.copy(surf.n).multiplyScalar(Math.cos(tilt)).addScaledVector(inPlane, -Math.sin(tilt)).normalize();
      _X.crossVectors(_Y, _Z).normalize();
      const w = range(rng, W[0], W[1]) * (1 - 0.15 * u);
      _m.makeBasis(_X.clone().multiplyScalar(w), _Y.clone().multiplyScalar(w * 1.25), _Z);
      const origin = surf.p.clone().addScaledVector(surf.n, 0.012).addScaledVector(inPlane, -0.03);
      // a leaf a hand's breadth from the lens is a dark smear across the frame: ivy keeps 0.42 m clear of the
      // walker's weave tube (the tip of the card is tested as well as its root)
      if (cameraDistance(origin.x, origin.y, origin.z) < CARD_CLEAR) continue;
      _p.copy(origin).addScaledVector(_Y, w * 1.25);
      if (cameraDistance(_p.x, _p.y, _p.z) < CARD_CLEAR) continue;
      _m.setPosition(origin);
      const fresh = rng() < IVY_LOOK.freshChance * (0.6 + 0.8 * u) ? 1 : 0;
      const val = range(rng, 0.82, 1.1);
      const c = [0, 1, 2].map((q) => (IVY_LOOK.dark[q] + (IVY_LOOK.fresh[q] - IVY_LOOK.dark[q]) * fresh * range(rng, 0.6, 1)) * val);
      cards.push({ m: _m.toArray(), c, h });
      placed++;
    }
    // flowering heads: umbels at the very top of the first patch of a mature, flowering ivy
    if (tall) {
      for (let k = 0; k < 11; k++) {
        const tip = tips[Math.floor(rng() * tips.length)];
        const h = tip.h - range(rng, -0.4, 1.2);
        const th = tip.th + range(rng, -0.35, 0.35);
        const surf = model.surface(h, th);
        umbels.push({
          p: surf.p.clone().addScaledVector(surf.n, range(rng, 0.05, 0.12)),
          s: range(rng, 0.045, 0.085),
          c: [range(rng, 0.9, 1.15), range(rng, 0.95, 1.15), range(rng, 0.6, 0.95)],
        });
      }
    }
  }
  return { cards, runners, umbels };
}

// Ribbon (flat strip) geometry for the runner stems. Winding verified: (a0, b0, a1), (a1, b0, b1) faces
// along +n when a0/a1 are the -W/+W edge points of the lower ring and b0/b1 of the upper (see planIvy).
export function addRunner(acc, pts, tintArr) {
  const first = acc.pos.length / 3;
  const W = new V3();
  const wear = [0, 0, 0, 0.2];
  const q = new V3();
  pts.forEach((pt, i) => {
    W.crossVectors(pt.n, pt.up).normalize();
    for (const sgn of [-1, 1]) {
      q.copy(pt.p).addScaledVector(W, sgn * pt.w * 0.5);
      pushV(acc, q, pt.n, sgn < 0 ? 0 : 1, i * 0.5, tintArr, wear);
    }
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a0 = first + i * 2;
    const a1 = a0 + 1;
    const b0 = a0 + 2;
    const b1 = a0 + 3;
    acc.idx.push(a0, b0, a1, a1, b0, b1);
  }
}

// ------------------------------------------------------------------------------------------------
// FAR TRUNKS: one slim unit trunk geometry (radius about 1, height 15) shared by every instance
// ------------------------------------------------------------------------------------------------
// Instances scale x and z by the real radius (and y a little). There is no yaw, so the moss on the +Z
// face is on the north side of every far trunk, exactly as on the near ones.
export function buildFarTrunkGeometry(model, rings, radial, bend = { ax: 0, az: 0, phase: 0 }) {
  const acc = createAcc();
  const nR = rings.length;
  const stride = radial + 1;
  const first = 0;
  const tint = [1, 1, 1];
  const wear = [0, 0, 0, 0];
  const p = new V3();
  const n = new V3();
  const uRep = 3;
  const radiusAt = (h, th) =>
    (1 + 0.5 * Math.exp(-Math.max(h, 0) / 0.7)) * (1 - 0.28 * Math.min(Math.max(h, 0) / 15, 1)) * (1 + 0.05 * Math.cos(2 * th + 0.7));
  let v = 0;
  for (let i = 0; i < nR; i++) {
    const h = rings[i];
    if (i > 0) v += (rings[i] - rings[i - 1]) / 0.9;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * TAU;
      const r = radiusAt(h, th);
      // the axis wanders in a slow S (zero at the ground), a different one per species so the tree line is not
      // a row of identical poles; amplitudes are in unit radii (the instance scales x and z by the real radius)
      const hh = Math.max(h, 0);
      const cx = bend.ax * (Math.sin(hh * 0.21 + bend.phase) - Math.sin(bend.phase));
      const cz = bend.az * (Math.sin(hh * 0.17 + bend.phase * 1.7) - Math.sin(bend.phase * 1.7));
      p.set(Math.cos(th) * r + cx, h, Math.sin(th) * r + cz);
      // slope of the profile (finite difference) tilts the normal
      const dr = (radiusAt(h + 0.3, th) - radiusAt(h - 0.3, th)) / 0.6;
      n.set(Math.cos(th), -dr, Math.sin(th)).normalize();
      shadeBark(model, h, n.x, n.z, tint, wear);
      pushV(acc, p, n, (j / radial) * uRep, v, tint, wear);
    }
  }
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const v0 = first + i * stride + j;
      const v1 = v0 + 1;
      const v2 = v0 + stride;
      const v3 = v2 + 1;
      acc.idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  // cone over the top
  const topH = rings[nR - 1];
  p.set(0, topH + 0.6, 0);
  shadeBark(model, topH, 0, 0, tint, wear);
  const apex = pushV(acc, p, new V3(0, 1, 0), uRep / 2, v + 0.3, tint, wear);
  for (let j = 0; j < radial; j++) {
    const vi = (nR - 1) * stride + j;
    acc.idx.push(vi, apex, vi + 1);
  }
  return acc;
}
