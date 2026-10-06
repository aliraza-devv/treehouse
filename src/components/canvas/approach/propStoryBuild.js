// The staged build of everything StoryProps draws: the wellington boot, the cut stump with its coil of hemp
// rope, and the hand painted arrow nailed to a tree. A pure (non React) scheduler like pathBuild.js:
// createStoryBuild() returns { step(budgetMs), done, result, dispose }.
//
// BROWSER ONLY (the hero toolkit textures use canvas). Every material goes through makeRevealable.

import * as THREE from "three";
import { makeRevealable } from "@/lib/sections/reveal";
import { createBarkTextures, createMossTexture, createRopeTextures } from "@/lib/proceduralTextures";
import { createTaskRunner, disposeAll, disposeTextureSet, textureSetFrom } from "./propKit";
import { paintStumpTop, paintArrowBoard, paintSole } from "./propStoryTextures";
import { buildBoot, buildStump, buildArrow } from "./propStoryGeometry";

// ------------------------------------------------------------------------------------------------
// TUNING (materials)
// ------------------------------------------------------------------------------------------------
export const STORY_MATERIAL = {
  rubberRoughness: 0.42, // a faint sheen: wet rubber catches the sky
  stumpTopNormal: 1.2,
  barkNormal: 1.0,
  arrowNormal: 1.2,
  soleNormal: 1.1,
};

export function createStoryBuild() {
  const runner = createTaskRunner();
  const owned = [];
  const sets = [];
  const s = { boot: null, stump: null, arrow: null, top: null, sole: null, board: null };
  const result = { objects: [], triangles: 0, triangleBreakdown: {}, placement: {} };

  // the three geometries are separate chunks (the first also builds the trunk list the boot and arrow query)
  runner.fn("boot", () => {
    s.boot = buildBoot();
  });
  runner.fn("stump", () => {
    s.stump = buildStump();
  });
  runner.fn("arrow", () => {
    s.arrow = buildArrow();
  });
  runner.gen(
    "stumpTop",
    () => paintStumpTop(1, 0.31),
    (v) => {
      s.top = textureSetFrom(v, v.w, v.h, v.texelMetres);
      sets.push(s.top);
    },
  );
  runner.gen(
    "arrowBoard",
    () => paintArrowBoard(1),
    (v) => {
      s.board = textureSetFrom(v, v.w, v.h, v.texelMetres);
      sets.push(s.board);
    },
  );
  runner.gen(
    "sole",
    () => paintSole(1),
    (v) => {
      s.sole = textureSetFrom(v, v.w, v.h, v.texelMetres);
      sets.push(s.sole);
    },
  );

  runner.fn("assemble", () => {
    const keep = (x) => {
      owned.push(x);
      return x;
    };
    const add = (name, object, tris) => {
      object.name = `story:${name}`;
      result.objects.push(object);
      result.triangleBreakdown[name] = Math.round(tris);
      result.triangles += tris;
    };
    const std = (extra) => keep(makeRevealable(new THREE.MeshStandardMaterial({ metalness: 0, ...extra })));
    const pbr = (set, extra) =>
      std({
        map: set.map,
        normalMap: set.normalMap,
        roughnessMap: set.roughnessMap,
        aoMap: set.roughnessMap,
        roughness: 1,
        ...extra,
      });
    const ns = (k) => new THREE.Vector2(k, k);

    // shared hero textures (cached: free once the hero or the path has built them, and never disposed here)
    const bark = createBarkTextures({ seed: 7 });
    const mossT = createMossTexture({ seed: 4, size: 256 });
    const ropeT = createRopeTextures({ seed: 9, size: 256 });

    // ---- the boot -------------------------------------------------------------------------------------------------------------------
    const rubber = std({ vertexColors: true, roughness: STORY_MATERIAL.rubberRoughness });
    const sole = pbr(s.sole, { normalScale: ns(STORY_MATERIAL.soleNormal) });
    const yarn = std({ vertexColors: true, roughness: 0.95 });
    const boot = new THREE.Mesh(keep(s.boot.geometry), [rubber, sole, yarn]);
    boot.castShadow = true;
    boot.receiveShadow = true;
    add("boot", boot, s.boot.tris.boot);
    const bootMoss = new THREE.Mesh(keep(s.boot.moss), pbr(mossT, { vertexColors: true }));
    bootMoss.receiveShadow = true;
    add("bootMoss", bootMoss, s.boot.tris.moss);
    const litter = new THREE.Mesh(keep(s.boot.litter), std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    litter.receiveShadow = true;
    add("bootLitter", litter, s.boot.tris.litter);

    // ---- the stump ------------------------------------------------------------------------------------------------------------------
    const barkMat = pbr(bark, { vertexColors: true, normalScale: ns(STORY_MATERIAL.barkNormal) });
    const topMat = pbr(s.top, { normalScale: ns(STORY_MATERIAL.stumpTopNormal) });
    const mossMat = pbr(mossT, { vertexColors: true });
    const fungusMat = std({ vertexColors: true, roughness: 0.7 });
    const shootMat = std({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const stump = new THREE.Mesh(keep(s.stump.geometry), [barkMat, topMat, mossMat, fungusMat, shootMat]);
    stump.castShadow = true;
    stump.receiveShadow = true;
    add("stump", stump, s.stump.tris.stump);
    const rope = new THREE.Mesh(keep(s.stump.rope), pbr(ropeT, { vertexColors: true }));
    rope.castShadow = true;
    rope.receiveShadow = true;
    add("rope", rope, s.stump.tris.rope);

    // ---- the arrow ------------------------------------------------------------------------------------------------------------------------
    const arrowMat = pbr(s.board, { normalScale: ns(STORY_MATERIAL.arrowNormal) });
    const iron = std({ color: new THREE.Color(0.1, 0.1, 0.1), metalness: 0.7, roughness: 0.55 });
    const arrow = new THREE.Mesh(keep(s.arrow.geometry), [arrowMat, iron]);
    arrow.receiveShadow = true;
    add("arrow", arrow, s.arrow.tris);

    result.triangles = Math.round(result.triangles);
    result.placement = { boot: s.boot.placement, stump: s.stump.placement, arrow: s.arrow.placement };
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
      for (const set of sets) disposeTextureSet(set);
      // the hero's cached bark, moss and rope textures are shared and stay
    },
  };
  return build;
}
