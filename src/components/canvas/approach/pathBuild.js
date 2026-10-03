// The staged build of everything PathAndGround draws. A pure (non React) scheduler: createPathBuild()
// returns { step(budgetMs), done, result, dispose }. The component calls step() once per frame, so the
// texture painting and geometry building spread over many frames and no single frame holds the main
// thread for more than about 40 ms (each task is a generator chunk or a small build, see TASKS).
//
// BROWSER ONLY (the painters use canvas). Every material goes through makeRevealable (the dissolve
// that keeps the approved hero frame untouched at progress 0).

import * as THREE from "three";
import { makeRevealable } from "@/lib/sections/reveal";
import { createBarkTextures } from "@/lib/proceduralTextures";
import { buildPathLayout } from "./pathLayout";
import { buildScatter } from "./pathScatter";
import {
  buildRibbonGeometry,
  buildStoneGeometry,
  buildRootGeometry,
  buildLeafGeometry,
  buildTwigGeometry,
  buildPebbleGeometry,
  buildMastGeometry,
  buildAcornCapGeometry,
} from "./pathGeometry";
import { paintPathMicro, paintPathMacro, paintStoneTexture, paintLeafAtlas, measureMicroMean, MACRO_MULT_RANGE, disposeTextureSet } from "./pathTextures";
import { rideHeight } from "./pathMath";

// ------------------------------------------------------------------------------------------------
// TUNING (materials)
// ------------------------------------------------------------------------------------------------
export const PATH_LOOK = {
  groundRoughness: 0.95, // times the painted roughness map (about 0.8 on the dirt, lower where polished or wet)
  groundNormal: 1.1,
  puddleRoughness: 0.1, // water: glossy, it mirrors the sky
  puddleDarken: 0.5, // albedo multiplier at the heart of a puddle
  rippleStrength: 0.012, // view space normal wobble on puddles (0 when the visitor prefers reduced motion)
  stoneNormal: 1.2,
  rootPolishedNormal: 0.4, // the roots across the path are boot polished: bark relief mostly worn off
  rootFlareNormal: 1.0,
  leafAlphaTest: 0.45,
};

const GROUND_VERT_DECL = "attribute vec2 aMacro;\nvarying vec2 vMacro;\n";
const GROUND_FRAG_DECL = "uniform sampler2D uMacroA;\nuniform sampler2D uMacroB;\nuniform float uTime;\nuniform float uRipple;\nuniform float uPuddleDark;\nuniform float uPuddleRough;\nvarying vec2 vMacro;\n";

const MULT = MACRO_MULT_RANGE.toFixed(1); // the macro map stores the colour multiplier divided by this

// Fragment patches for the ground. pathA = (colour multiplier / 2, alpha), pathB = (puddle, damp,
// polish, flatten). The micro albedo alpha holds fine cut noise.
const MAP_PATCH = /* glsl */ `
#include <map_fragment>
vec4 pathA = texture2D( uMacroA, vMacro );
vec4 pathB = texture2D( uMacroB, vMacro );
float pathCut = diffuseColor.a;
diffuseColor.rgb *= pathA.rgb * ${MULT};
diffuseColor.rgb *= mix( 1.0, uPuddleDark, pathB.r ) * mix( 1.0, 0.82, pathB.g );
diffuseColor.a = clamp( pathA.a + ( pathCut - 0.5 ) * 0.6, 0.0, 1.0 );
`;
const ROUGH_PATCH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, uPuddleRough, pathB.r );
roughnessFactor = max( roughnessFactor - pathB.b * 0.14 - pathB.g * 0.05, 0.05 );
`;
const NORMAL_PATCH = /* glsl */ `
#include <normal_fragment_maps>
// water is flat: blend the pressed-earth normal away, then add a faint ripple wobble
normal = normalize( mix( normal, normalize( vNormal ), pathB.r * 0.95 ) );
vec2 rp = vMacro * vec2( 180.0, 700.0 );
float rt = uTime * 0.6;
vec3 rippleN = vec3( sin( rp.x * 1.3 + rp.y * 0.7 + rt ) + sin( rp.x * 0.5 - rp.y * 1.1 - rt * 1.3 ), 0.0, sin( rp.y * 0.9 + rt * 0.8 ) );
normal = normalize( normal + rippleN * uRipple * pathB.r );
`;

function makeGroundMaterial(micro, macro, uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    map: micro.map,
    normalMap: micro.normalMap,
    normalScale: new THREE.Vector2(PATH_LOOK.groundNormal, PATH_LOOK.groundNormal),
    roughnessMap: micro.roughnessMap,
    aoMap: micro.roughnessMap,
    aoMapIntensity: 1,
    roughness: PATH_LOOK.groundRoughness,
    metalness: 0,
    alphaTest: 0.5,
    // the ragged edge is alpha cut; with MSAA this turns into a soft, antialiased fringe
    alphaToCoverage: true,
    // The strip rides 2 cm above the hero floor. A CONSTANT depth bias (no slope scaled factor, which
    // at grazing angles would grow to centimetres and bury the stones, roots and leaves that sit just
    // above the strip) is cheap insurance against z-fighting far away.
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroA = { value: macro.macroA };
    shader.uniforms.uMacroB = { value: macro.macroB };
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uRipple = uniforms.uRipple;
    shader.uniforms.uPuddleDark = { value: PATH_LOOK.puddleDarken };
    shader.uniforms.uPuddleRough = { value: PATH_LOOK.puddleRoughness };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GROUND_VERT_DECL}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMacro = aMacro;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GROUND_FRAG_DECL}`)
      .replace("#include <map_fragment>", MAP_PATCH)
      .replace("#include <roughnessmap_fragment>", ROUGH_PATCH)
      .replace("#include <normal_fragment_maps>", NORMAL_PATCH);
  };
  mat.customProgramCacheKey = () => "path-ground-v1";
  return makeRevealable(mat);
}

// Leaves: one atlas, one InstancedMesh. The per instance attribute aCell = (column, row) picks the
// painted leaf, so a single draw call carries every species and both fresh and decayed leaves.
function makeLeafMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: PATH_LOOK.leafAlphaTest,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aCell;")
      .replace(
        "#include <uv_vertex>",
        // atlas: 4 columns x 2 rows, canvas row 0 is the TOP (texture v = 1)
        "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2( ( vMapUv.x + aCell.x ) * 0.25, ( vMapUv.y + 1.0 - aCell.y ) * 0.5 );\n#endif",
      );
  };
  mat.customProgramCacheKey = () => "path-leaf-atlas-v1";
  return makeRevealable(mat);
}

function makeInstanced(geometry, material, out, { cast = false } = {}) {
  const n = out.count;
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
  mesh.instanceMatrix.array.set(out.matrix.subarray(0, n * 16));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(out.color.slice(0, Math.max(3, n * 3)), 3);
  mesh.count = n;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

const trisOf = (geometry, instances = 1) => (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3) * instances;

// ------------------------------------------------------------------------------------------------
// The build
// ------------------------------------------------------------------------------------------------
export function createPathBuild() {
  const disposables = []; // geometries and materials (textures are in `textureSets`)
  const textureSets = [];
  const meshes = [];
  const uniforms = { uTime: { value: 0 }, uRipple: { value: PATH_LOOK.rippleStrength } };
  const s = { layout: null, bark: null, microMean: null, micro: null, macro: null, stone: null, leaves: null, scatter: null, geo: {}, mats: {} };
  const timing = { totalMs: 0, maxChunkMs: 0, textures: {} };
  let cancelled = false;

  // a task is a function returning true when finished; a generator task advances one chunk per call
  const gen = (name, factory, onDone) => {
    let g = null;
    return () => {
      g ??= factory();
      const t0 = performance.now();
      const r = g.next();
      timing.textures[name] = (timing.textures[name] ?? 0) + (performance.now() - t0);
      if (r.done) {
        onDone(r.value);
        return true;
      }
      return false;
    };
  };
  const fn = (f) => () => {
    f();
    return true;
  };

  const tasks = [
    fn(() => {
      s.layout = buildPathLayout();
    }),
    // the hero bark set (cached: free when the hero already painted it, which it normally has)
    fn(() => {
      s.bark = createBarkTextures({ seed: 7 });
    }),
    gen("micro", () => paintPathMicro(), (v) => {
      s.micro = v;
      textureSets.push(v);
      s.microMean = measureMicroMean(v.map);
    }),
    gen("macro", () => paintPathMacro(s.layout, s.microMean), (v) => {
      s.macro = v;
      textureSets.push(v);
    }),
    gen("stone", () => paintStoneTexture(), (v) => {
      s.stone = v;
      textureSets.push(v);
    }),
    gen("leaves", () => paintLeafAtlas(), (v) => {
      s.leaves = v;
      textureSets.push(v);
    }),
    fn(() => {
      s.scatter = buildScatter(s.layout);
    }),
    fn(() => {
      s.geo.ribbon = buildRibbonGeometry();
      s.geo.rootsCross = buildRootGeometry(s.layout.roots.crossing, { polishOnDirt: true, seed: 1 });
      s.geo.rootsFlare = buildRootGeometry(s.layout.roots.flares, { polishOnDirt: false, seed: 2 });
      s.geo.stones = [0, 1, 2, 3].map((v) => buildStoneGeometry(v));
      s.geo.leaf = buildLeafGeometry();
      s.geo.twig = buildTwigGeometry();
      s.geo.pebble = buildPebbleGeometry();
      s.geo.mast = buildMastGeometry();
      s.geo.acorn = buildAcornCapGeometry();
      disposables.push(s.geo.ribbon, s.geo.rootsCross, s.geo.rootsFlare, ...s.geo.stones, s.geo.leaf, s.geo.twig, s.geo.pebble, s.geo.mast, s.geo.acorn);
    }),
  ];

  const result = { objects: [], triangles: 0, triangleBreakdown: {}, uniforms, timing, layout: null };

  // Assemble meshes and materials from everything built. Runs once, as the last task.
  const assemble = () => {
    const { layout, scatter, geo } = s;
    result.layout = layout;
    const add = (name, mesh, tris) => {
      mesh.name = `path:${name}`;
      meshes.push(mesh);
      result.objects.push(mesh);
      result.triangleBreakdown[name] = Math.round(tris);
      result.triangles += tris;
    };

    // 1. the dirt ribbon
    const groundMat = makeGroundMaterial(s.micro, s.macro, uniforms);
    disposables.push(groundMat);
    const ribbon = new THREE.Mesh(geo.ribbon, groundMat);
    ribbon.receiveShadow = true;
    ribbon.renderOrder = 1;
    add("ribbon", ribbon, trisOf(geo.ribbon));

    // 2. stepping stones: 4 variant geometries, instanced
    const stoneMat = makeRevealable(
      new THREE.MeshStandardMaterial({
        map: s.stone.map,
        normalMap: s.stone.normalMap,
        normalScale: new THREE.Vector2(PATH_LOOK.stoneNormal, PATH_LOOK.stoneNormal),
        roughnessMap: s.stone.roughnessMap,
        aoMap: s.stone.roughnessMap,
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      }),
    );
    disposables.push(stoneMat);
    const d = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let v = 0; v < 4; v++) {
      const list = layout.stones.filter((st) => st.variant === v);
      if (!list.length) continue;
      const out = { count: 0, matrix: new Float32Array(list.length * 16), color: new Float32Array(list.length * 3) };
      for (const st of list) {
        // Unit stone: top at y = 1, buried rim at y = 0.05. Scale y by (top + sink) and drop the
        // origin `sink` below the dirt, so the dome stands `top` proud and the rim hides in the soil.
        const sy = st.top + st.sink;
        d.position.set(st.x, rideHeight(st.x, st.z) - st.sink, st.z);
        d.rotation.set(st.pitch, st.yaw, st.roll, "YXZ");
        d.scale.set(st.rx, sy, st.rz);
        d.updateMatrix();
        out.matrix.set(d.matrix.elements, out.count * 16);
        // warm sandstone to cool flint, darker where the stone is wet
        tint.setRGB(1.08 + (0.82 - 1.08) * st.grey, 0.97 + (0.88 - 0.97) * st.grey, 0.84 + (0.95 - 0.84) * st.grey, THREE.LinearSRGBColorSpace);
        tint.multiplyScalar((1 - 0.2 * st.wetness) * (0.92 + 0.16 * ((st.id * 0.618) % 1)));
        out.color.set([tint.r, tint.g, tint.b], out.count * 3);
        out.count++;
      }
      add(`stones${v}`, makeInstanced(geo.stones[v], stoneMat, out, { cast: true }), trisOf(geo.stones[v], out.count));
    }

    // 3. roots: the polished crossings and the flares at the close trunks (they share the hero bark)
    const bark = s.bark;
    const rootMaterial = (normal, roughness) =>
      makeRevealable(
        new THREE.MeshStandardMaterial({
          map: bark.map,
          normalMap: bark.normalMap,
          normalScale: new THREE.Vector2(normal, normal),
          roughnessMap: bark.roughnessMap,
          aoMap: bark.roughnessMap,
          roughness,
          metalness: 0,
          vertexColors: true,
        }),
      );
    const crossMat = rootMaterial(PATH_LOOK.rootPolishedNormal, 0.78);
    const flareMat = rootMaterial(PATH_LOOK.rootFlareNormal, 1);
    disposables.push(crossMat, flareMat);
    const rc = new THREE.Mesh(geo.rootsCross, crossMat);
    rc.castShadow = true;
    rc.receiveShadow = true;
    add("rootsCrossing", rc, trisOf(geo.rootsCross));
    const rf = new THREE.Mesh(geo.rootsFlare, flareMat);
    rf.castShadow = true;
    rf.receiveShadow = true;
    add("rootsFlares", rf, trisOf(geo.rootsFlare));

    // 4. litter: leaves (one atlas), twigs, pebbles, beech mast, acorn cups
    const leafMat = makeLeafMaterial(s.leaves.atlas);
    disposables.push(leafMat);
    geo.leaf.setAttribute("aCell", new THREE.InstancedBufferAttribute(scatter.leaves.cell.slice(0, scatter.leaves.count * 2), 2));
    add("leaves", makeInstanced(geo.leaf, leafMat, scatter.leaves), trisOf(geo.leaf, scatter.leaves.count));

    const plain = (roughness) => {
      const m = makeRevealable(new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), roughness, metalness: 0 }));
      disposables.push(m);
      return m;
    };
    add("twigs", makeInstanced(geo.twig, plain(0.9), scatter.twigs), trisOf(geo.twig, scatter.twigs.count));
    add("pebbles", makeInstanced(geo.pebble, plain(0.62), scatter.pebbles), trisOf(geo.pebble, scatter.pebbles.count));
    add("mast", makeInstanced(geo.mast, plain(0.8), scatter.mast), trisOf(geo.mast, scatter.mast.count));
    add("acorns", makeInstanced(geo.acorn, plain(0.7), scatter.acorns), trisOf(geo.acorn, scatter.acorns.count));
    result.triangles = Math.round(result.triangles);
  };
  tasks.push(fn(assemble));

  const build = {
    done: false,
    result,
    // Run tasks until `budgetMs` of this frame is spent (always at least one task).
    step(budgetMs = 8) {
      if (cancelled || build.done) return;
      const t0 = performance.now();
      do {
        const tt = performance.now();
        if (tasks[0]()) tasks.shift();
        timing.maxChunkMs = Math.max(timing.maxChunkMs, performance.now() - tt);
        if (!tasks.length) {
          build.done = true;
          break;
        }
      } while (performance.now() - t0 < budgetMs);
      timing.totalMs += performance.now() - t0;
    },
    dispose() {
      cancelled = true;
      for (const m of meshes) if (m.isInstancedMesh) m.dispose();
      for (const d of disposables) d.dispose();
      for (const set of textureSets) disposeTextureSet(set);
      // the bark set belongs to the hero cache and is NOT disposed here
    },
  };
  return build;
}
