// The staged build of everything Signposts draws. A pure (non React) scheduler: createSignBuild() returns
// { step(budgetMs), done, result, dispose }. The component calls step() once per frame, so the texture
// painting (a hewn post sheet, four lettered boards, grass, stone) and the geometry spread over many frames
// and no single frame holds the main thread for much more than 25 ms.
//
// BROWSER ONLY (the hero toolkit textures use canvas). Every material goes through makeRevealable, so the
// whole thing is invisible at progress 0 and dissolves in with the rest of the world.

import * as THREE from "three";
import { SIGNS } from "@/lib/sections/world";
import { makeRevealable } from "@/lib/sections/reveal";
import { makeFoliageMaterial } from "@/lib/foliageMaterial";
import { createGroundTextures, createMossTexture } from "@/lib/proceduralTextures";
import { createTaskRunner, dataTexture, disposeTextureSet, disposeAll, textureSetFrom, trisOf } from "./propKit";
import { paintPostSheet, paintBoardSheet, paintGrassCard, paintStoneSheet } from "./propSignTextures";
import { planSign, buildSignGeometry, buildSignClutter, signFrame } from "./propSignGeometry";

// ------------------------------------------------------------------------------------------------
// TUNING (materials)
// ------------------------------------------------------------------------------------------------
export const SIGN_MATERIAL = {
  boardNormal: 1.35, // a touch over physical, so the V grooves read from 5 m even in flat, misty light
  boardRoughness: 1.0, // times the painted roughness map (about 0.85 to 0.95)
  postNormal: 1.3,
  stoneNormal: 1.1,
  grassWind: { amplitude: 0.03, speed: 1.4 },
  grassTranslucency: 0.45,
};

export function createSignBuild({ isReduced = () => false } = {}) {
  const runner = createTaskRunner();
  const owned = []; // geometries and materials made here
  const sets = []; // texture sets made here (the hero's cached ground and moss textures are NOT disposed)
  const s = { plans: null, frames: null, post: null, postRaw: null, boards: [], boardRaw: [], grass: null, grassTex: null, stone: null };
  const result = { objects: [], triangles: 0, triangleBreakdown: {}, frames: null, plans: null };

  runner.fn("plan", () => {
    s.plans = SIGNS.map((sign, i) => planSign(sign, i));
    s.frames = SIGNS.map((sign) => signFrame(sign));
  });
  // each sheet is painted in chunks, then turned into textures (the normal map is a chunk of its own)
  runner.gen(
    "post",
    () => paintPostSheet(1),
    (v) => {
      s.postRaw = v;
    },
  );
  runner.fn("postTextures", () => {
    const v = s.postRaw;
    s.post = textureSetFrom(v, v.w, v.h, v.texelMetres, { tileU: true, tileV: true });
    sets.push(s.post);
    s.postRaw = null;
  });
  SIGNS.forEach((sign, i) => {
    runner.gen(
      `board:${sign.id}`,
      () => paintBoardSheet(s.plans[i].texture),
      (v) => {
        s.boardRaw[i] = v;
        s.plans[i].lettering = v.lettering; // what was carved (width in metres, stroke data) for any later check
      },
    );
    runner.fn(`boardTextures:${sign.id}`, () => {
      const v = s.boardRaw[i];
      s.boards[i] = textureSetFrom(v, v.w, v.h, v.texelMetres, { normalStrength: 1 });
      sets.push(s.boards[i]);
      s.boardRaw[i] = null;
    });
  });
  runner.gen(
    "grass",
    () => paintGrassCard(3),
    (v) => {
      s.grassTex = dataTexture(v.rgba, v.w, v.h, { srgb: true });
      s.grassTex.userData.own = true;
    },
  );
  runner.gen(
    "stone",
    () => paintStoneSheet(5),
    (v) => {
      s.stone = textureSetFrom(v, v.w, v.h, v.texelMetres, { tileU: true, tileV: true });
      sets.push(s.stone);
    },
  );
  // (the stone and the grass card are small: their textures are made in the same chunk)

  runner.fn("assemble", () => {
    const keep = (x) => {
      owned.push(x);
      return x;
    };
    const add = (name, object, tris) => {
      object.name = `sign:${name}`;
      result.objects.push(object);
      result.triangleBreakdown[name] = Math.round(tris);
      result.triangles += tris;
    };
    const pbr = (set, extra) =>
      keep(
        makeRevealable(
          new THREE.MeshStandardMaterial({
            map: set.map,
            normalMap: set.normalMap,
            roughnessMap: set.roughnessMap,
            aoMap: set.roughnessMap,
            roughness: 1,
            metalness: 0,
            ...extra,
          }),
        ),
      );

    // weathered oak for posts, board backs and edges, pegs (vertex colours tint and moss the foot)
    const woodMat = pbr(s.post, { vertexColors: true, normalScale: new THREE.Vector2(SIGN_MATERIAL.postNormal, SIGN_MATERIAL.postNormal) });
    const boardMats = s.boards.map((set) =>
      pbr(set, {
        normalScale: new THREE.Vector2(SIGN_MATERIAL.boardNormal, SIGN_MATERIAL.boardNormal),
        roughness: SIGN_MATERIAL.boardRoughness,
      }),
    );

    // ---- the four signs ----------------------------------------------------------------------------------------
    SIGNS.forEach((sign, i) => {
      const geo = keep(buildSignGeometry(s.plans[i]));
      const mesh = new THREE.Mesh(geo, [boardMats[i], woodMat]);
      const f = s.frames[i];
      mesh.position.set(f.x, f.y, f.z);
      mesh.quaternion.copy(f.quaternion);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      add(`post:${sign.id}`, mesh, trisOf(geo));
    });

    // ---- the ground round the feet: soil, stones, moss, tufts ---------------------------------------------------------
    const clutter = buildSignClutter(s.frames, s.plans);
    const ground = createGroundTextures({ seed: 11, size: 384 }); // the hero's floor set (cached: free once the hero has it)
    const soilMat = pbr(ground, { vertexColors: true, roughness: 1 });
    const soil = new THREE.Mesh(keep(clutter.soil), soilMat);
    soil.receiveShadow = true;
    add("soil", soil, clutter.counts.soil);

    const stoneMat = pbr(s.stone, { vertexColors: true, normalScale: new THREE.Vector2(SIGN_MATERIAL.stoneNormal, SIGN_MATERIAL.stoneNormal) });
    const stones = new THREE.Mesh(keep(clutter.stones), stoneMat);
    stones.castShadow = true;
    stones.receiveShadow = true;
    add("stones", stones, clutter.counts.stones);

    const mossT = createMossTexture({ seed: 4, size: 256 });
    const mossMat = pbr(mossT, { vertexColors: true, roughness: 1 });
    const moss = new THREE.Mesh(keep(clutter.moss), mossMat);
    moss.receiveShadow = true;
    add("moss", moss, clutter.counts.moss);

    // grass tufts: alpha cut cards with the shared foliage material (backlit translucency, a little wind).
    // One mesh per sign, sitting at the sign's foot, so every tuft group sways on its own phase.
    const grassMat = keep(
      makeRevealable(
        makeFoliageMaterial({
          map: s.grassTex,
          alphaTest: 0.5,
          translucency: SIGN_MATERIAL.grassTranslucency,
          roughness: 0.85,
          volumeNormals: false,
          wind: isReduced() ? null : SIGN_MATERIAL.grassWind,
        }),
      ),
    );
    grassMat.vertexColors = true;
    grassMat.alphaToCoverage = true;
    clutter.grass.forEach((g, i) => {
      keep(g);
      const mesh = new THREE.Mesh(g, grassMat);
      mesh.position.set(s.frames[i].x, 0, s.frames[i].z);
      mesh.receiveShadow = true;
      add(`grass:${SIGNS[i].id}`, mesh, trisOf(g));
    });
    result.triangles = Math.round(result.triangles);
    result.frames = s.frames;
    result.plans = s.plans;
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
      s.grassTex?.dispose();
      // the hero's cached ground and moss textures are shared and stay
    },
  };
  return build;
}
