// Geometry for the first wooden steps (TrunkSteps.jsx). Pure maths on top of propStepsMath.js; runs under node.
//
//   treads      eight hardwood boards, each a loft of five rings across its width; the profile has a worn dish
//               in the middle, a rounded front arris, and a back edge SCRIBED to the hero trunk and its buttress
//               root fins. Every tread has its own size, thickness, tilt, yaw, wear, chipped corner and weathering.
//   brackets    one forged steel bracket under each tread (a flat arm and a plate lying on the bark) and a
//               carriage bolt through the tread
//   handline    a worn hemp rope looped through four iron eyes driven into the trunk beside the steps
//   roots       three small extra root swells and a soil mound where the first step meets the ground
//
// Material groups: wood mesh: 0 treads. iron mesh: 0 iron. rope: 0 rope. roots: 0 bark. soil: 0 ground.

import * as THREE from "three";
import { createRng } from "@/lib/random";
import { createNoise } from "@/lib/noise";
import { createBuilder, TAU, smoothstep, hash1 } from "./propKit";
import { HERO, placeTreadsStaged } from "./propStepsMath";
import { TONES, linearOf } from "./propTones";

// ------------------------------------------------------------------------------------------------
// TUNING
// ------------------------------------------------------------------------------------------------
export const STEPS_BUILD = {
  eyeSteps: [1, 3, 5, 7], // the treads beside which a handline eye is driven in
  eyeHeight: 0.92, // metres above the tread's top, about hand height
  eyeStandOff: 0.07, // metres beyond the tread's end (on the left, toward larger azimuth)
  ropeRadius: 0.0112,
  ropeSag: 0.1, // how far the rope sags between two eyes
  ropeBow: 0.03, // and how far it stands off the bark mid span (so it never touches the flare)
  barkTile: 1.2, // metres of trunk one tile of the bark texture covers
  woodTile: [0.55, 1.1], // metres of tread one tile of the beam texture covers (radial, along the grain)
};

const TREAD_PROFILE = 6; // points round a tread's cross section

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------
// first radius along (azimuth, height) at which the hero wood ends (the true surface, roots included)
function surfaceAlong(az, y, lateral = 0, from = 0.3) {
  const ax = HERO.axis(y);
  const ur = [Math.cos(az), Math.sin(az)];
  const ul = [-Math.sin(az), Math.cos(az)];
  for (let r = from; r < 6; r += 0.004) {
    const x = ax.x + ur[0] * r + ul[0] * lateral;
    const z = ax.z + ur[1] * r + ul[1] * lateral;
    if (HERO.sd(x, y, z) > 0) return { r, x, z };
  }
  return { r: 3, x: ax.x + ur[0] * 3, z: ax.z + ur[1] * 3 };
}

// a quaternion for a basis whose local X is `ex` and local Y is as close to `ey` as possible (ex ⟂ result)
function quatFromAxes(ex, ey) {
  const x = new THREE.Vector3(...ex).normalize();
  const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(...ey)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// ------------------------------------------------------------------------------------------------
// the whole build
// ------------------------------------------------------------------------------------------------
// A generator so the staged build can spend a frame on each part; buildSteps() below drains it in one go.
export function* buildStepsStaged() {
  const treads = yield* placeTreadsStaged();
  yield;
  const noise = createNoise(8123);
  const rng = createRng(8124);

  // ---- 1. the treads --------------------------------------------------------------------------------------------------------------
  const wood = createBuilder();
  const silver = linearOf(TONES.silver);
  for (const T of treads) {
    const nS = T.s.length;
    const wearK = (s) => Math.exp(-Math.pow(s / (T.width * 0.3), 2)); // dished in the middle, where boots land
    const yaw = T.yaw;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // the tread's own frame: ur, ul turned by the small yaw
    const ur = { x: T.ur.x * cy + T.ul.x * sy, z: T.ur.z * cy + T.ul.z * sy };
    const ul = { x: -T.ur.x * sy + T.ul.x * cy, z: -T.ur.z * sy + T.ul.z * cy };
    const rMid = T.back.reduce((a, b) => a + b, 0) / nS;
    const chip = T.k % 3 === 0 ? (T.k % 2 === 0 ? 0 : nS - 1) : -1; // some treads have a chipped front corner
    const rings = [];
    for (let i = 0; i < nS; i++) {
      const si = T.s[i];
      const b = T.back[i];
      const frontI = T.front + 0.004 * noise.perlin2(T.k * 3.1, si * 7) - (i === chip ? 0.022 : 0);
      const dep = frontI - b;
      const wear = T.wear * wearK(si) * (1 + 0.3 * noise.perlin2(si * 5, T.k));
      const topAt = (r) => T.top - T.pitch * (r - rMid); // tilts outward-down so the rain runs off
      const botAt = (r) => T.bottom - T.pitch * (r - rMid);
      const prof = [
        [b, topAt(b)],
        [b + dep * 0.52, topAt(b + dep * 0.52) - wear],
        [frontI - 0.013, topAt(frontI) - 0.003 - wear * 0.2 - (i === chip ? 0.012 : 0)],
        [frontI, topAt(frontI) - 0.015 - (i === chip ? 0.016 : 0)],
        [frontI - 0.004, botAt(frontI) + 0.006],
        [b, botAt(b)],
      ];
      // the tread's own centre line axis at this height, then radial along ur and lateral along ul
      const ring = prof.map(([r, y]) => {
        const ax = HERO.axis(y);
        return [ax.x + ur.x * r + ul.x * si, y, ax.z + ur.z * r + ul.z * si];
      });
      rings.push(ring);
    }
    const ulv = [ul.x, 0, ul.z];
    const base = [1, 1, 1];
    const wornT = 0.7 + 0.4 * hash1(T.k, 17); // how silvered this board is
    const mossK = 0.25 + 0.7 * hash1(T.k, 31); // and how mossy its shaded edges are
    const uOff = hash1(T.k, 5) * 3;
    const vOff = hash1(T.k, 6) * 3;
    // rings run along +ul; the profile goes top, front, bottom, back, which makes (ring step) x (profile step) point outward
    wood.loft(rings, {
      group: 0,
      faceted: true,
      capTop: { normal: [-ulv[0], 0, -ulv[2]] },
      capBottom: { normal: [ulv[0], 0, ulv[2]] },
      uv: (i, j) => {
        const p = rings[Math.min(i, nS - 1)][j % TREAD_PROFILE];
        return [(p[0] * ur.x + p[2] * ur.z) / STEPS_BUILD.woodTile[0] + uOff, (p[0] * ul.x + p[2] * ul.z) / STEPS_BUILD.woodTile[1] + vOff];
      },
      color: (i, j) => {
        const jj = j % TREAD_PROFILE;
        const si = T.s[Math.min(i, nS - 1)];
        const onTop = jj <= 2;
        const centre = wearK(si);
        // the walked-on middle is polished, honey, a little lighter; the ends and the back edge go grey and mossy
        const polish = onTop ? centre * smoothstep(0.0, 1.0, 1 - Math.abs(jj - 1) * 0.6) : 0;
        const endK = Math.abs(si) / (T.width / 2);
        const shade = (1 - 0.3 * endK) * (jj === 0 || jj === 5 ? 0.82 : 1); // back edge and ends are shaded
        const m = mossK * (smoothstep(0.55, 1.0, endK) * 0.8 + (jj === 0 || jj === 5 ? 0.5 : 0)) * (0.6 + 0.4 * (noise.perlin2(T.k * 3 + i, jj * 2.1) * 0.5 + 0.5));
        const s = (1 - polish * 0.7) * wornT * 0.35 * (onTop ? 1 : 0.7); // silvering toward the grey tone
        const k = shade * (0.9 + 0.2 * polish);
        let r = base[0] * k * (1 + 0.1 * polish);
        let g = base[1] * k * (1 + 0.05 * polish);
        let bl = base[2] * k * (1 - 0.05 * polish);
        r += (silver[0] * 1.6 - r) * s * 0.4;
        g += (silver[1] * 1.6 - g) * s * 0.4;
        bl += (silver[2] * 1.6 - bl) * s * 0.4;
        // moss as a green multiplier
        r *= 1 - 0.22 * m;
        g *= 1 + 0.35 * m;
        bl *= 1 - 0.3 * m;
        return [r, g, bl];
      },
    });
  }

  yield;

  // ---- 2. the steel: brackets, bolts, handline eyes ---------------------------------------------------------------------------------------
  const iron = createBuilder();
  // iron: the colour is the material's, the vertex colour only varies it a little from piece to piece
  const ironAt = (i) => {
    const k = 0.8 + 0.4 * hash1(i, 91);
    return [k, k, k];
  };
  treads.forEach((T, ti) => {
    const nS = T.s.length;
    const bC = T.back[(nS - 1) >> 1];
    const az = T.az;
    const qAz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -az); // local +X -> ur
    const ax = T.axis;
    const yb = T.bottom;
    // the bark under the middle of the tread's back edge, where the plate lies
    const plateY = yb - 0.075;
    const sNear = surfaceAlong(az, plateY, 0, 0.3);
    const nrm = HERO.normal(sNear.x, plateY, sNear.z);
    // a forged arm under the tread: from the plate's top to 12 cm in under the board
    const sTop = surfaceAlong(az, yb - 0.01, 0, 0.3);
    const r0 = Math.min(sTop.r, bC) - 0.01;
    const r1 = bC + 0.13;
    const armLen = r1 - r0;
    const rc = (r0 + r1) / 2;
    iron.box([ax.x + Math.cos(az) * rc, yb - T.pitch * 0.2 - 0.0042, ax.z + Math.sin(az) * rc], [armLen, 0.0085, 0.052], { quat: qAz, group: 0, color: ironAt(ti * 3), tile: 0.2 });
    // the plate: tilted to lie flat on the bark (its local Z is the surface normal, local Y as upright as it can be)
    const zAxis = new THREE.Vector3(nrm.x, nrm.y, nrm.z);
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const qPlate = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    const embed = 0.012;
    iron.box([sNear.x - nrm.x * embed + nrm.x * 0.0045, plateY - nrm.y * embed, sNear.z - nrm.z * embed + nrm.z * 0.0045], [0.072, 0.16, 0.009], { quat: qPlate, group: 0, color: ironAt(ti * 3 + 1), tile: 0.2 });
    // a carriage bolt head on the tread, a little behind the middle
    const topMid = T.top - T.pitch * 0.0 - T.wear * 0.9;
    const bx = ax.x + Math.cos(az) * (bC + 0.06);
    const bz = ax.z + Math.sin(az) * (bC + 0.06);
    iron.tube(
      [
        [bx, topMid - 0.002, bz],
        [bx, topMid + 0.011, bz],
      ],
      [0.013, 0.0105],
      4,
      { group: 0, color: ironAt(ti * 3 + 2), capEnd: true },
    );
  });

  yield;

  // ---- 3. the handline: iron eyes and the rope ------------------------------------------------------------------------------------------
  const eyes = [];
  for (const k of STEPS_BUILD.eyeSteps) {
    const T = treads[k];
    const y = T.top + STEPS_BUILD.eyeHeight;
    const R0 = HERO.radius(y, T.az);
    // beyond the left end of the tread (larger azimuth), stood off a hand's breadth
    const az = T.az + (T.width / 2 + STEPS_BUILD.eyeStandOff) / Math.max(0.9, R0);
    const sf = surfaceAlong(az, y, 0, 0.3);
    const n = HERO.normal(sf.x, y, sf.z);
    eyes.push({ k, y, az, p: [sf.x, y, sf.z], n: [n.x, n.y, n.z] });
  }
  const eyeRing = [];
  eyes.forEach((e, i) => {
    const n = new THREE.Vector3(...e.n);
    const next = eyes[Math.min(eyes.length - 1, i + 1)];
    const prev = eyes[Math.max(0, i - 1)];
    // the rope's direction here (up the spiral)
    const t = new THREE.Vector3(next.p[0] - prev.p[0], next.p[1] - prev.p[1], next.p[2] - prev.p[2]).normalize();
    const bvec = new THREE.Vector3().crossVectors(n, t).normalize();
    const tvec = new THREE.Vector3().crossVectors(bvec, n).normalize();
    const c = [e.p[0] + n.x * 0.034, e.p[1] + n.y * 0.034, e.p[2] + n.z * 0.034];
    e.ring = c;
    e.tangent = tvec.toArray();
    // the annulus: 8 points outside, 8 inside, in the plane spanned by n and b (its normal is the rope direction)
    const outer = [];
    const inner = [];
    for (let m = 0; m < 8; m++) {
      const a = (m / 8) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      outer.push([c[0] + (n.x * ca + bvec.x * sa) * 0.024, c[1] + (n.y * ca + bvec.y * sa) * 0.024, c[2] + (n.z * ca + bvec.z * sa) * 0.024]);
      inner.push([c[0] + (n.x * ca + bvec.x * sa) * 0.0135, c[1] + (n.y * ca + bvec.y * sa) * 0.0135, c[2] + (n.z * ca + bvec.z * sa) * 0.0135]);
    }
    // the shank into the bark
    iron.box([e.p[0] + n.x * 0.01, e.p[1] + n.y * 0.01, e.p[2] + n.z * 0.01], [0.012, 0.012, 0.03], { quat: quatFromAxes(tvec.toArray(), bvec.toArray()), group: 0, color: ironAt(i + 40), tile: 0.1 });
    const col = ironAt(i + 50);
    // outer rim then inner rim as a two ring loft (a flat washer, lit from either side)
    iron.loft([outer, inner], { group: 0, color: col, flip: false, uv: (ri, j) => [j / 8, ri] });
    // the back face of the washer, so it is solid from both sides
    const back = [outer.map((p) => [p[0], p[1], p[2]]), inner.map((p) => [p[0], p[1], p[2]])];
    iron.loft([back[1], back[0]], { group: 0, color: col, flip: false, uv: (ri, j) => [j / 8, ri] });
    eyeRing.push(c);
  });

  // the rope: tail below the first eye, sagging spans, a loose end above the last eye
  const rope = createBuilder();
  const rpts = [];
  const clear = (p, margin = 0.02) => {
    let x = p[0];
    let y = p[1];
    let z = p[2];
    for (let it = 0; it < 6; it++) {
      const d = HERO.sd(x, y, z);
      if (d >= margin) break;
      const n = HERO.normal(x, y, z);
      x += n.x * (margin - d + 0.004);
      y += n.y * (margin - d + 0.004);
      z += n.z * (margin - d + 0.004);
    }
    return [x, y, z];
  };
  const first = eyes[0];
  const last = eyes[eyes.length - 1];
  // hanging tail: down the bark from the first eye, ending in a knot
  rpts.push(clear([first.ring[0] - first.tangent[0] * 0.04 - 0.0, first.ring[1] - 0.34, first.ring[2] - first.tangent[2] * 0.04 + first.n[2] * 0.02]));
  rpts.push(clear([first.ring[0] - first.tangent[0] * 0.02, first.ring[1] - 0.17, first.ring[2] - first.tangent[2] * 0.02]));
  eyes.forEach((e, i) => {
    rpts.push(e.ring.slice());
    if (i < eyes.length - 1) {
      const nx = eyes[i + 1];
      for (let m = 1; m <= 3; m++) {
        const t = m / 4;
        const bow = STEPS_BUILD.ropeBow * 4 * t * (1 - t);
        const sag = STEPS_BUILD.ropeSag * 4 * t * (1 - t) * (0.8 + 0.4 * hash1(i + m, 3));
        const mid = [e.ring[0] + (nx.ring[0] - e.ring[0]) * t, e.ring[1] + (nx.ring[1] - e.ring[1]) * t - sag, e.ring[2] + (nx.ring[2] - e.ring[2]) * t];
        // stand it off the bark along the local normal
        const nn = [e.n[0] + (nx.n[0] - e.n[0]) * t, e.n[1] + (nx.n[1] - e.n[1]) * t, e.n[2] + (nx.n[2] - e.n[2]) * t];
        rpts.push(clear([mid[0] + nn[0] * bow, mid[1] + nn[1] * bow, mid[2] + nn[2] * bow]));
      }
    }
  });
  // loose end above the last eye: up and away
  rpts.push(clear([last.ring[0] + last.tangent[0] * 0.12, last.ring[1] + 0.14, last.ring[2] + last.tangent[2] * 0.12 + last.n[2] * 0.02]));
  rpts.push(clear([last.ring[0] + last.tangent[0] * 0.2 + last.n[0] * 0.05, last.ring[1] + 0.24, last.ring[2] + last.tangent[2] * 0.2 + last.n[2] * 0.05]));
  const ropeTint = [0.86, 0.82, 0.74];
  rope.tube(rpts, STEPS_BUILD.ropeRadius, 3, { group: 0, color: ropeTint, vPerM: 1 / 0.24, capStart: true, capEnd: "point" });

  yield;

  // ---- 4. a few small extra root swells and the soil mound at the foot of the first step -----------------------------------------------------------------
  const roots = createBuilder();
  const soil = createBuilder();
  const soilLin = linearOf(TONES.soil);
  const T0 = treads[0];
  [-0.4, 0.1, 0.55].forEach((dAz, ri) => {
    const az = T0.az + dAz;
    const sf = surfaceAlong(az, 0.22, 0, 0.5);
    const pts = [];
    const radii = [];
    const sway = (rng() - 0.5) * 0.3;
    for (let m = 0; m <= 4; m++) {
      const t = m / 4;
      const r = sf.r - 0.12 + t * (0.75 + 0.35 * hash1(ri, 4));
      const a = az + sway * t;
      const ax = HERO.axis(0.2);
      const x = ax.x + Math.cos(a) * r;
      const z = ax.z + Math.sin(a) * r;
      const y = 0.17 * (1 - t) + 0.05 * (1 - t * t) - 0.05 * t;
      pts.push([x, y, z]);
      radii.push(0.085 * Math.pow(1 - t, 0.9) + 0.022);
    }
    roots.tube(pts, (t, i) => radii[i], 4, {
      group: 0,
      color: (i) => {
        const f = i / 4;
        return [0.9 - 0.2 * f, 1.0 + 0.1 * f, 0.85 - 0.2 * f];
      },
      vPerM: 1 / STEPS_BUILD.barkTile,
      uRep: 1,
      capEnd: "point",
    });
  });
  {
    // a worn pad of earth at the foot: three rings, lumpy, boot polished in the middle
    const az = T0.az;
    const ax = HERO.axis(0);
    const cr = T0.front + 0.12;
    const cx = ax.x + Math.cos(az) * cr;
    const cz = ax.z + Math.sin(az) * cr;
    const ul = [-Math.sin(az), Math.cos(az)];
    const ur = [Math.cos(az), Math.sin(az)];
    const radii = [
      [0.72, 0.52],
      [0.46, 0.32],
      [0.2, 0.14],
    ];
    const lifts = [-0.015, 0.03, 0.05];
    const N = 9;
    const ph = rng() * TAU;
    const rings = radii.map(([ra, rb], k) => {
      const ring = [];
      for (let j = 0; j < N; j++) {
        const th = ph + (j / N) * TAU;
        const lump = 1 + 0.2 * noise.perlin2(Math.cos(th) * 1.3 + k * 4, Math.sin(th) * 1.3 + 7);
        const a = Math.cos(th) * ra * lump;
        const b = Math.sin(th) * rb * lump;
        ring.push([cx + ul[0] * a + ur[0] * b, lifts[k] * (0.7 + 0.5 * noise.perlin2(a * 3, b * 3)), cz + ul[1] * a + ur[1] * b]);
      }
      return ring;
    });
    soil.loft(rings, {
      group: 0,
      uv: (i, j) => {
        const p = rings[Math.min(i, rings.length - 1)][j % N];
        return [p[0] * 0.5, p[2] * 0.5];
      },
      color: (i, j) => {
        const lit = 0.8 + 0.4 * hash1(i * 10 + j, 9);
        const k = i === 0 ? 0.95 : 1.15; // wet skirt, a drier boot polished crown
        return [lit * k, lit * k * (1 + soilLin[1] * 0.5), lit * k];
      },
    });
  }

  return {
    wood: wood.toGeometry(),
    iron: iron.toGeometry(),
    rope: rope.toGeometry(),
    roots: roots.toGeometry(),
    soil: soil.toGeometry(),
    tris: { treads: wood.triangles, iron: iron.triangles, rope: rope.triangles, roots: roots.triangles, soil: soil.triangles },
    treads,
    eyes,
  };
}

// World positions for the integrator: where each tread's top face centre is, and the trunk surface behind it
export function stepReport(result) {
  return result.treads.map((T) => {
    const rMid = (T.back.reduce((a, b) => a + b, 0) / T.back.length + T.front) / 2;
    return {
      step: T.k + 1,
      azimuthDeg: Math.round(T.azDeg * 10) / 10,
      topY: Math.round(T.top * 1000) / 1000,
      centre: [
        Math.round((T.axis.x + T.ur.x * rMid) * 1000) / 1000,
        Math.round(T.top * 1000) / 1000,
        Math.round((T.axis.z + T.ur.z * rMid) * 1000) / 1000,
      ],
      widthM: Math.round(T.width * 1000) / 1000,
      backEdgeRadial: T.back.map((v) => Math.round(v * 1000) / 1000),
      frontRadial: Math.round(T.front * 1000) / 1000,
    };
  });
}

// Everything in one go (for the dev checks)
export function buildSteps() {
  const g = buildStepsStaged();
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
