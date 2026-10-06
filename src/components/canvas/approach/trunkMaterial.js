// Materials for the approach trunks. Every material goes through makeRevealable exactly once (the
// dissolve that keeps the approved hero frame untouched at progress 0).
//
// The bark material is a MeshStandardMaterial patched with a small wear shader:
//   attribute aWear (x moss, y lichen, z fresh wood, w damp) is painted per vertex by shadeBark; the fragment
//   shader turns it into breakup with world-space value noise and the bark's own cavity map:
//     moss     fills crevices first (cavity from the roughness map's AO channel), spreads over the ridges
//              where aWear.x is high (north side, the foot), recedes with height, softens the normal map
//     lichen   pale crust on the ridge tops
//     wood     pale fibrous splintered wood on the snapped ends, fibres run along the branch
//     damp     darkening toward the foot
// Because the noise is in world space the patches are crisp at any ring spacing and never tile.

import * as THREE from "three";
import { makeFoliageDepthMaterial, makeFoliageMaterial } from "@/lib/foliageMaterial";
import { makeRevealable } from "@/lib/sections/reveal";
import { BRAND } from "@/lib/sceneConfig";
import { IVY_LOOK, IVY_STEM_COLOUR, LEAF_LOOK, UMBEL_COLOUR, WEAR_COLOURS } from "./trunkTones";

const VERT_DECL = "attribute vec4 aWear;\nvarying vec4 vWear;\nvarying vec3 vBarkPos;\n";
const VERT_BODY = /* glsl */ `
  vWear = aWear;
  vec4 barkP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    barkP = instanceMatrix * barkP;
  #endif
  vBarkPos = ( modelMatrix * barkP ).xyz;
`;

const FRAG_DECL = /* glsl */ `
uniform vec3 uMossDark;
uniform vec3 uMossLight;
uniform vec3 uLichen;
uniform vec3 uWood;
varying vec4 vWear;
varying vec3 vBarkPos;
// Gradient (Perlin) noise rather than value noise: value noise flattens at its lattice points and shows
// them as straight, axis aligned edges on a vertical trunk. barkNoise returns about 0.5 +- 0.2.
vec3 barkGrad( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return -1.0 + 2.0 * fract( sin( p ) * 43758.5453123 );
}
float barkNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float n = mix(
    mix( mix( dot( barkGrad( i ), f ), dot( barkGrad( i + vec3( 1.0, 0.0, 0.0 ) ), f - vec3( 1.0, 0.0, 0.0 ) ), u.x ),
         mix( dot( barkGrad( i + vec3( 0.0, 1.0, 0.0 ) ), f - vec3( 0.0, 1.0, 0.0 ) ), dot( barkGrad( i + vec3( 1.0, 1.0, 0.0 ) ), f - vec3( 1.0, 1.0, 0.0 ) ), u.x ), u.y ),
    mix( mix( dot( barkGrad( i + vec3( 0.0, 0.0, 1.0 ) ), f - vec3( 0.0, 0.0, 1.0 ) ), dot( barkGrad( i + vec3( 1.0, 0.0, 1.0 ) ), f - vec3( 1.0, 0.0, 1.0 ) ), u.x ),
         mix( dot( barkGrad( i + vec3( 0.0, 1.0, 1.0 ) ), f - vec3( 0.0, 1.0, 1.0 ) ), dot( barkGrad( i + vec3( 1.0, 1.0, 1.0 ) ), f - vec3( 1.0, 1.0, 1.0 ) ), u.x ), u.y ),
    u.z );
  return 0.5 + 0.7 * n;
}
// Three octaves, mean 0.5 and spread about 0.12. Each octave swaps the axes and uses a non integer scale,
// so the lattices never line up.
float barkFbm( vec3 p ) {
  float n = barkNoise( p ) * 0.55;
  p = p.yzx * 2.03 + 17.1;
  n += barkNoise( p ) * 0.30;
  p = p.zxy * 2.11 + 5.7;
  n += barkNoise( p ) * 0.15;
  return n;
}
`;

// After the vertex colour has been applied (color_fragment), so the moss is not dimmed by the tint.
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
float barkMoss = 0.0;
float barkWood = 0.0;
{
  vec3 wp = vBarkPos;
  float cav = 1.0;
  #ifdef USE_ROUGHNESSMAP
    cav = texture2D( roughnessMap, vRoughnessMapUv ).r;
  #endif
  float crev = 1.0 - cav;
  // lichen: a pale crust on the ridge tops, in patches
  float ln = barkFbm( wp * 5.0 + 11.0 );
  float lth = 1.0 - vWear.y * 0.55;
  float lichen = smoothstep( lth, lth + 0.06, ln ) * smoothstep( 0.35, 0.8, cav );
  diffuseColor.rgb = mix( diffuseColor.rgb, uLichen * ( 0.8 + 0.4 * barkNoise( wp * 34.0 ) ), lichen * 0.6 );
  // moss: cushions that grow where the wear is high (the north face, the foot), reaching into crevices
  // first. The threshold maps wear 0.8 to about 60 percent cover, 0.4 to 25 percent, 0.1 to a few
  // flecks, so a mossy north face still shows bark between the cushions.
  float mn = barkFbm( wp * 3.3 + 7.0 );
  float mth = 0.8 - vWear.x * 0.36 - crev * 0.2;
  barkMoss = smoothstep( mth, mth + 0.1, mn );
  // moss colour: dark in the shade of the cushion, yellow-green where it catches the light, speckled
  float mc = smoothstep( 0.3, 0.7, barkFbm( wp * 13.0 + 1.0 ) );
  vec3 mossCol = mix( uMossDark, uMossLight, mc );
  barkWood = smoothstep( 0.3, 0.7, vWear.z );
  diffuseColor.rgb = mix( diffuseColor.rgb, mossCol * ( 0.7 + 0.45 * cav ), barkMoss * 0.85 * ( 1.0 - barkWood ) );
  // freshly broken wood: pale, with fibres running along the branch (uv.x goes round it)
  float fibre = 0.72 + 0.28 * sin( vMapUv.x * 120.0 + barkNoise( wp * 18.0 ) * 5.0 );
  float fibre2 = barkNoise( vec3( vMapUv.x * 90.0, vMapUv.y * 3.0, 1.3 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uWood * fibre * ( 0.8 + 0.4 * fibre2 ), barkWood );
  // damp: soil splash and wet bark at the foot
  diffuseColor.rgb *= 1.0 - 0.45 * vWear.w;
  barkMoss *= 1.0 - barkWood;
}
`;
const FRAG_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 1.0, barkMoss * 0.7 );
roughnessFactor = mix( roughnessFactor, 0.92, barkWood );
`;
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
// moss and bare wood hide the bark relief
normal = normalize( mix( normal, normalize( vNormal ), barkMoss * 0.5 + barkWood * 0.4 ) );
`;

export function makeBarkMaterial(set, species) {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(species.normal, species.normal),
    roughnessMap: set.roughnessMap,
    aoMap: set.roughnessMap, // R channel is the cavity AO
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMossDark = { value: WEAR_COLOURS.mossDark };
    shader.uniforms.uMossLight = { value: WEAR_COLOURS.mossLight };
    shader.uniforms.uLichen = { value: WEAR_COLOURS.lichen };
    shader.uniforms.uWood = { value: WEAR_COLOURS.wood };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_DECL}`)
      .replace("#include <color_fragment>", FRAG_COLOR)
      .replace("#include <roughnessmap_fragment>", FRAG_ROUGH)
      .replace("#include <normal_fragment_maps>", FRAG_NORMAL);
  };
  mat.customProgramCacheKey = () => "approach-trunk-bark-v1";
  return makeRevealable(mat);
}

// ------------------------------------------------------------------------------------------------
// Foliage
// ------------------------------------------------------------------------------------------------
// glow: backlit leaf colour, soft green pulled toward the warm light (never lime), as the hero canopy.
const GLOW = new THREE.Color(BRAND.greenLight).lerp(new THREE.Color(BRAND.warmLight), 0.35);

export function makeLeafMaterial(tex, wind) {
  const mat = makeFoliageMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    translucency: LEAF_LOOK.translucency,
    roughness: LEAF_LOOK.roughness,
    normalScale: LEAF_LOOK.normalScale,
    alphaTest: LEAF_LOOK.alphaTest,
    transmissionColor: GLOW,
    wind,
  });
  return makeRevealable(mat);
}

// Leaf shaped shadows for the crowns and sprays. Not revealable: the depth pass is gated by RevealGroup
// (castShadow stays false until the dissolve is mostly in).
export function makeLeafDepth(tex, wind) {
  return makeFoliageDepthMaterial({ map: tex.map, alphaTest: LEAF_LOOK.alphaTest, wind });
}

// Ivy: dark glossy leaves with a faint backlit glow. Flat cards, so the real face normal is used.
export function makeIvyMaterial(tex) {
  const mat = makeFoliageMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    translucency: IVY_LOOK.translucency,
    roughness: IVY_LOOK.roughness,
    normalScale: 0.6,
    alphaTest: 0.5,
    volumeNormals: false,
    transmissionColor: GLOW,
    wind: IVY_LOOK.wind,
  });
  return makeRevealable(mat);
}

// Ivy runner stems: dark brown ropes hugging the bark.
export function makeStemMaterial() {
  return makeRevealable(
    new THREE.MeshStandardMaterial({ color: IVY_STEM_COLOUR, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  );
}

// Ivy flowering heads (umbels): pale yellow-green globes.
export function makeUmbelMaterial() {
  return makeRevealable(new THREE.MeshStandardMaterial({ color: UMBEL_COLOUR, roughness: 0.7, metalness: 0 }));
}

// Beard lichen hanging from broken branches (alpha cut strands).
export function makeLichenMaterial(tex) {
  return makeRevealable(
    new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
    }),
  );
}
