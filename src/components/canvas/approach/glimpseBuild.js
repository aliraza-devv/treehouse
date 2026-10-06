import * as THREE from "three";
import { buildLeafClusterGeometry, makeFoliageDepthMaterial, makeFoliageMaterial } from "@/lib/foliageMaterial";
import { createBarkTextures, createLeafCardTexture } from "@/lib/proceduralTextures";
import { createRng, range } from "@/lib/random";
import { makeRevealable } from "@/lib/sections/reveal";
import { growPlan } from "./glimpseLayout";
import { woodTriangles } from "./glimpsePlants";
import {
  BARK_NORMAL_SCALE,
  BARK_SPEC,
  CLUSTER_GEOMETRY,
  CLUSTER_TRIANGLES,
  FOLIAGE_ALPHA_TEST,
  FOLIAGE_GLOW,
  FOLIAGE_LOOK,
  HUES,
  TEX_SPECS,
  TRIANGLE_BUDGET,
  radialFor,
} from "./glimpseTuning";
import { addStem, createWoodAcc, woodToGeometry } from "./glimpseWood";

// ===========================================================================================
// TREEHOUSE GLIMPSE: the staged build.
//
// createGlimpseBuild() returns a job that the component pumps once per rendered frame with a small
// time budget (step(ms)). The job is one generator, so no single step blocks the main thread: it
//   1. grows the plan (pure maths, a few milliseconds),
//   2. trims it to TRIANGLE_BUDGET if it ever exceeds it,
//   3. fetches the four leaf cards and the bark set from the toolkit cache (free when the hero has
//      painted them, otherwise one texture per step),
//   4. makes the materials (each passed through makeRevealable exactly once),
//   5. sweeps the wood, one mesh per plant, and mounts each as soon as it exists,
//   6. builds the instanced leaf clusters, one InstancedMesh per card texture and wind mode.
// Everything here is seeded: the woodland is identical on every load.
//
// OWNERSHIP. The leaf cards and bark textures live in the toolkit cache, are shared with the hero and
// are NEVER disposed here. Everything else (geometries, materials, depth materials, instanced meshes)
// is created here and disposed with the job.
// ===========================================================================================

export const GROUPS = ["glimpse-wood", "glimpse-leaves"];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

function planTriangles(plants, radial) {
  let t = 0;
  for (const p of plants) t += woodTriangles(p, radial) + p.clusters.length * CLUSTER_TRIANGLES;
  return t;
}

// Drop the least important leaf clusters until the plan fits the budget. Importance is size weighted
// by how sunlit the cluster is (big, bright sprays are what the eye reads); the plant with the most
// clusters gives one up first, so no plant is stripped bare.
function trimToBudget(plants, budget) {
  let total = planTriangles(plants, radialFor);
  let dropped = 0;
  while (total > budget) {
    let host = plants[0];
    for (const p of plants) if (p.clusters.length > host.clusters.length) host = p;
    if (host.clusters.length <= 3) break;
    let worst = 0;
    let worstScore = Infinity;
    host.clusters.forEach((c, i) => {
      const score = c.size * (0.6 + c.lit);
      if (score < worstScore) {
        worstScore = score;
        worst = i;
      }
    });
    host.clusters.splice(worst, 1);
    total -= CLUSTER_TRIANGLES;
    dropped += 1;
  }
  return dropped;
}

// Leaf colour for one cluster: a multiplier on the card albedo (linear RGB), shaded interior to
// sunlit rim by the cluster's own light value, with a per species chance of an accent (copper beech,
// a yellowing hazel leaf, bronze bramble).
function clusterColour(rng, c) {
  const hue = HUES[c.hue];
  const v = range(rng, 0.9, 1.1);
  let r;
  let g;
  let b;
  if (hue.accent && rng() < hue.accent.chance) {
    const k = 0.72 + 0.28 * c.lit;
    [r, g, b] = [hue.accent.rgb[0] * k, hue.accent.rgb[1] * k, hue.accent.rgb[2] * k];
  } else {
    // rim light is not linear in the value: the lit end only shows on the brightest clusters
    const e = c.lit * c.lit * (3 - 2 * c.lit);
    r = hue.dark[0] + (hue.lit[0] - hue.dark[0]) * e;
    g = hue.dark[1] + (hue.lit[1] - hue.dark[1]) * e;
    b = hue.dark[2] + (hue.lit[2] - hue.dark[2]) * e;
  }
  return _c.setRGB(r * v * range(rng, 0.95, 1.06), g * v, b * v * range(rng, 0.94, 1.06));
}

export function createGlimpseBuild({ isReduced = () => false, onPart = () => {} } = {}) {
  const disposables = []; // geometries and materials made here
  const meshes = [];
  let cancelled = false;
  let finished = false;
  let stage = "start";
  const stats = {
    triangles: 0,
    woodTriangles: 0,
    leafTriangles: 0,
    clusters: 0,
    plants: 0,
    dropped: 0,
    frames: 0,
    busyMs: 0,
    maxStepMs: 0,
    done: false,
  };
  const track = (d) => {
    disposables.push(d);
    return d;
  };
  const mount = (name, object) => {
    meshes.push(object);
    onPart(name, object);
  };

  function* pipeline() {
    // ---- 1. the plan ------------------------------------------------------------------------------
    stage = "grow";
    const plants = growPlan();
    stats.plants = plants.length;
    stats.dropped = trimToBudget(plants, TRIANGLE_BUDGET);
    yield;
    if (cancelled) return;

    // ---- 2. textures (toolkit cache, shared with the hero, never disposed here) ------------------------
    const leafTex = [];
    for (let i = 0; i < TEX_SPECS.length; i++) {
      stage = `leaf ${TEX_SPECS[i].kind}`;
      leafTex.push(createLeafCardTexture(TEX_SPECS[i]));
      yield;
      if (cancelled) return;
    }
    stage = "bark";
    const bark = createBarkTextures(BARK_SPEC);
    yield;
    if (cancelled) return;

    // ---- 3. materials ------------------------------------------------------------------------------------
    stage = "materials";
    const reduced = isReduced();
    const barkMat = track(
      makeRevealable(
        new THREE.MeshStandardMaterial({
          map: bark.map,
          normalMap: bark.normalMap,
          normalScale: new THREE.Vector2(BARK_NORMAL_SCALE, BARK_NORMAL_SCALE),
          roughnessMap: bark.roughnessMap,
          roughness: 1,
          metalness: 0,
          vertexColors: true,
        }),
      ),
    );
    // One foliage material per card texture and wind mode. Under reduced motion there is a single calm,
    // windless material per card (the shared wind clock is also held at zero by the hero).
    const foliage = TEX_SPECS.map((_, i) => {
      const look = FOLIAGE_LOOK[i];
      const make = (wind) => {
        const common = { map: leafTex[i].map, alphaTest: FOLIAGE_ALPHA_TEST };
        const mat = track(
          makeRevealable(
            makeFoliageMaterial({
              ...common,
              normalMap: leafTex[i].normalMap,
              translucency: look.translucency,
              roughness: look.roughness,
              normalScale: look.normalScale,
              transmissionColor: FOLIAGE_GLOW,
              wind,
            }),
          ),
        );
        const depth = track(makeFoliageDepthMaterial({ ...common, wind }));
        return { mat, depth };
      };
      return reduced ? { calm: make(null), sway: null } : { calm: make(look.calm), sway: make(look.sway) };
    });
    yield;
    if (cancelled) return;

    // ---- 4. wood: one mesh per plant, mounted as it is built --------------------------------------------------
    for (const plant of plants) {
      stage = `wood ${plant.spec.id}`;
      const acc = createWoodAcc();
      const y0 = plant.stems[0].pts[0][1] + 0.05; // ground level under the plant
      plant.stems.forEach((stem, i) => addStem(acc, stem, y0, plant.spec.seed + i * 17));
      const geometry = track(woodToGeometry(acc));
      const mesh = new THREE.Mesh(geometry, barkMat);
      mesh.name = `approach:glimpse-${plant.spec.id}-wood`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mount("glimpse-wood", mesh);
      stats.woodTriangles += acc.idx.length / 3;
      yield;
      if (cancelled) return;
    }

    // ---- 5. leaf clusters, instanced per card texture and wind mode ---------------------------------------------
    stage = "leaves";
    const buckets = new Map(); // key -> { tex, windy, items: [{ plantSeed, cluster }] }
    for (const plant of plants) {
      for (const c of plant.clusters) {
        const windy = c.sway && !reduced ? 1 : 0;
        const key = `${c.tex}:${windy}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { tex: c.tex, windy, items: [] }));
        b.items.push({ seed: plant.spec.seed, cluster: c });
      }
    }
    for (const [key, bucket] of buckets) {
      stage = `leaves ${key}`;
      const geometry = track(
        buildLeafClusterGeometry({ ...CLUSTER_GEOMETRY, width: 1, height: 1, pivot: "bottom", seed: bucket.tex + 1 }),
      );
      const set = foliage[bucket.tex];
      const pair = bucket.windy ? set.sway : set.calm;
      const mesh = new THREE.InstancedMesh(geometry, pair.mat, bucket.items.length);
      mesh.customDepthMaterial = pair.depth;
      // One seeded stream per bucket for spin and colour; a cluster's look never depends on where it stands.
      const rng = createRng(bucket.items[0].seed * 31 + bucket.tex * 7 + bucket.windy);
      bucket.items.forEach(({ cluster: c }, i) => {
        // Orient the cluster's local +Y (its growth axis, cards hang from the base point) along c.d, then spin
        // it round that axis by a random angle so crossed cards never line up between neighbours.
        _d.set(c.d[0], c.d[1], c.d[2]);
        _q.setFromUnitVectors(Y, _d);
        _qs.setFromAxisAngle(Y, rng() * Math.PI * 2);
        _q.multiply(_qs);
        _p.set(c.p[0], c.p[1], c.p[2]);
        // width varies a little round the evaluator's isotropic size; height is exactly the size it measured
        _s.set(c.size * range(rng, 0.94, 1.08), c.size, c.size * range(rng, 0.94, 1.08));
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, clusterColour(rng, c));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `approach:glimpse-leaves-${FOLIAGE_LOOK[bucket.tex].name}-${bucket.windy ? "sway" : "calm"}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mount("glimpse-leaves", mesh);
      stats.clusters += bucket.items.length;
      stats.leafTriangles += bucket.items.length * CLUSTER_TRIANGLES;
      yield;
      if (cancelled) return;
    }

    stats.triangles = stats.woodTriangles + stats.leafTriangles;
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
        if (took > stats.maxStepMs) stats.maxStepMs = took;
        if (r.done) {
          finished = true;
          stats.done = true;
          break;
        }
      } while (performance.now() - t0 < budgetMs && !cancelled);
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
    get stage() {
      return stage;
    },
  };
}
