// Shared plumbing for the signposts, story props and trunk steps (prop*.js).
//
//   createBuilder()      a small indexed mesh accumulator with material groups: lofts (rings of points),
//                        boxes, polygon extrusions, tubes and blobs. Positions, normals, uvs and vertex
//                        colours; every winding is chosen from an intended outward normal so nothing is
//                        ever inside out.
//   createTaskRunner()   the staged build scheduler (a few milliseconds of work per frame, generator tasks
//                        advance one chunk per call), the same pattern PathAndGround uses.
//   texture helpers      DataTexture wrapper, a metric height to normal map, roughness and AO packing,
//                        and a bilinear grid sampler.
//
// Pure three.js and typed arrays: no canvas, no React, so everything here also runs under plain node.

import * as THREE from "three";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export { clamp, mix, smoothstep, fract } from "@/lib/noise";

// ------------------------------------------------------------------------------------------------
// Small vector helpers (arrays, no allocation of Vector3 in the hot loops)
// ------------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------------------------------------
// The mesh builder
// ------------------------------------------------------------------------------------------------
export function createBuilder() {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = []; // idx[group] = flat index list

  const vert = (p, n, u, v, c) => {
    const i = pos.length / 3;
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push(u, v);
    col.push(c[0], c[1], c[2]);
    return i;
  };
  const list = (g) => (idx[g] ??= []);
  const tri = (a, b, c, g = 0) => {
    list(g).push(a, b, c);
  };
  // Add a triangle whose geometric normal must agree with `hint` (swaps the winding when it does not).
  const triHint = (a, b, c, hint, g = 0) => {
    const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const pc = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const n = cross(sub(pb, pa), sub(pc, pa));
    if (len(n) < 1e-14) return; // degenerate, nothing to draw
    if (dot(n, hint) >= 0) tri(a, b, c, g);
    else tri(a, c, b, g);
  };

  // ---- loft: rings of points, each ring a closed loop -----------------------------------------------
  // rings[i][j] = [x, y, z]. Convention (the repo's): ring points advance from +X toward +Z when seen as
  // a vertical cylinder, so (ring i to i+1) x (point j to j+1) points OUTWARD. If a caller builds rings
  // the other way round, pass flip: true.
  //   faceted     every quad gets its own vertices and a flat normal (hewn timber, boxes, stones)
  //   uv(i, j)    [u, v] per vertex, default (j / n, i / rings)
  //   color(i, j) [r, g, b] linear per vertex or a constant [r, g, b]
  //   capTop / capBottom   close the first / last ring with a fan (flat normal)
  //   radial      [x, y, z] centre: blend the normals toward "away from this point" (blobs)
  function loft(rings, o = {}) {
    const g = o.group ?? 0;
    const flip = o.flip ?? false;
    const faceted = o.faceted ?? false;
    const nR = rings.length;
    const n = rings[0].length;
    const uvf = o.uv ?? ((i, j) => [j / n, i / Math.max(1, nR - 1)]);
    const colf = typeof o.color === "function" ? o.color : () => o.color ?? [1, 1, 1];
    const P = (i, j) => rings[Math.max(0, Math.min(nR - 1, i))][((j % n) + n) % n];
    const sgn = flip ? -1 : 1;

    if (faceted) {
      for (let i = 0; i < nR - 1; i++) {
        for (let j = 0; j < n; j++) {
          const p00 = P(i, j);
          const p01 = P(i, j + 1);
          const p10 = P(i + 1, j);
          const p11 = P(i + 1, j + 1);
          // flat normal from the mean "up" and "around" edge directions of the quad (same sign as the smooth case)
          const upV = [p10[0] + p11[0] - p00[0] - p01[0], p10[1] + p11[1] - p00[1] - p01[1], p10[2] + p11[2] - p00[2] - p01[2]];
          const aroundV = [p01[0] + p11[0] - p00[0] - p10[0], p01[1] + p11[1] - p00[1] - p10[1], p01[2] + p11[2] - p00[2] - p10[2]];
          let fn = cross(upV, aroundV);
          if (len(fn) < 1e-14) continue;
          fn = norm(fn.map((v) => v * sgn));
          const u0 = uvf(i, j);
          const u1 = uvf(i, j + 1);
          const u2 = uvf(i + 1, j);
          const u3 = uvf(i + 1, j + 1);
          const c = colf(i, j);
          const a = vert(p00, fn, u0[0], u0[1], c);
          const b = vert(p01, fn, u1[0], u1[1], colf(i, j + 1));
          const cc = vert(p10, fn, u2[0], u2[1], colf(i + 1, j));
          const d = vert(p11, fn, u3[0], u3[1], colf(i + 1, j + 1));
          triHint(a, cc, b, fn, g);
          triHint(cc, d, b, fn, g);
        }
      }
    } else {
      const ids = [];
      for (let i = 0; i < nR; i++) {
        const row = [];
        for (let j = 0; j <= n; j++) {
          const up = sub(P(i + 1, j), P(i - 1, j));
          const around = sub(P(i, j + 1), P(i, j - 1));
          let nn = cross(up, around);
          if (len(nn) < 1e-12) {
            // a pole: fall back to the average direction away from the ring centroid
            nn = sub(P(i, j), o.radial ?? ringCentroid(rings[i]));
          }
          nn = norm(nn.map((v) => v * sgn));
          if (o.radial) {
            const r = norm(sub(P(i, j), o.radial));
            nn = norm([nn[0] * 0.5 + r[0] * 0.5, nn[1] * 0.5 + r[1] * 0.5, nn[2] * 0.5 + r[2] * 0.5]);
          }
          const uvv = uvf(i, j);
          row.push(vert(P(i, j), nn, uvv[0], uvv[1], colf(i, j % n)));
        }
        ids.push(row);
      }
      for (let i = 0; i < nR - 1; i++) {
        for (let j = 0; j < n; j++) {
          const a = ids[i][j];
          const b = ids[i][j + 1];
          const c = ids[i + 1][j];
          const d = ids[i + 1][j + 1];
          // hints: the smooth vertex normals of the corners
          const hint = [
            nor[a * 3] + nor[b * 3] + nor[c * 3] + nor[d * 3],
            nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1] + nor[d * 3 + 1],
            nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2] + nor[d * 3 + 2],
          ];
          triHint(a, c, b, hint, g);
          triHint(c, d, b, hint, g);
        }
      }
    }
    if (o.capTop) fan(rings[0], o.capTop === true ? {} : o.capTop, g, o);
    if (o.capBottom) fan(rings[nR - 1], o.capBottom === true ? {} : o.capBottom, g, o);
  }
  const ringCentroid = (ring) => {
    const c = [0, 0, 0];
    for (const p of ring) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    return [c[0] / ring.length, c[1] / ring.length, c[2] / ring.length];
  };
  // Flat cap over a ring: normal given by `normal` option, else from the ring plane
  function fan(ring, cap, g, o) {
    const c = cap.centre ?? ringCentroid(ring);
    const n = ring.length;
    let hint = cap.normal;
    if (!hint) {
      hint = [0, 1, 0];
    }
    const colf = typeof o.color === "function" ? o.color : () => o.color ?? [1, 1, 1];
    const centre = vert(c, hint, 0.5, 0.5, colf(0, 0));
    const ids = ring.map((p, j) => {
      const r = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      return vert(p, hint, 0.5 + r[0] * 2, 0.5 + r[2] * 2, colf(0, j));
    });
    for (let j = 0; j < n; j++) triHint(centre, ids[j], ids[(j + 1) % n], hint, g);
  }

  // ---- box -------------------------------------------------------------------------------------------------
  // center [x,y,z], size [sx,sy,sz]. opts: quat (THREE.Quaternion), group, color, tile (metres per uv unit),
  // uvOffset [u, v], taper (scale the +Y face by this on x and z: a wedge), skipFaces (array of face names).
  const FACES = [
    { name: "px", n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { name: "nx", n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { name: "py", n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { name: "ny", n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { name: "pz", n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { name: "nz", n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const _v = new THREE.Vector3();
  function box(center, size, o = {}) {
    const g = o.group ?? 0;
    const tile = o.tile ?? 0.5;
    const off = o.uvOffset ?? [0, 0];
    const c = o.color ?? [1, 1, 1];
    const half = [size[0] / 2, size[1] / 2, size[2] / 2];
    const xf = (p) => {
      if (o.quat) {
        _v.set(p[0], p[1], p[2]).applyQuaternion(o.quat);
        return [_v.x + center[0], _v.y + center[1], _v.z + center[2]];
      }
      return [p[0] + center[0], p[1] + center[1], p[2] + center[2]];
    };
    const xn = (n) => {
      if (!o.quat) return n;
      _v.set(n[0], n[1], n[2]).applyQuaternion(o.quat);
      return [_v.x, _v.y, _v.z];
    };
    for (const f of FACES) {
      if (o.skipFaces && o.skipFaces.includes(f.name)) continue;
      const corners = [];
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const p = [
          f.n[0] * half[0] + f.u[0] * su * half[0] + f.v[0] * sv * half[0],
          f.n[1] * half[1] + f.u[1] * su * half[1] + f.v[1] * sv * half[1],
          f.n[2] * half[2] + f.u[2] * su * half[2] + f.v[2] * sv * half[2],
        ];
        // a wedge: the top face narrows
        if (o.taper !== undefined && p[1] > 0) {
          p[0] *= o.taper;
          p[2] *= o.taper;
        }
        const uu = (su * Math.abs(f.u[0] * half[0] + f.u[1] * half[1] + f.u[2] * half[2]) * 1) / tile + off[0];
        const vv = (sv * Math.abs(f.v[0] * half[0] + f.v[1] * half[1] + f.v[2] * half[2]) * 1) / tile + off[1];
        corners.push({ p: xf(p), uu, vv });
      }
      const fnW = xn(f.n);
      const ids = corners.map((k) => vert(k.p, fnW, k.uu, k.vv, c));
      triHint(ids[0], ids[1], ids[2], fnW, g);
      triHint(ids[0], ids[2], ids[3], fnW, g);
    }
  }

  // ---- extruded polygon (a board) -----------------------------------------------------------------------
  // contour: [[x, y], ...] counter clockwise seen from +Z. holes: arrays of [x, y] (clockwise). The front
  // face (+Z) is at z1, the back face (-Z) at z0. Sides get outward normals. uvFront / uvBack / uvSide map a
  // point to [u, v]; groups gFront, gBack, gSide.
  function extrude(contour, holes, z0, z1, o = {}) {
    const gF = o.gFront ?? 0;
    const gB = o.gBack ?? 0;
    const gS = o.gSide ?? 0;
    const uvF = o.uvFront ?? ((x, y) => [x, y]);
    const uvB = o.uvBack ?? ((x, y) => [x, y]);
    const uvS = o.uvSide ?? ((x, y, z) => [x + z, y]);
    const c = o.color ?? [1, 1, 1];
    const cs = o.colorSide ?? c;
    const verts2 = [...contour, ...holes.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(
      contour.map((p) => new THREE.Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
    );
    // front and back faces, one vertex per polygon point
    const front = verts2.map((p) => {
      const t = uvF(p[0], p[1]);
      return vert([p[0], p[1], z1], [0, 0, 1], t[0], t[1], c);
    });
    const back = verts2.map((p) => {
      const t = uvB(p[0], p[1]);
      return vert([p[0], p[1], z0], [0, 0, -1], t[0], t[1], cs);
    });
    for (const f of faces) {
      triHint(front[f[0]], front[f[1]], front[f[2]], [0, 0, 1], gF);
      triHint(back[f[0]], back[f[1]], back[f[2]], [0, 0, -1], gB);
    }
    // walls: each loop (the contour CCW, holes CW) has its material on the left of travel, so the outward
    // normal of the wall is on the right: (dy, -dx)
    const wallLoop = (loop) => {
      const m = loop.length;
      for (let k = 0; k < m; k++) {
        const a = loop[k];
        const b = loop[(k + 1) % m];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const n = [dy / l, -dx / l, 0];
        const ua = uvS(a[0], a[1], z0);
        const ub = uvS(b[0], b[1], z0);
        const ua1 = uvS(a[0], a[1], z1);
        const ub1 = uvS(b[0], b[1], z1);
        const i0 = vert([a[0], a[1], z0], n, ua[0], ua[1], cs);
        const i1 = vert([b[0], b[1], z0], n, ub[0], ub[1], cs);
        const i2 = vert([b[0], b[1], z1], n, ub1[0], ub1[1], cs);
        const i3 = vert([a[0], a[1], z1], n, ua1[0], ua1[1], cs);
        triHint(i0, i1, i2, n, gS);
        triHint(i0, i2, i3, n, gS);
      }
    };
    wallLoop(contour);
    for (const h of holes) wallLoop(h);
  }

  // ---- tube along a path ------------------------------------------------------------------------------------
  // points: array of [x,y,z]; radii: number | array | (t, i) => r. Parallel transport frames, so no twist.
  // opts: sides, group, color (constant or (i, j) => rgb), vPerM (uv units per metre along), uRep (times the uv
  // wraps round), capStart / capEnd (true: a flat cap; 'point': closes to a point, a rounded tip), flat (faceted)
  function tube(points, radii, sides, o = {}) {
    const n = points.length;
    const rAt = typeof radii === "function" ? radii : Array.isArray(radii) ? (t, i) => radii[i] : () => radii;
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(n - 1, i + 1)];
      T.push(norm(sub(b, a)));
    }
    // starting normal: any vector not parallel to T[0]
    let N = Math.abs(T[0][1]) < 0.9 ? norm(cross(T[0], [0, 1, 0])) : norm(cross(T[0], [1, 0, 0]));
    const rings = [];
    const arc = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + len(sub(points[i], points[i - 1])));
    const total = arc[n - 1] || 1;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        // transport N onto the new tangent (remove the component along T)
        const d = dot(N, T[i]);
        N = norm([N[0] - T[i][0] * d, N[1] - T[i][1] * d, N[2] - T[i][2] * d]);
      }
      const Bv = cross(T[i], N); // N x B = T needs B = T x N
      const r = rAt(arc[i] / total, i);
      const ring = [];
      for (let j = 0; j < sides; j++) {
        const ph = (j / sides) * TAU;
        const cx = Math.cos(ph) * r;
        const sy = Math.sin(ph) * r;
        // outward: (T) x (d/dphi) must point away from the axis, see the derivation in the loft convention
        ring.push([
          points[i][0] + cx * N[0] - sy * Bv[0],
          points[i][1] + cx * N[1] - sy * Bv[1],
          points[i][2] + cx * N[2] - sy * Bv[2],
        ]);
      }
      rings.push(ring);
    }
    const uRep = o.uRep ?? 1;
    const vPerM = o.vPerM ?? 1;
    loft(rings, {
      group: o.group,
      faceted: o.flat,
      color: o.color,
      uv: (i, j) => [(j / sides) * uRep, arc[Math.min(i, n - 1)] * vPerM],
    });
    const capCol = typeof o.color === "function" ? o.color(0, 0) : (o.color ?? [1, 1, 1]);
    const ringRadius = (ring, c) => {
      let s = 0;
      for (const p of ring) s += Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      return s / ring.length;
    };
    // kind true: a flat disc. kind 'point': a rounded tip pushed out by `tip` radii along the axis.
    const addCap = (ring, centre, outward, kind) => {
      const r = ringRadius(ring, centre) || 1;
      const k = kind === "point" ? (o.tip ?? 0.5) * r : 0;
      const apex = [centre[0] + outward[0] * k, centre[1] + outward[1] * k, centre[2] + outward[2] * k];
      const c0 = vert(apex, outward, 0.5, 0.5, capCol);
      const ids = ring.map((p) => {
        const nrm =
          kind === "point"
            ? norm([outward[0] * 0.65 + ((p[0] - centre[0]) / r) * 0.35, outward[1] * 0.65 + ((p[1] - centre[1]) / r) * 0.35, outward[2] * 0.65 + ((p[2] - centre[2]) / r) * 0.35])
            : outward;
        return vert(p, nrm, 0.5, 0.5, capCol);
      });
      for (let j = 0; j < ring.length; j++) triHint(c0, ids[j], ids[(j + 1) % ring.length], outward, o.group ?? 0);
    };
    if (o.capStart) addCap(rings[0], points[0], T[0].map((v) => -v), o.capStart);
    if (o.capEnd) addCap(rings[n - 1], points[n - 1], T[n - 1], o.capEnd);
  }

  // ---- blob: a lumpy ellipsoid (stones, fungus, soil humps) -------------------------------------------------
  // centre, radii [rx, ry, rz], rings (latitude bands), segs, displace(dirX, dirY, dirZ) -> multiplier.
  // o.phiEnd < PI gives a dome (PI / 2: a half buried stone or a cushion of moss).
  function blob(center, radii, nRings, segs, displace, o = {}) {
    const rings = [];
    // ring 0 at the top pole, last ring at the bottom pole. (phi from the pole, theta round: +X toward +Z)
    const phiEnd = o.phiEnd ?? Math.PI;
    for (let i = 0; i <= nRings; i++) {
      const phi = (i / nRings) * phiEnd;
      const ring = [];
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * TAU;
        const dx = Math.sin(phi) * Math.cos(th);
        const dy = Math.cos(phi);
        const dz = Math.sin(phi) * Math.sin(th);
        const k = displace ? displace(dx, dy, dz) : 1;
        ring.push([center[0] + dx * radii[0] * k, center[1] + dy * radii[1] * k, center[2] + dz * radii[2] * k]);
      }
      rings.push(ring);
    }
    // top pole to bottom pole is "down", so (down) x (around) points INWARD: flip
    loft(rings, { group: o.group, color: o.color, uv: o.uv, flip: true, radial: center, faceted: o.faceted });
  }

  const toGeometry = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    // concatenate the per group index lists and record the draw groups
    const all = [];
    let start = 0;
    const groups = [];
    idx.forEach((l, g) => {
      if (!l || l.length === 0) return;
      groups.push({ start, count: l.length, materialIndex: g });
      for (let i = 0; i < l.length; i++) all.push(l[i]);
      start += l.length;
    });
    geo.setIndex(all);
    for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  };

  return {
    vert,
    tri,
    triHint,
    loft,
    box,
    extrude,
    tube,
    blob,
    toGeometry,
    get triangles() {
      return idx.reduce((s, l) => s + (l ? l.length / 3 : 0), 0);
    },
    get vertices() {
      return pos.length / 3;
    },
  };
}

// ------------------------------------------------------------------------------------------------
// The staged scheduler. A task is a function returning true when finished. gen(factory, onDone) wraps a
// generator: every call runs one chunk (up to the generator's next yield). step(budgetMs) runs tasks until
// the frame's budget is spent, always at least one chunk, so a mount never blocks the main thread.
// ------------------------------------------------------------------------------------------------
export function createTaskRunner() {
  const tasks = [];
  const timing = { totalMs: 0, maxChunkMs: 0, byName: {} };
  let cancelled = false;
  const runner = {
    done: false,
    timing,
    fn(name, f) {
      tasks.push({
        name,
        run: () => {
          f();
          return true;
        },
      });
      return runner;
    },
    gen(name, factory, onDone) {
      let g = null;
      tasks.push({
        name,
        run: () => {
          g ??= factory();
          const r = g.next();
          if (r.done) {
            onDone(r.value);
            return true;
          }
          return false;
        },
      });
      return runner;
    },
    step(budgetMs = 6) {
      if (cancelled || runner.done) return;
      const t0 = performance.now();
      do {
        const task = tasks[0];
        const tt = performance.now();
        if (task.run()) tasks.shift();
        const dt = performance.now() - tt;
        timing.maxChunkMs = Math.max(timing.maxChunkMs, dt);
        timing.byName[task.name] = (timing.byName[task.name] ?? 0) + dt;
        if (!tasks.length) {
          runner.done = true;
          break;
        }
      } while (performance.now() - t0 < budgetMs);
      timing.totalMs += performance.now() - t0;
    },
    cancel() {
      cancelled = true;
    },
  };
  return runner;
}

// ------------------------------------------------------------------------------------------------
// Texture plumbing
// ------------------------------------------------------------------------------------------------
// bytes: Uint8ClampedArray / Uint8Array of w*h*4, row 0 = the BOTTOM of the texture (v = 0).
export function dataTexture(bytes, w, h, { srgb = false, tileU = false, tileV = false, anisotropy = 8 } = {}) {
  const t = new THREE.DataTexture(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = tileU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = tileV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Height field in METRES (row 0 = bottom) to a tangent space normal map (OpenGL convention, +Y up in uv).
// texelMetres is the world size of one texel, so a groove 3 mm deep and 8 mm wide really tilts its walls
// about 40 degrees whatever the texture resolution. Sobel, optional wrap.
export function heightToNormalMetric(hgt, w, h, texelMetres, wrapX = false, wrapY = false, strength = 1) {
  const out = new Uint8ClampedArray(w * h * 4);
  const k = strength / (8 * texelMetres); // Sobel weights sum to 8 per side pair
  const X = (x) => (wrapX ? (x + w) % w : x < 0 ? 0 : x >= w ? w - 1 : x);
  const Y = (y) => (wrapY ? (y + h) % h : y < 0 ? 0 : y >= h ? h - 1 : y);
  for (let y = 0; y < h; y++) {
    const ym = Y(y - 1) * w;
    const yc = y * w;
    const yp = Y(y + 1) * w;
    for (let x = 0; x < w; x++) {
      const l = X(x - 1);
      const r = X(x + 1);
      const dx = hgt[ym + r] + 2 * hgt[yc + r] + hgt[yp + r] - (hgt[ym + l] + 2 * hgt[yc + l] + hgt[yp + l]);
      const dy = hgt[yp + l] + 2 * hgt[yp + x] + hgt[yp + r] - (hgt[ym + l] + 2 * hgt[ym + x] + hgt[ym + r]);
      const nx = -dx * k;
      const ny = -dy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

// R = ambient occlusion, G = roughness (the hero toolkit's convention: the same texture is the roughnessMap
// and the aoMap).
export function packRoughAO(rough, ao) {
  const n = rough.length;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = ao[i] * 255;
    out[o + 1] = rough[i] * 255;
    out[o + 2] = 0;
    out[o + 3] = 255;
  }
  return out;
}

// Standard texture set from raw float planes: rgba (bytes), height (metres), rough (0..1), ao (0..1).
export function textureSetFrom({ rgba, height, rough, ao }, w, h, texelMetres, { tileU = false, tileV = false, normalStrength = 1 } = {}) {
  const normal = heightToNormalMetric(height, w, h, texelMetres, tileU, tileV, normalStrength);
  return {
    map: dataTexture(rgba, w, h, { srgb: true, tileU, tileV }),
    normalMap: dataTexture(normal, w, h, { tileU, tileV }),
    roughnessMap: dataTexture(packRoughAO(rough, ao), w, h, { tileU, tileV }),
  };
}

export function disposeTextureSet(set) {
  if (!set) return;
  for (const k of Object.keys(set)) if (set[k] && set[k].isTexture) set[k].dispose();
}

// Dispose anything with a dispose() (geometries, materials) in one go.
export function disposeAll(list) {
  for (const d of list) d?.dispose?.();
}

// A pure, stateless hash-noise used by geometry code that wants a quick deterministic wobble.
export function hash1(i, seed = 0) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const trisOf = (geometry) => (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3);
