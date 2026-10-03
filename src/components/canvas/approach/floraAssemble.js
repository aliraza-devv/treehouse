// Builds the understorey flora as three.js objects, staged. createFloraBuild() returns a job that the
// UnderstoryFlora component pumps once per rendered frame with a small time budget (step(ms)). The job is
// one long generator: geometry, placement, then each texture is painted and its meshes are mounted the
// moment they are ready, so the woodland fills in over a second or two while the hero keeps animating.
//
// Draw groups (the component renders one empty <group> per name so the reveal prewarm can batch them):
//   ferns-male, ferns-bracken, ferns-harts, cover-low, cover-plants, mushrooms, log, log-details

import * as THREE from "three";
import { makeFoliageMaterial } from "@/lib/foliageMaterial";
import { makeRevealable } from "@/lib/sections/reveal";
import { createRng, range } from "@/lib/random";
import { FLORA_SEED, FERNS, COVER, LOG, MUSHROOMS } from "./floraTuning";
import {
  buildMaleFern,
  buildHartsTongue,
  buildBracken,
  buildTuft,
  buildFlatCard,
  buildArch,
  buildCupCard,
  buildMushroom,
  buildShelf,
  MUSHROOM_KIND_NAMES,
  triangleCount,
} from "./floraGeometry";
import {
  paintMaleFern,
  paintHartsTongue,
  paintBracken,
  paintMercury,
  paintSorrel,
  paintSedge,
  paintIvy,
  paintBramble,
  paintMossPatch,
  paintBeechLeaves,
  paintSoil,
  paintMushroom,
} from "./floraTextures";
import { createLogFrame, makeLogTiles, createLogDetails, paintLog, buildLogWood, buildLogSoil } from "./floraLog";
import { placeAll, shelfTint } from "./floraPlacement";

export const GROUPS = ["ferns-male", "ferns-bracken", "ferns-harts", "cover-low", "cover-plants", "mushrooms", "log", "log-details"];

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _c = new THREE.Color();

// ------------------------------------------------------------------------------------------------
// Matrix builders
// ------------------------------------------------------------------------------------------------
// A fern clump: yaw about its own axis, then lean the whole clump away from vertical toward leanAz.
function fernMatrix(r, out) {
  _q.setFromAxisAngle(Y, r.yaw);
  // rotating about (dz, 0, -dx) tips the top of the clump toward the horizontal direction (dx, dz)
  _ax.set(Math.sin(r.leanAz), 0, -Math.cos(r.leanAz));
  _q2.setFromAxisAngle(_ax, r.leanAng);
  _q2.multiply(_q);
  _p.set(r.x, r.y, r.z);
  _s.set(r.scale, r.sy, r.scale);
  return out.compose(_p, _q2, _s);
}

// A card lying on a surface: local +Y becomes the surface normal n, yawed about it.
function surfaceMatrix(pos, n, yaw, sx, sy, sz, out) {
  _ax.set(n[0], n[1], n[2]).normalize();
  _q.setFromUnitVectors(Y, _ax);
  _q2.setFromAxisAngle(Y, yaw);
  _q.multiply(_q2);
  _p.set(pos[0], pos[1], pos[2]);
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

// Plant axis: tipped `tilt` radians from vertical toward azimuth `az`.
function leanAxis(tilt, az) {
  return [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
}

// Local +Y along `axis`, yawed about it, scaled (sx, sy, sx).
function axisMatrix(pos, axis, yaw, sx, sy, out) {
  _ax.set(axis[0], axis[1], axis[2]).normalize();
  _q.setFromUnitVectors(Y, _ax);
  _q2.setFromAxisAngle(Y, yaw);
  _q.multiply(_q2);
  _p.set(pos[0], pos[1], pos[2]);
  _s.set(sx, sy, sx);
  return out.compose(_p, _q, _s);
}

function instanced(name, geometry, material, recs, matrixOf, tintOf, { cast = false, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, recs.length);
  mesh.name = name;
  for (let i = 0; i < recs.length; i++) {
    mesh.setMatrixAt(i, matrixOf(recs[i], _m));
    const t = tintOf(recs[i]);
    _c.setRGB(t[0], t[1], t[2]);
    mesh.setColorAt(i, _c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------------------------------------
// The build job
// ------------------------------------------------------------------------------------------------
export function createFloraBuild({ onPart, isReduced = () => false }) {
  const stats = {
    stageMs: {}, // busy time per stage (painting and geometry), ms
    busyMs: 0,
    frames: 0,
    triangles: {},
    trianglesTotal: 0,
    instances: {},
    done: false,
  };
  const disposables = [];
  const meshes = [];
  let cancelled = false;
  let stage = "init";
  let finished = false;

  const track = (x) => {
    disposables.push(x);
    return x;
  };
  const mount = (group, mesh, cls, trisPer) => {
    meshes.push(mesh);
    const n = mesh.isInstancedMesh ? mesh.count : 1;
    stats.triangles[cls] = (stats.triangles[cls] || 0) + trisPer * n;
    stats.instances[cls] = (stats.instances[cls] || 0) + n;
    stats.trianglesTotal += trisPer * n;
    onPart(group, mesh);
  };
  const foliageMat = (map, { translucency = 0.8, roughness = 0.72, amp = 0.03, alphaTest = 0.5, flat = false } = {}) => {
    const wind = isReduced() ? null : { amplitude: amp, speed: 1.2 };
    const m = makeFoliageMaterial({ map, translucency, roughness, alphaTest, wind });
    if (flat) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    return track(makeRevealable(m));
  };
  const standardMat = (params) => track(makeRevealable(new THREE.MeshStandardMaterial(params)));
  const geo = (g) => track(g);

  function* pipeline() {
    stage = "context";
    const logFrame = createLogFrame();
    yield;

    // ---- cluster and card geometry (cheap, built up front so placement knows each species' reach)
    stage = "geometry";
    const male = [];
    for (let i = 0; i < FERNS.male.variants; i++) male.push(buildMaleFern(11 + i * 7));
    const harts = [];
    for (let i = 0; i < FERNS.harts.variants; i++) harts.push(buildHartsTongue(23 + i * 5));
    const bracken = [];
    for (let i = 0; i < FERNS.bracken.variants; i++) bracken.push(buildBracken(37 + i * 9));
    const mean = (a, k) => a.reduce((s, v) => s + v[k], 0) / a.length;
    // use the largest variant's reach so every clump respects the path margin
    const reach = {
      male: Math.max(...male.map((v) => v.reach)),
      harts: Math.max(...harts.map((v) => v.reach)),
      bracken: Math.max(...bracken.map((v) => v.reach)),
    };
    stats.clusterTriangles = { male: mean(male, "triangles"), harts: mean(harts, "triangles"), bracken: mean(bracken, "triangles") };
    yield;

    // ---- the log's shared noise tiles, then where everything goes
    stage = "log tiles";
    const tiles = yield* makeLogTiles();
    const logDetails = createLogDetails(logFrame, tiles);
    stage = "placement";
    const placed = yield* placeAll(reach, logFrame, logDetails);
    stats.placed = {
      ferns: placed.ferns.length,
      mushrooms: placed.mushrooms.length,
      moss: placed.cover.moss.length,
      ivy: placed.cover.ivy.length,
      mercury: placed.cover.mercury.length,
      sorrel: placed.cover.sorrel.length,
      sedge: placed.cover.sedge.length,
      bramble: placed.cover.bramble.length,
      beech: placed.cover.beech.length,
    };
    yield;
    if (cancelled) return;

    // split the records of a species across its geometry variants (round robin after a seeded shuffle)
    const splitVariants = (recs, n) => {
      const rng = createRng(FLORA_SEED + 77);
      const buckets = Array.from({ length: n }, () => []);
      recs.forEach((r) => buckets[Math.floor(rng() * n)].push(r));
      return buckets;
    };
    const fernTint = (r) => r.tint;

    // ---- ferns: each species paints its texture, then mounts its variants
    stage = "male fern";
    {
      const tex = track(yield* paintMaleFern());
      const mat = foliageMat(tex, { translucency: 0.9 });
      const recs = placed.ferns.filter((r) => r.species === "male");
      splitVariants(recs, male.length).forEach((bucket, i) => {
        if (!bucket.length) return;
        const g = geo(male[i].geometry);
        mount("ferns-male", instanced(`flora:male-fern-${i}`, g, mat, bucket, fernMatrix, fernTint), "ferns male", male[i].triangles);
      });
    }
    yield;
    stage = "bracken";
    {
      const tex = track(yield* paintBracken());
      const mat = foliageMat(tex, { translucency: 0.95, amp: 0.04 });
      const recs = placed.ferns.filter((r) => r.species === "bracken");
      splitVariants(recs, bracken.length).forEach((bucket, i) => {
        if (!bucket.length) return;
        const g = geo(bracken[i].geometry);
        mount("ferns-bracken", instanced(`flora:bracken-${i}`, g, mat, bucket, fernMatrix, fernTint), "ferns bracken", bracken[i].triangles);
      });
    }
    yield;
    stage = "harts tongue";
    {
      const tex = track(yield* paintHartsTongue());
      // glossy leathery fronds: low roughness, a little less backlight glow than a thin fern
      const mat = foliageMat(tex, { translucency: 0.55, roughness: 0.36, amp: 0.015 });
      const recs = placed.ferns.filter((r) => r.species === "harts");
      splitVariants(recs, harts.length).forEach((bucket, i) => {
        if (!bucket.length) return;
        const g = geo(harts[i].geometry);
        mount("ferns-harts", instanced(`flora:harts-tongue-${i}`, g, mat, bucket, fernMatrix, fernTint), "ferns harts", harts[i].triangles);
      });
    }
    yield;
    if (cancelled) return;

    // ---- moss patches (also reused for the shaggy tufts on the log)
    stage = "moss";
    const moss = yield* paintMossPatch();
    track(moss.map);
    track(moss.normalMap);
    const mossMat = standardMat({ map: moss.map, normalMap: moss.normalMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mossMat.normalScale.set(0.9, 0.9);
    {
      const g = geo(buildFlatCard({ w: 1, l: 1, segV: 1 }).geometry);
      const recs = placed.cover.moss;
      mount("cover-low", instanced("flora:moss-patches", g, mossMat, recs, (r, o) => surfaceMatrix([r.x, r.y, r.z], r.n, r.yaw, r.size, 1, r.size, o), (r) => r.tint), "moss patches", 2);
    }
    yield;

    // ---- ivy runners (ground and trunk)
    stage = "ivy";
    {
      const tex = track(yield* paintIvy());
      const mat = foliageMat(tex, { translucency: 0.5, roughness: 0.42, amp: 0.01, flat: true });
      const gi = buildFlatCard({ w: 0.34, l: 0.6, segV: 2, arch: 0.022, pivot: "base" });
      const g = geo(gi.geometry);
      const recs = placed.cover.ivy;
      // the card's long axis runs along -Z from its base; `yaw` swings it round the surface normal
      mount("cover-low", instanced("flora:ivy-runners", g, mat, recs, (r, o) => surfaceMatrix([r.x, r.y, r.z], r.n, r.yaw, r.size, 1, r.size, o), (r) => r.tint), "ivy runners", gi.triangles);
    }
    yield;

    // ---- dog's mercury and wood sorrel carpets
    stage = "dog's mercury";
    {
      const tex = track(yield* paintMercury());
      const mat = foliageMat(tex, { translucency: 0.7, roughness: 0.78, amp: 0.02 });
      const variants = [buildTuft({ cards: 3, w: 0.3, h: 0.42, segV: 1, bend: 0.2, seed: 5 }), buildTuft({ cards: 3, w: 0.28, h: 0.36, segV: 1, bend: 0.28, seed: 6, spread: 0.1 })];
      splitVariants(placed.cover.mercury, 2).forEach((bucket, i) => {
        if (!bucket.length) return;
        const g = geo(variants[i].geometry);
        mount("cover-plants", instanced(`flora:dogs-mercury-${i}`, g, mat, bucket, (r, o) => axisMatrix([r.x, r.y, r.z], leanAxis(r.tilt, r.leanAz), r.yaw, r.size, r.sy, o), (r) => r.tint), "dogs mercury", variants[i].triangles);
      });
    }
    yield;
    stage = "wood sorrel";
    {
      const tex = track(yield* paintSorrel());
      const mat = foliageMat(tex, { translucency: 0.6, roughness: 0.6, amp: 0.015, flat: true });
      const vi = buildTuft({ cards: 2, w: 0.26, h: 0.22, segV: 1, bend: 0.38, seed: 8, upBlend: 0.7 });
      const g = geo(vi.geometry);
      mount("cover-plants", instanced("flora:wood-sorrel", g, mat, placed.cover.sorrel, (r, o) => axisMatrix([r.x, r.y, r.z], leanAxis(r.tilt, r.leanAz), r.yaw, r.size, r.sy, o), (r) => r.tint), "wood sorrel", vi.triangles);
    }
    yield;
    stage = "sedge";
    {
      const tex = track(yield* paintSedge());
      const mat = foliageMat(tex, { translucency: 0.8, roughness: 0.7, amp: 0.05 });
      const variants = [buildTuft({ cards: 3, w: 0.38, h: 0.62, segV: 1, bend: 0.35, seed: 9 }), buildTuft({ cards: 3, w: 0.34, h: 0.5, segV: 1, bend: 0.42, seed: 10, spread: 0.08 })];
      splitVariants(placed.cover.sedge, 2).forEach((bucket, i) => {
        if (!bucket.length) return;
        const g = geo(variants[i].geometry);
        mount("cover-plants", instanced(`flora:sedge-${i}`, g, mat, bucket, (r, o) => axisMatrix([r.x, r.y, r.z], leanAxis(r.tilt, r.leanAz), r.yaw, r.size, r.sy, o), (r) => r.tint), "sedge", variants[i].triangles);
      });
    }
    yield;
    stage = "bramble";
    {
      const tex = track(yield* paintBramble());
      const mat = foliageMat(tex, { translucency: 0.5, roughness: 0.6, amp: 0.012 });
      const bi = buildArch({ w: 0.44, h: 0.66, segV: 4, bendDeg: 78, seed: 3 });
      const g = geo(bi.geometry);
      mount("cover-plants", instanced("flora:bramble", g, mat, placed.cover.bramble, (r, o) => axisMatrix([r.x, r.y, r.z], [0, 1, 0], r.yaw, r.size, r.sy, o), (r) => r.tint), "bramble", bi.triangles);
    }
    yield;
    if (cancelled) return;

    // ---- beech leaves (atlas of four), one InstancedMesh per atlas cell
    stage = "beech leaves";
    {
      const tex = track(yield* paintBeechLeaves());
      const mat = standardMat({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      for (let cell = 0; cell < 4; cell++) {
        const recs = placed.cover.beech.filter((r) => r.cell === cell);
        if (!recs.length) continue;
        const u0 = (cell % 2) * 0.5;
        const v0 = (cell >> 1) * 0.5;
        const gi = buildFlatCard({ w: 1, l: 1, segV: 1, uv: [u0, v0, u0 + 0.5, v0 + 0.5] });
        const g = geo(gi.geometry);
        mount(
          "cover-low",
          instanced(
            `flora:beech-leaves-${cell}`,
            g,
            mat,
            recs,
            (r, o) => {
              _q.setFromAxisAngle(Y, r.yaw);
              _ax.set(1, 0, 0);
              _q2.setFromEuler(new THREE.Euler(r.tilt, 0, r.roll));
              if (r.n) {
                surfaceMatrix([r.x, r.y, r.z], r.n, r.yaw, r.size, 1, r.size, o);
                return o;
              }
              _q2.multiply(_q);
              _p.set(r.x, r.y, r.z);
              _s.set(r.size, 1, r.size);
              return o.compose(_p, _q2, _s);
            },
            (r) => r.tint,
          ),
          "beech leaves",
          gi.triangles,
        );
      }
    }
    yield;

    // ---- mushrooms: one atlas, three cap shapes
    stage = "mushrooms";
    {
      const mush = yield* paintMushroom();
      track(mush.map);
      track(mush.roughnessMap);
      const mat = standardMat({ map: mush.map, roughnessMap: mush.roughnessMap, roughness: 1, metalness: 0, side: THREE.DoubleSide });
      for (const kind of MUSHROOM_KIND_NAMES) {
        const recs = placed.mushrooms.filter((r) => r.kind === kind);
        if (!recs.length) continue;
        const gi = buildMushroom(kind, MUSHROOMS.radial);
        const g = geo(gi.geometry);
        mount("mushrooms", instanced(`flora:mushrooms-${kind}`, g, mat, recs, (r, o) => axisMatrix([r.x, r.y, r.z], r.axis, r.yaw, r.radius, r.radius * r.stem, o), (r) => r.tint), "mushrooms", gi.triangles);
      }
      // bracket fungus shelves on the log, same atlas and material
      const sh = buildShelf();
      const sg = geo(sh.geometry);
      const rng = createRng(FLORA_SEED + 55);
      const shelves = logDetails.shelves.map((s) => {
        const p = logFrame.point(s.x, s.a, -0.025);
        const n = logFrame.normalAt(s.a);
        return { p, n, size: s.size, tint: shelfTint(rng) };
      });
      mount(
        "log-details",
        instanced(
          "flora:bracket-fungus",
          sg,
          mat,
          shelves,
          (r, o) => {
            // local +Z points away from the trunk (the horizontal part of the surface normal), +Y stays up
            _z.set(r.n[0], 0, r.n[2]).normalize();
            _x.crossVectors(Y, _z).normalize();
            _m.makeBasis(_x, Y, _z);
            _q.setFromRotationMatrix(_m);
            _p.set(r.p[0], r.p[1], r.p[2]);
            _s.set(r.size, r.size * 0.8, r.size);
            return o.compose(_p, _q, _s);
          },
          (r) => r.tint,
        ),
        "bracket fungus",
        sh.triangles,
      );
    }
    yield;
    if (cancelled) return;

    // ---- the fallen log: paint, then mount body, soil, moss tufts
    stage = "log paint";
    const logTex = yield* paintLog(logFrame, tiles);
    track(logTex.map);
    track(logTex.normalMap);
    stage = "log mesh";
    {
      const wood = buildLogWood(logFrame);
      const g = geo(wood.geometry);
      const mat = standardMat({ map: logTex.map, normalMap: logTex.normalMap, vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
      mat.normalScale.set(1.1, 1.1);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = "flora:fallen-log";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mount("log", mesh, "log wood", wood.triangles);
      stats.logParts = wood.parts;
    }
    yield;
    {
      const soil = yield* paintSoil();
      track(soil.map);
      track(soil.normalMap);
      const si = buildLogSoil(logFrame);
      const g = geo(si.geometry);
      const mat = standardMat({ map: soil.map, normalMap: soil.normalMap, vertexColors: true, roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = "flora:root-plate-soil";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mount("log", mesh, "root plate soil", si.triangles);
    }
    yield;
    {
      // shaggy moss tufts on top and the shaded flank
      const ci = buildCupCard({ w: 1, l: 1, cup: 0.14 });
      const g = geo(ci.geometry);
      const rng = createRng(FLORA_SEED + 66);
      const recs = logDetails.moss.map((m) => {
        const surf = logFrame.point(m.x, m.a, m.standing ? -0.01 : 0.004);
        const n = logFrame.normalAt(m.a);
        // standing tufts tilt toward world up and outward so they fringe the silhouette
        const nn = m.standing ? [n[0] * 0.55, n[1] * 0.55 + 0.45, n[2] * 0.55] : n;
        return { p: surf, n: nn, size: m.size, yaw: m.yaw, tint: [m.tint, m.tint, m.tint * range(rng, 0.9, 1.0)] };
      });
      mount("log-details", instanced("flora:log-moss", g, mossMat, recs, (r, o) => surfaceMatrix(r.p, r.n, r.yaw, r.size, 1, r.size, o), (r) => r.tint), "log moss", ci.triangles);
    }
    yield;
    stats.done = true;
    stats.trianglesTotal = Object.values(stats.triangles).reduce((a, b) => a + b, 0);
    finished = true;
  }

  const gen = pipeline();

  return {
    stats,
    get done() {
      return finished;
    },
    // Run the build for at most `budgetMs` of wall time (always at least one step).
    step(budgetMs) {
      if (finished || cancelled) return;
      const t0 = performance.now();
      stats.frames += 1;
      do {
        const s = performance.now();
        const r = gen.next();
        stats.stageMs[stage] = (stats.stageMs[stage] || 0) + (performance.now() - s);
        if (r.done) {
          finished = true;
          stats.done = true;
          stats.trianglesTotal = Object.values(stats.triangles).reduce((a, b) => a + b, 0);
          break;
        }
      } while (performance.now() - t0 < budgetMs);
      stats.busyMs += performance.now() - t0;
    },
    dispose() {
      cancelled = true;
      for (const m of meshes) {
        if (m.parent) m.parent.remove(m);
        if (m.isInstancedMesh) m.dispose();
      }
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      meshes.length = 0;
    },
  };
}

// Debug and report helper: expected triangles for the three cluster classes (not used at runtime).
export const _triangleCount = triangleCount;
export const _unused = [COVER, LOG];
