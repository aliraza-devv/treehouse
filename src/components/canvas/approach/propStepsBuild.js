// The staged build of everything TrunkSteps draws. A pure (non React) scheduler like pathBuild.js:
// createStepsBuild() returns { step(budgetMs), done, result, dispose }. The geometry is built in a few
// generator chunks (placement against the hero wood, treads, steel, rope, roots); every texture is the hero's
// own cached set (beam wood, bark, rope, ground, smudge), so nothing is painted here.
//
// BROWSER ONLY (the hero toolkit textures use canvas). Every material goes through makeRevealable.

import * as THREE from "three";
import { makeRevealable } from "@/lib/sections/reveal";
import { createBarkTextures, createGlassSmudgeTexture, createGroundTextures, createRopeTextures, createWoodTextures } from "@/lib/proceduralTextures";
import { createTaskRunner, disposeAll } from "./propKit";
import { buildStepsStaged, stepReport } from "./propStepsGeometry";
import { TONES, colorFromBytes } from "./propTones";

// ------------------------------------------------------------------------------------------------
// TUNING (materials)
// ------------------------------------------------------------------------------------------------
export const STEPS_MATERIAL = {
  woodNormal: 1.25,
  woodRoughness: 1.0,
  ironMetalness: 0.78,
  ironRoughness: 1.15, // times the smudge map (oil and rust give it a mottled sheen)
  barkNormal: 1.0,
};

export function createStepsBuild() {
  const runner = createTaskRunner();
  const owned = [];
  const s = { geo: null };
  const result = { objects: [], triangles: 0, triangleBreakdown: {}, report: null };

  // the geometry: a generator, one chunk per yield (placement against the hero wood, treads, steel, rope, roots)
  runner.gen(
    "geometry",
    () => buildStepsStaged(),
    (v) => {
      s.geo = v;
    },
  );

  runner.fn("assemble", () => {
    const keep = (x) => {
      owned.push(x);
      return x;
    };
    const add = (name, object, tris) => {
      object.name = `steps:${name}`;
      result.objects.push(object);
      result.triangleBreakdown[name] = Math.round(tris);
      result.triangles += tris;
    };
    const std = (extra) => keep(makeRevealable(new THREE.MeshStandardMaterial({ metalness: 0, ...extra })));
    const pbr = (set, extra) =>
      std({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, aoMap: set.roughnessMap, roughness: 1, ...extra });
    const ns = (k) => new THREE.Vector2(k, k);

    // the hero's cached textures (shared, never disposed here)
    const beam = createWoodTextures({ kind: "beam", seed: 5, size: 384 });
    const bark = createBarkTextures({ seed: 7 });
    const ropeT = createRopeTextures({ seed: 9, size: 256 });
    const ground = createGroundTextures({ seed: 11, size: 384 });
    const smudge = createGlassSmudgeTexture({ seed: 6, size: 256 });

    const woodMat = pbr(beam, { vertexColors: true, normalScale: ns(STEPS_MATERIAL.woodNormal), roughness: STEPS_MATERIAL.woodRoughness });
    const treads = new THREE.Mesh(keep(s.geo.wood), woodMat);
    treads.castShadow = true;
    treads.receiveShadow = true;
    add("treads", treads, s.geo.tris.treads);

    // wrought iron: dark, blackened, mottled by the smudge map; double sided for the thin washers
    const ironMat = std({
      color: colorFromBytes(TONES.iron).clone(),
      metalness: STEPS_MATERIAL.ironMetalness,
      roughness: STEPS_MATERIAL.ironRoughness,
      roughnessMap: smudge,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const iron = new THREE.Mesh(keep(s.geo.iron), ironMat);
    iron.castShadow = true;
    iron.receiveShadow = true;
    add("iron", iron, s.geo.tris.iron);

    const rope = new THREE.Mesh(keep(s.geo.rope), pbr(ropeT, { vertexColors: true }));
    rope.castShadow = true;
    rope.receiveShadow = true;
    add("handline", rope, s.geo.tris.rope);

    const roots = new THREE.Mesh(keep(s.geo.roots), pbr(bark, { vertexColors: true, normalScale: ns(STEPS_MATERIAL.barkNormal) }));
    roots.castShadow = true;
    roots.receiveShadow = true;
    add("roots", roots, s.geo.tris.roots);

    const soil = new THREE.Mesh(keep(s.geo.soil), pbr(ground, { vertexColors: true }));
    soil.receiveShadow = true;
    add("soil", soil, s.geo.tris.soil);

    result.triangles = Math.round(result.triangles);
    result.report = stepReport(s.geo);
  });

  const build = {
    done: false,
    result,
    timing: runner.timing,
    step(budgetMs = 6) {
      runner.step(budgetMs);
      build.done = runner.done;
    },
    dispose() {
      runner.cancel();
      disposeAll(owned);
      // the hero's cached textures stay
    },
  };
  return build;
}
