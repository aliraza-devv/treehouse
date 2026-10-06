// Assembles the approach trunks as three.js objects, STAGED. createTrunkBuild() returns a job that the
// Trunks component pumps once per rendered frame with a small time budget (step(ms)). The job is one long
// generator: plans first (cheap, pure maths), then species by species it paints a bark texture, makes the
// material and mounts every trunk of that species the moment it is ready, so the wood fills in over a
// second or two while the hero keeps animating (same scheme as floraAssemble.js).
//
// Draw groups (the component renders one empty <group> per name so the reveal prewarm can batch them and
// the integrator can cull by distance):
//   trunks-close   the 4 close trunks (stubs, lichen skirts, ivy cards, runners)          within about 3 m
//   trunks-mid     the mid trunks (same dressing)                                          3 to 12 m
//   crowns         crown limbs, crown leaf clusters (mid and close trunks), overhang sprays  overhead
//   trunks-far     instanced far tree line (13 to 25 m, fogged) and its small crowns
//
// What is shared and what is owned: bark textures made by the hero toolkit (createBarkTextures) and leaf cards
// (createLeafCardTexture) live in the toolkit cache, are shared with the hero, and are NEVER disposed here.
// The smooth bark sets and the lichen card are painted here and are disposed with the build.

import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { createNoise } from "@/lib/noise";
import { buildLeafClusterGeometry } from "@/lib/foliageMaterial";
import { createBarkTextures, createLeafCardTexture } from "@/lib/proceduralTextures";
import { buildTrunkList, createTrunkModel, TAU } from "./trunkMath";
import { accToGeometry, accTriangles, addBranchTube, addRunner, addStub, addTrunkTube, addTwig, buildFarTrunkGeometry, createAcc, orientToNormals, planIvy, planStubs } from "./trunkGeometry";
import { farModel, planCrown, planFarTrunks, planSprays } from "./trunkFoliage";
import { paintLichenStrands, paintSmoothBark } from "./trunkTextures";
import {
  makeBarkMaterial,
  makeIvyMaterial,
  makeLeafDepth,
  makeLeafMaterial,
  makeLichenMaterial,
  makeStemMaterial,
  makeUmbelMaterial,
} from "./trunkMaterial";
import { LEAF_LOOK, SPECIES, TRUNK_TUNING } from "./trunkTones";

export const GROUPS = ["trunks-close", "trunks-mid", "crowns", "trunks-far"];

// One seed family for the whole job: the woodland is identical on every load.
const TRUNK_SEED = 8123;
const rngFor = (spec, salt) => createRng(spec.seed * 1009 + salt * 37 + TRUNK_SEED);

// Species in build order: the species of the four close trunks first (they are what the walker sees first).
const SPECIES_ORDER = ["beech", "oakA", "hornbeam", "oakB", "birch"];
const LEAF_KINDS = [
  { kind: "oak", seed: 3 }, // same seeds and size as the hero, so these are free cache hits when the hero has painted them
  { kind: "beech", seed: 4 },
  { kind: "sprig", seed: 5 },
];
const IVY_TEX = { kind: "ivy", seed: 6, size: 512 };
const LEAF_TEX_SIZE = 512;

const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------------------------------------
// Small geometry helpers
// ------------------------------------------------------------------------------------------------
// A card of `segV` strips, 1 wide, `h` tall from y0, gently arched out of its plane (a flat card catches the
// light like a sheet of card; a slight arch gives it the curl of a real leaf). `flipV` puts v = 0 at the top
// (the lichen strands are painted hanging from row 0, and a DataTexture has row 0 at v = 0).
function cardGeometry({ h = 1, y0 = 0, segV = 2, arch = 0.08, flipV = false } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const n = new THREE.Vector3();
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;
    // z = arch * h * sin(pi t): bulges toward +Z in the middle of the card, flat at the two ends.
    const z = arch * h * Math.sin(Math.PI * t);
    const dz = arch * Math.PI * Math.cos(Math.PI * t); // dz / d(y / h)
    n.set(0, -dz, 1).normalize();
    for (const x of [-0.5, 0.5]) {
      pos.push(x, y0 + h * t, z);
      nor.push(n.x, n.y, n.z);
      uv.push(x + 0.5, flipV ? 1 - t : t);
    }
  }
  for (let j = 0; j < segV; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function trianglesOf(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

// An InstancedMesh from records { m: 16 numbers, c: [r, g, b] } (matrix and instance colour multiplier).
function instancedFrom(name, geometry, material, recs, { cast = false, receive = false, depth = null } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, recs.length);
  mesh.name = name;
  for (let i = 0; i < recs.length; i++) {
    mesh.setMatrixAt(i, _m.fromArray(recs[i].m));
    _c.setRGB(recs[i].c[0], recs[i].c[1], recs[i].c[2]);
    mesh.setColorAt(i, _c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (depth) mesh.customDepthMaterial = depth;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------------------------------------
// The build job
// ------------------------------------------------------------------------------------------------
export function createTrunkBuild({ onPart, isReduced = () => false }) {
  const T = TRUNK_TUNING;
  const stats = {
    stageMs: {}, // busy time per stage (painting and geometry), ms
    busyMs: 0,
    maxStepMs: 0, // longest single uninterrupted step, ms (the stage is a generator slice between two yields)
    slowSteps: [],
    frames: 0,
    triangles: {}, // by element class
    trianglesByGroup: {},
    trianglesTotal: 0,
    drawCalls: 0,
    counts: {},
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
  const trackSet = (set) => {
    for (const k of Object.keys(set)) if (set[k] && set[k].isTexture) disposables.push(set[k]);
    return set;
  };
  const mount = (group, mesh, cls) => {
    meshes.push(mesh);
    const tris = trianglesOf(mesh.geometry) * (mesh.isInstancedMesh ? mesh.count : 1);
    stats.triangles[cls] = (stats.triangles[cls] || 0) + tris;
    stats.trianglesByGroup[group] = (stats.trianglesByGroup[group] || 0) + tris;
    stats.trianglesTotal += tris;
    stats.drawCalls += 1;
    onPart(group, mesh);
  };

  function* pipeline() {
    // ===== plans: cheap pure maths ================================================================
    stage = "plan trunks";
    const list = buildTrunkList();
    const radialOf = (t) => Math.max(6, Math.round((t.cls === "close" ? T.closeRadial : t.cls === "mid-near" ? T.midNearRadial : T.midFarRadial) * T.detail));
    const ringsOf = (t) => (t.cls === "close" ? T.closeRings : t.cls === "mid-near" ? T.midNearRings : T.midFarRings);
    const models = new Map();
    for (const t of list) models.set(t.id, createTrunkModel(t, radialOf(t)));
    const modelFor = (t) => models.get(t.id);
    yield;
    if (cancelled) return;

    stage = "plan stubs";
    const stubPlans = new Map();
    for (const t of list) stubPlans.set(t.id, planStubs(modelFor(t), t.brokenBranches, rngFor(t, 1)));
    yield;

    stage = "plan sprays";
    const sprays = planSprays(list, modelFor, createRng(TRUNK_SEED + 5));
    yield;

    stage = "plan crowns";
    // crown leaf clusters grouped by leaf kind; limbs per species (they are wood: they share the bark material)
    const crownRecs = { oak: [], beech: [], sprig: [] };
    const limbPlans = {}; // species -> [{ model, limb }]
    for (const t of list) {
      const model = modelFor(t);
      const rng = rngFor(t, 2);
      let opts;
      if (t.cls === "close") opts = { count: T.crownCloseClusters, limbCount: 1, minHeight: T.crownCloseMinHeight };
      else if (Math.abs(t.lateral) >= T.crownMinLateral) opts = { count: Math.round(range(rng, T.crownClusters[0], T.crownClusters[1])), limbCount: 3 };
      else opts = { count: Math.round(range(rng, T.crownNearClusters[0], T.crownNearClusters[1])), limbCount: 1 };
      const crown = planCrown(model, rng, opts);
      crownRecs[SPECIES[t.species].leaf].push(...crown.clusters);
      for (const limb of crown.limbs) (limbPlans[t.species] ||= []).push({ model, limb });
    }
    const sprayRecs = { oak: [], beech: [], sprig: [] };
    for (const s of sprays) sprayRecs[s.leaf].push(...s.clusters);
    yield;

    stage = "plan far";
    const far = planFarTrunks(list, T.farCount, createRng(TRUNK_SEED + 9));
    const farCrownRecs = { oak: [], beech: [], sprig: [] };
    far.forEach((f, i) => {
      const rng = createRng(TRUNK_SEED + 300 + i);
      const crown = planCrown(farModel(f), rng, { count: T.farCrownClusters, limbCount: 0, minHeight: 7.5, spread: 0.85, size: T.farCrownSize });
      farCrownRecs[SPECIES[f.species].leaf].push(...crown.clusters);
    });
    stats.counts = {
      trunks: list.length,
      close: list.filter((t) => t.cls === "close").length,
      mid: list.filter((t) => t.cls !== "close").length,
      stubs: [...stubPlans.values()].reduce((a, b) => a + b.length, 0),
      sprays: sprays.length,
      sprayClusters: sprays.reduce((a, s) => a + s.clusters.length, 0),
      crownClusters: Object.values(crownRecs).reduce((a, b) => a + b.length, 0),
      far: far.length,
    };
    yield;
    if (cancelled) return;

    // Which trunk carries the flowering ivy: the thickest ivied mid trunk near the path (its patch climbs 6 m)
    const floweringId = list
      .filter((t) => t.ivy && t.cls === "mid-near")
      .sort((a, b) => b.r - a.r)[0]?.id;

    // ===== far trunk geometry needs a stand-in model (shadeBark reads species, wear noise and a value) ======
    const farRings = T.farRings;
    const farRadial = Math.max(6, Math.round(T.farRadial * T.detail));

    // ===== wood, species by species ====================================================================
    const barkMat = {};
    const lichenRecs = { close: [], mid: [] }; // hanging beard lichen cards
    for (const id of SPECIES_ORDER) {
      const sp = SPECIES[id];
      const mine = list.filter((t) => t.species === id);
      const wantFar = far.some((f) => f.species === id);
      const wantLimbs = (limbPlans[id]?.length || 0) > 0 || sprays.some((s) => s.origin.species === id);
      if (mine.length === 0 && !wantFar && !wantLimbs) continue;

      stage = `bark ${id}`;
      yield;
      if (cancelled) return;
      let set;
      if (sp.bark.kind === "toolkit") {
        // shared with the hero through the toolkit cache (oakA is the hero's own bark): never disposed here
        const b = sp.bark;
        set = createBarkTextures({ seed: b.seed, size: b.size, tone: b.tone, moss: b.moss, lichen: b.lichen });
      } else {
        set = trackSet(yield* paintSmoothBark({ variant: sp.bark.variant, seed: sp.bark.seed, size: sp.bark.size }));
      }
      if (cancelled) return;
      yield;
      const mat = track(makeBarkMaterial(set, sp));
      barkMat[id] = mat;

      // ---- trunks of this species: tube + stubs in one geometry, one mesh per trunk (so each can be culled) ----
      stage = `trunks ${id}`;
      for (const t of mine) {
        const model = modelFor(t);
        const rng = rngFor(t, 3);
        const acc = createAcc();
        addTrunkTube(acc, model, ringsOf(t), radialOf(t), rng);
        const firstStubTriangle = accTriangles(acc);
        for (const st of stubPlans.get(t.id)) {
          const info = addStub(acc, model, st, rng);
          if (st.lichen) {
            // a skirt of beard lichen hanging from the underside of the stub: two crossed cards
            const along = range(rng, 0.5, 0.95);
            const pos = info.base.clone().addScaledVector(info.dir, info.L * along);
            pos.y -= info.rb * 0.9;
            const yaw0 = rng() * TAU;
            const w = range(rng, 0.17, 0.29) * (t.cls === "close" ? 1.2 : 1);
            const v = range(rng, 0.85, 1.1);
            for (let k = 0; k < 2; k++) {
              _q.setFromAxisAngle(_Y, yaw0 + (k * Math.PI) / 2 + range(rng, -0.25, 0.25));
              _m.compose(pos, _q, _s.set(w, w, w));
              lichenRecs[t.cls === "close" ? "close" : "mid"].push({ m: _m.toArray(), c: [v, v, v] });
            }
          }
        }
        // the splintered ends are ragged rings: make every triangle agree with its normals (see orientToNormals)
        orientToNormals(acc, firstStubTriangle);
        const geometry = track(accToGeometry(acc));
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.name = `approach:trunk-${t.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mount(t.cls === "close" ? "trunks-close" : "trunks-mid", mesh, t.cls === "close" ? "trunks close" : "trunks mid");
        yield;
        if (cancelled) return;
      }

      // ---- limbs of this species: crown limbs and the overhang spray branches, one merged mesh ----
      const limbAcc = createAcc();
      let anyLimb = false;
      stage = `limbs ${id}`;
      for (const { model, limb } of limbPlans[id] || []) {
        addBranchTube(limbAcc, model, limb.pts, limb.radii, 4, createRng(model.spec.seed * 31 + 7 + TRUNK_SEED), { mossBoost: 0.2 });
        anyLimb = true;
      }
      for (const s of sprays) {
        if (s.origin.species !== id) continue;
        const rng = createRng(TRUNK_SEED + 700 + Math.round(s.spec.s * 1000));
        addBranchTube(limbAcc, s.model, s.pts, s.radii, 7, rng, { mossBoost: 0.3 });
        for (const tw of s.twigs) addTwig(limbAcc, tw.origin, tw.dir, tw.len, tw.r0, rng);
        anyLimb = true;
      }
      if (anyLimb) {
        const mesh = new THREE.Mesh(track(accToGeometry(limbAcc)), mat);
        mesh.name = `approach:limbs-${id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mount("crowns", mesh, "limbs and sprays wood");
      }
      yield;

      // ---- far trunks of this species: one shared slim geometry, instanced ----
      const mineFar = far.filter((f) => f.species === id);
      if (mineFar.length > 0) {
        stage = `far ${id}`;
        const standIn = { sp, mossK: 1, lichenK: 1, valueK: 1, noise: createNoise(TRUNK_SEED + id.length * 13) };
        const k = SPECIES_ORDER.indexOf(id);
        const bend = { ax: 0.9 + 0.5 * ((k * 0.37) % 1), az: 0.7 + 0.6 * ((k * 0.61) % 1), phase: 1.3 + k * 2.1 };
        const geometry = track(accToGeometry(buildFarTrunkGeometry(standIn, farRings, farRadial, bend)));
        const mesh = new THREE.InstancedMesh(geometry, mat, mineFar.length);
        mesh.name = `approach:far-trunks-${id}`;
        mineFar.forEach((f, i) => {
          // a hair of lean about X and Z only (no yaw: the moss on the +Z face stays on the north side of every trunk)
          _e.set(f.tiltZ, 0, -f.tiltX);
          _q.setFromEuler(_e);
          mesh.setMatrixAt(i, _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(f.r, f.hScale, f.r)));
          _c.setRGB(f.tone, f.tone, f.tone);
          mesh.setColorAt(i, _c);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = false; // far, fogged and outside the dapple that matters
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mount("trunks-far", mesh, "trunks far");
        yield;
      }
    }

    // ===== leaves: crowns, sprays, far crowns ==========================================================
    const reduced = isReduced();
    const crownGeo = track(
      buildLeafClusterGeometry({ cards: 3, width: 1, height: 1, bend: 0.15, segments: [1, 1], normalBlend: 0.65, pivot: "center", seed: 11 }),
    );
    // sprays pass close to the lens: more segments and a cupped, arched card so the silhouette is leafy, not flat
    const sprayGeo = track(
      buildLeafClusterGeometry({ cards: 3, width: 1, height: 1, bend: 0.3, cup: 0.12, segments: [1, 2], normalBlend: 0.55, pivot: "center", seed: 21 }),
    );
    for (const { kind, seed } of LEAF_KINDS) {
      const wantCrown = crownRecs[kind].length > 0;
      const wantSpray = sprayRecs[kind].length > 0;
      const wantFar = farCrownRecs[kind].length > 0;
      if (!wantCrown && !wantSpray && !wantFar) continue;
      stage = `leaves ${kind}`;
      yield;
      if (cancelled) return;
      const tex = createLeafCardTexture({ kind, seed, size: LEAF_TEX_SIZE }); // toolkit cache, shared with the hero
      yield;
      if (wantCrown || wantFar) {
        const wind = reduced ? null : LEAF_LOOK.wind;
        const mat = track(makeLeafMaterial(tex, wind));
        if (wantCrown) {
          const depth = track(makeLeafDepth(tex, wind));
          mount("crowns", instancedFrom(`approach:crown-${kind}`, crownGeo, mat, crownRecs[kind], { cast: true, receive: false, depth }), "crown leaves");
        }
        if (wantFar) {
          mount("trunks-far", instancedFrom(`approach:far-crown-${kind}`, crownGeo, mat, farCrownRecs[kind], { cast: false, receive: false }), "far crown leaves");
        }
      }
      if (wantSpray) {
        const wind = reduced ? null : LEAF_LOOK.sprayWind;
        const mat = track(makeLeafMaterial(tex, wind));
        const depth = track(makeLeafDepth(tex, wind));
        mount("crowns", instancedFrom(`approach:spray-${kind}`, sprayGeo, mat, sprayRecs[kind], { cast: true, receive: false, depth }), "spray leaves");
      }
      yield;
    }

    // ===== ivy ============================================================================================
    stage = "ivy";
    yield;
    if (cancelled) return;
    const ivyTex = createLeafCardTexture(IVY_TEX);
    yield;
    const ivyMat = track(makeIvyMaterial(ivyTex));
    const stemMat = track(makeStemMaterial());
    const umbelMat = track(makeUmbelMaterial());
    // pivot at the bottom edge centre. Close ivy is seen from under a metre: arched in two strips. Mid ivy is flat (2 triangles).
    const ivyGeo = track(cardGeometry({ h: 1, y0: 0, segV: 2, arch: 0.07 }));
    const ivyGeoFlat = track(cardGeometry({ h: 1, y0: 0, segV: 1, arch: 0 }));
    const umbelGeo = track(new THREE.IcosahedronGeometry(1, 0));
    const ivy = { close: { cards: [], acc: createAcc() }, mid: { cards: [], acc: createAcc() } };
    const umbels = [];
    for (const t of list) {
      if (!t.ivy) continue;
      const bucket = t.cls === "close" ? ivy.close : ivy.mid;
      const plan = planIvy(modelFor(t), t.cls, rngFor(t, 4), { flowering: t.id === floweringId });
      for (const card of plan.cards) bucket.cards.push(card);
      for (const run of plan.runners) addRunner(bucket.acc, run, [1, 1, 1]);
      for (const u of plan.umbels) {
        _m.compose(u.p, _q.identity(), _s.set(u.s, u.s * 0.8, u.s));
        umbels.push({ m: _m.toArray(), c: u.c });
      }
      yield;
      if (cancelled) return;
    }
    for (const cls of ["close", "mid"]) {
      const b = ivy[cls];
      const group = cls === "close" ? "trunks-close" : "trunks-mid";
      if (b.cards.length > 0) {
        mount(group, instancedFrom(`approach:ivy-${cls}`, cls === "close" ? ivyGeo : ivyGeoFlat, ivyMat, b.cards, { cast: false, receive: true }), "ivy cards");
      }
      if (accTriangles(b.acc) > 0) {
        const mesh = new THREE.Mesh(track(accToGeometry(b.acc)), stemMat);
        mesh.name = `approach:ivy-runners-${cls}`;
        mesh.receiveShadow = true;
        mount(group, mesh, "ivy runners");
      }
    }
    if (umbels.length > 0) {
      mount("trunks-mid", instancedFrom("approach:ivy-umbels", umbelGeo, umbelMat, umbels, { cast: false, receive: true }), "ivy umbels");
    }
    yield;

    // ===== beard lichen on the broken stubs ================================================================
    stage = "lichen";
    if (lichenRecs.close.length + lichenRecs.mid.length > 0) {
      const tex = track(paintLichenStrands(3));
      const mat = track(makeLichenMaterial(tex));
      const geo = track(cardGeometry({ h: 2, y0: -2, segV: 2, arch: 0.05, flipV: true })); // hangs from y = 0
      for (const cls of ["close", "mid"]) {
        if (lichenRecs[cls].length === 0) continue;
        mount(cls === "close" ? "trunks-close" : "trunks-mid", instancedFrom(`approach:lichen-${cls}`, geo, mat, lichenRecs[cls], { cast: false, receive: false }), "lichen strands");
      }
    }
    yield;
    stats.done = true;
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
        const took = performance.now() - s;
        stats.stageMs[stage] = (stats.stageMs[stage] || 0) + took;
        if (took > 40) stats.slowSteps.push([stage, Math.round(took)]); // dev report: single steps over 40 ms
        if (took > stats.maxStepMs) stats.maxStepMs = took;
        if (r.done) {
          finished = true;
          stats.done = true;
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
