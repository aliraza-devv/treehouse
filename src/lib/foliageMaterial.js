// Foliage material helpers for alpha-cut leaf cards.
//
//   makeFoliageMaterial({ map, normalMap, tint, alphaTest, translucency, ... })
//       MeshStandardMaterial with a cheap backlit translucency term and optional wind.
//   makeFoliageDepthMaterial({ map, alphaTest, wind })
//       use as mesh.customDepthMaterial so cards cast LEAF-SHAPED shadows, not square ones.
//   buildLeafClusterGeometry({ cards, width, height, bend, ... })
//       2-3 crossed / curved quads with outward "spherical" normals so a cloud of cards shades
//       like a soft volume instead of like flat cards.
//   FOLIAGE_WIND.uTime.value = clock.elapsedTime   (set once per frame, shared by all foliage)

import * as THREE from "three";
import { BRAND } from "@/lib/sceneConfig";

// Shared wind clock. Update once per frame: FOLIAGE_WIND.uTime.value = state.clock.elapsedTime.
export const FOLIAGE_WIND = { uTime: { value: 0 } };

const WIND_VERTEX = /* glsl */ `
  #include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 wpos = instanceMatrix[3].xyz;
    #else
      vec3 wpos = modelMatrix[3].xyz;
    #endif
    // phase from the card position so neighbouring cards do not move in lockstep
    float ph = wpos.x * 0.71 + wpos.z * 0.93 + wpos.y * 0.37;
    float sway = sin(uTime * uWindSpeed + ph) + 0.5 * sin(uTime * uWindSpeed * 2.3 + ph * 1.7);
    // tips move more than the base: uv.y is 0 at the bottom of the card, 1 at the top
    float flex = uv.y * uv.y;
    transformed.x += sway * uWindAmp * flex;
    transformed.z += 0.6 * sway * uWindAmp * flex;
    transformed.y -= abs(sway) * uWindAmp * 0.25 * flex;
  }
`;

function windUniformsOf(shader, wind) {
  shader.uniforms.uTime = FOLIAGE_WIND.uTime;
  shader.uniforms.uWindAmp = { value: wind.amplitude ?? 0.04 };
  shader.uniforms.uWindSpeed = { value: wind.speed ?? 1.3 };
}

const WIND_DECL = "uniform float uTime;\nuniform float uWindAmp;\nuniform float uWindSpeed;\n";

// Inserted right after the directional light's RE_Direct call (light index 0 = the key sun).
// Backlit translucency (Barre-Brisebois style): when the camera looks toward the light THROUGH the
// leaf, add light transmitted in the leaf colour, shifted to yellow-green. directLight.color is
// already attenuated by the shadow map, so leaves buried in canopy shadow do not glow.
const TRANSLUCENCY = /* glsl */ `
  #if ( UNROLLED_LOOP_INDEX == 0 )
  {
    vec3 Lt = normalize( directLight.direction + geometryNormal * 0.3 );
    float back = pow( saturate( dot( geometryViewDir, - Lt ) ), 3.0 );
    // faint wrap term so the side facing away from the light is not dead black
    float wrapD = saturate( ( dot( geometryNormal, directLight.direction ) + 0.35 ) / 1.35 );
    vec3 tcol = material.diffuseColor * uTransColor;
    reflectedLight.directDiffuse += directLight.color * tcol * ( back * 2.4 + wrapD * 0.12 ) * uTranslucency * RECIPROCAL_PI;
  }
  #endif
`;

// MeshStandardMaterial tuned for alpha-cut foliage.
//   map / normalMap   from createLeafCardTexture / createFernFrondTexture
//   tint              multiplies the albedo (also multiplied by instanceColor if the mesh has one)
//   alphaTest         cut-out threshold, 0.5 matches the coverage-preserving mips
//   translucency      0..1 strength of the backlit glow (0 disables the look)
//   volumeNormals     true: same shading on both faces (needed for spherical cluster normals)
//   wind              { amplitude, speed } enables vertex sway (drive FOLIAGE_WIND.uTime)
export function makeFoliageMaterial({
  map = null,
  normalMap = null,
  tint = "#ffffff",
  alphaTest = 0.5,
  translucency = 0.6,
  roughness = 0.7,
  normalScale = 0.7,
  volumeNormals = true,
  // Backlit glow: brand light green pulled toward the warm sun colour (never lime).
  transmissionColor = new THREE.Color(BRAND.greenLight).lerp(new THREE.Color(BRAND.warmLight), 0.3),
  wind = null,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    color: new THREE.Color(tint),
    alphaTest,
    side: THREE.DoubleSide,
    roughness,
    metalness: 0,
    transparent: false,
  });
  if (normalMap) mat.normalScale = new THREE.Vector2(normalScale, normalScale);
  const uTranslucency = { value: translucency };
  const uTransColor = { value: new THREE.Color(transmissionColor) };
  mat.userData.uniforms = { uTranslucency, uTransColor };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTranslucency = uTranslucency;
    shader.uniforms.uTransColor = uTransColor;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform float uTranslucency;\nuniform vec3 uTransColor;\n"
    );
    if (volumeNormals) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "")
      );
    }
    // find the directional loop's RE_Direct and append the translucency block after it
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const dirStart = chunk.indexOf("#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )");
    const call = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
    const callAt = dirStart >= 0 ? chunk.indexOf(call, dirStart) : -1;
    if (callAt >= 0 && translucency > 0) {
      const patched = chunk.slice(0, callAt + call.length) + TRANSLUCENCY + chunk.slice(callAt + call.length);
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", patched);
    }
    if (wind) {
      windUniformsOf(shader, wind);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WIND_DECL}`)
        .replace("#include <begin_vertex>", WIND_VERTEX);
    }
  };
  mat.customProgramCacheKey = () => `foliage-${volumeNormals ? 1 : 0}-${wind ? 1 : 0}-${translucency > 0 ? 1 : 0}`;
  return mat;
}

// Depth material for customDepthMaterial: cut-out shadows in the shape of the leaves.
// Pass the same `wind` object as the visible material so shadows sway with the leaves.
//   mesh.customDepthMaterial = makeFoliageDepthMaterial({ map, alphaTest: 0.5 });
// (also a good idea: mesh.castShadow = true; for InstancedMesh this works per instance.)
export function makeFoliageDepthMaterial({ map, alphaTest = 0.5, wind = null } = {}) {
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map,
    alphaTest,
  });
  if (wind) {
    mat.onBeforeCompile = (shader) => {
      windUniformsOf(shader, wind);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WIND_DECL}`)
        .replace("#include <begin_vertex>", WIND_VERTEX);
    };
    mat.customProgramCacheKey = () => "foliage-depth-wind";
  }
  return mat;
}

// Cluster geometry: `cards` crossed quads (2 = a plus when seen from above, 3 = a star), each
// gently arched along its height (bend) and optionally cupped across its width (cup).
// Normals are blended toward the direction from the cluster centre to each vertex
// (normalBlend 0 = true card normals, 1 = fully spherical). The default 0.85 makes a cloud of
// clusters shade as one soft volume. Pair it with makeFoliageMaterial (volumeNormals true).
//   pivot 'center' (origin at the cluster centre) or 'bottom' (origin at the base of the cards,
//   handy for twigs growing from a branch). Cards are width x height, uv covers the full texture.
//   segments [w, h] sets the subdivisions per card (default [1, 2] = 4 triangles per card).
export function buildLeafClusterGeometry({
  cards = 2,
  width = 1,
  height = 1,
  bend = 0.25,
  cup = 0,
  segments = [1, 2],
  normalBlend = 0.85,
  pivot = "center",
  seed = 1,
} = {}) {
  const [sw, sh] = segments;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vBase = 0;
  const yShift = pivot === "bottom" ? height / 2 : 0;
  // tiny deterministic jitter so the crossed cards are not perfectly symmetric
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const tmp = new THREE.Vector3();
  const nCard = new THREE.Vector3();
  const nSph = new THREE.Vector3();
  const centre = new THREE.Vector3(0, 0, 0);
  for (let c = 0; c < cards; c++) {
    const yaw = (c * Math.PI) / cards + (rnd() - 0.5) * 0.25;
    const tilt = (rnd() - 0.5) * 0.18;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, "YXZ"));
    for (let j = 0; j <= sh; j++) {
      const t = j / sh;
      const ny = t - 0.5; // -0.5 .. 0.5 along the height
      for (let i = 0; i <= sw; i++) {
        const sx = i / sw;
        const nx = sx - 0.5;
        // arch along the height plus optional cup across the width (z bulges toward the viewer)
        const z = bend * height * (0.25 - ny * ny) - cup * width * nx * nx;
        tmp.set(nx * width, ny * height, z).applyQuaternion(q);
        // slope of the surface for the true card normal: d z / d y = -2 bend ny, d z / d x = -2 cup nx * ...
        nCard.set(2 * cup * nx, 2 * bend * ny, 1).normalize().applyQuaternion(q);
        const px = tmp.x;
        const py = tmp.y + yShift;
        const pz = tmp.z;
        nSph.set(px, tmp.y, pz).sub(centre);
        if (nSph.lengthSq() < 1e-6) nSph.copy(nCard);
        nSph.normalize();
        if (nCard.dot(nSph) < 0) nCard.negate();
        nCard.lerp(nSph, normalBlend).normalize();
        positions.push(px, py, pz);
        normals.push(nCard.x, nCard.y, nCard.z);
        uvs.push(sx, t);
      }
    }
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const a = vBase + j * (sw + 1) + i;
        const b = a + 1;
        const d = a + (sw + 1);
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    vBase += (sw + 1) * (sh + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}
