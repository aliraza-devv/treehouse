import * as THREE from "three";
import { scrollState } from "@/lib/scroll/scrollStore";
import { LIGHT_RAMP } from "@/lib/sections/world";
import { HERO_SHADOW, RAMP_CURVES, WALKER_SHADOW } from "./airTuning";
import { fitShadowCamera, heroNormalBias, heroShadowBox, lerpBox, walkerCentre, walkerShadowBox } from "./airShadow";

// The LightRamp controller's per frame logic (the component in AirAndLight.jsx only calls these).
//
// What it drives, from t = scrollState.sections.approach (0..1):
//   * scene fog: FogExp2 density and colour (LIGHT_RAMP.fogDensity / fogColor), and the scene background
//   * the sky dome and the mist banks (Atmosphere.jsx), scaled by the same colour shift as the fog so the gaps
//     in the crowns still read as the same haze (a pale sky behind a darker fog turns crowns into stencils)
//   * the shadow casting sun: colour and intensity (LIGHT_RAMP.keyColor / keyIntensity), its shadow camera
//     (re-fitted to a box that follows the walker) and its shadow softness
//   * scene.environmentIntensity and scrollState.look.exposure (read by the post stack)
//
// At t = 0 it does NOTHING. The first frame with t > 0 switches it on; when t returns to 0 (or the component
// unmounts near the start) every value is put back to the hero value in the same frame. The hero values are
// the first entry of each LIGHT_RAMP pair (world.js), which match the hero scene (FOG, LIGHT, ENVIRONMENT_INTENSITY,
// EXPOSURE). If the hero look is retuned, change LIGHT_RAMP[0] and HERO_SHADOW (airTuning.js) with it.
//
// Hot path rules: no allocation per frame (preallocated colours and boxes), the scene is only traversed
// (to find the sun, the dome and the mist) a handful of times and the results cached.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = ([a, b], t) => THREE.MathUtils.smoothstep(t, a, b);
const lerp = THREE.MathUtils.lerp;

export function createRampState() {
  return {
    frame: 0,
    active: false,
    searches: 0,
    lastSearchFrame: -999,
    lastRefreshFrame: -999,
    scene: null,
    gl: null,
    light: null,
    dome: null, // { material, base: { name: Color } }
    mist: null,
    heroTexel: 0,
    centre: { x: 0, z: 0, ready: false },
    target: { x: 0, z: 0 },
    c: {
      fog0: new THREE.Color(LIGHT_RAMP.fogColor[0]),
      fog1: new THREE.Color(LIGHT_RAMP.fogColor[1]),
      key0: new THREE.Color(LIGHT_RAMP.keyColor[0]),
      key1: new THREE.Color(LIGHT_RAMP.keyColor[1]),
      fog: new THREE.Color(),
      ratio: new THREE.Color(1, 1, 1), // per channel multiplier (current fog / hero fog), a Color so Color.multiply works
    },
    box: { hero: heroShadowBox(), walker: new THREE.Box3(), mix: new THREE.Box3() },
  };
}

// Colours of a shader material that must follow the fog's colour shift: remembered on the material the
// first time it is seen (so a remount of this controller never double applies the shift).
function captureColors(material, names) {
  if (!material.userData.airBase) {
    material.userData.airBase = {};
    for (const name of names) material.userData.airBase[name] = material.uniforms[name].value.clone();
  }
  return { material, base: material.userData.airBase, names };
}

const DOME_COLORS = ["uHorizon", "uLow", "uHigh", "uCloud"];
const MIST_COLORS = ["uColor", "uWarm"];

// Find the shadow casting sun, the visible sky dome and the mist banks (cached in the state). They are plain
// objects in the scene: the sun is the DirectionalLight that casts shadows, the dome is the ShaderMaterial with
// uHorizon and uGroundMix at 0 (the visible dome, not the environment capture), the mist the one with uColor,
// uWarm and uNoise.
function findSceneObjects(S, scene) {
  scene.traverse((o) => {
    if (!S.light && o.isDirectionalLight && o.castShadow) S.light = o;
    const m = o.material;
    if (!m || !m.isShaderMaterial || Array.isArray(m)) return;
    const u = m.uniforms;
    if (!S.dome && u.uHorizon && u.uGroundMix && u.uGroundMix.value === 0) S.dome = captureColors(m, DOME_COLORS);
    if (!S.mist && u.uColor && u.uWarm && u.uNoise && !u.uHorizon) S.mist = captureColors(m, MIST_COLORS);
  });
}

// Apply a per channel colour ratio (current fog / hero fog) to the remembered colours of a shader material.
function applyRatio(entry, ratio) {
  if (!entry) return;
  for (const name of entry.names) {
    entry.material.uniforms[name].value.copy(entry.base[name]).multiply(ratio);
  }
}

function setShadow(S, light, box, snap, radius, nearExtra) {
  const texel = fitShadowCamera(light, box, { pad: HERO_SHADOW.pad, snap, nearExtra });
  light.shadow.radius = radius;
  // Keep the normal bias at the same number of texels as the hero (it is a world distance, the texel size grew).
  if (S.heroTexel > 0) light.shadow.normalBias = heroNormalBias(light.shadow.mapSize.x) * (texel / S.heroTexel);
}

// Put every driven value back to the hero state.
export function restoreHero(S) {
  if (!S.active) return;
  S.active = false;
  const scene = S.scene;
  const fog = scene?.fog;
  if (fog && fog.isFogExp2) {
    fog.density = LIGHT_RAMP.fogDensity[0];
    fog.color.copy(S.c.fog0);
  }
  if (scene && scene.background && scene.background.isColor) scene.background.copy(S.c.fog0);
  if (scene) scene.environmentIntensity = LIGHT_RAMP.environmentIntensity[0];
  applyRatio(S.dome, S.c.ratio.setRGB(1, 1, 1));
  applyRatio(S.mist, S.c.ratio);
  const light = S.light;
  if (light) {
    light.intensity = LIGHT_RAMP.keyIntensity[0];
    light.color.copy(S.c.key0);
    // The exact hero fit (same method and box as HeroScene), its radius and its normal bias.
    fitShadowCamera(light, S.box.hero, { pad: HERO_SHADOW.pad, snap: false });
    light.shadow.radius = HERO_SHADOW.radius;
    light.shadow.normalBias = heroNormalBias(light.shadow.mapSize.x);
    if (S.gl) S.gl.shadowMap.needsUpdate = true;
  }
  scrollState.look.exposure = null;
  S.centre.ready = false;
}

// One frame of the ramp. `state` is the r3f state, `delta` seconds.
export function updateLightRamp(S, state, delta) {
  S.frame += 1;
  const t = clamp01(scrollState.sections.approach ?? 0);
  if (t <= 0) {
    restoreHero(S);
    return;
  }
  const { scene, gl, camera } = state;
  S.scene = scene;
  S.gl = gl;

  // Find the objects we drive (a few traversals at most, then cached).
  if (!(S.light && S.dome && S.mist) && S.searches < 12 && S.frame - S.lastSearchFrame >= 45) {
    S.lastSearchFrame = S.frame;
    S.searches += 1;
    findSceneObjects(S, scene);
  }

  S.active = true;
  // Texel size of the hero fit, for scaling the normal bias (done once, as soon as the sun is found; the
  // camera is re-fitted below in the same frame).
  if (S.light && S.heroTexel === 0) S.heroTexel = fitShadowCamera(S.light, S.box.hero, { pad: HERO_SHADOW.pad, snap: false });

  // ----- fog, haze, sun, environment, exposure ---------------------------------------------------------------
  const eFog = ease(RAMP_CURVES.fog, t);
  const eSun = ease(RAMP_CURVES.sun, t);
  const eEnv = ease(RAMP_CURVES.environment, t);
  const eExp = ease(RAMP_CURVES.exposure, t);
  const c = S.c;

  const fog = scene.fog;
  c.fog.copy(c.fog0).lerp(c.fog1, eFog);
  if (fog && fog.isFogExp2) {
    fog.density = lerp(LIGHT_RAMP.fogDensity[0], LIGHT_RAMP.fogDensity[1], eFog);
    fog.color.copy(c.fog);
  }
  if (scene.background && scene.background.isColor) scene.background.copy(c.fog);
  // Sky dome and mist follow the same colour shift (channel ratio of the current fog to the hero fog).
  c.ratio.setRGB(c.fog.r / c.fog0.r, c.fog.g / c.fog0.g, c.fog.b / c.fog0.b);
  applyRatio(S.dome, c.ratio);
  applyRatio(S.mist, c.ratio);

  scene.environmentIntensity = lerp(LIGHT_RAMP.environmentIntensity[0], LIGHT_RAMP.environmentIntensity[1], eEnv);
  scrollState.look.exposure = lerp(LIGHT_RAMP.exposure[0], LIGHT_RAMP.exposure[1], eExp);

  const light = S.light;
  if (!light) return;
  light.intensity = lerp(LIGHT_RAMP.keyIntensity[0], LIGHT_RAMP.keyIntensity[1], eSun);
  light.color.copy(c.key0).lerp(c.key1, eSun);

  // ----- the shadow camera follows the walker ------------------------------------------------------------------------
  // Box centre: WALKER_SHADOW.ahead metres further along the path than the camera, eased so the camera weave
  // does not shake the fit. Blended in world space from the hero box (w = 0) to the walker box (w = 1).
  const w = THREE.MathUtils.smoothstep(t, 0, WALKER_SHADOW.blendEnd);
  walkerCentre(camera.position.x, camera.position.z, S.target);
  if (!S.centre.ready) {
    S.centre.x = S.target.x;
    S.centre.z = S.target.z;
    S.centre.ready = true;
  } else {
    const k = 1 - Math.exp(-delta * WALKER_SHADOW.centreRate);
    S.centre.x += (S.target.x - S.centre.x) * k;
    S.centre.z += (S.target.z - S.centre.z) * k;
  }
  walkerShadowBox(S.centre.x, S.centre.z, S.box.walker);
  lerpBox(S.box.hero, S.box.walker, w, S.box.mix);
  setShadow(S, light, S.box.mix, w >= 1, lerp(HERO_SHADOW.radius, WALKER_SHADOW.radiusEnd, w), WALKER_SHADOW.nearExtra * w);

  // The map is refreshed on the hero's schedule (every 6th frame): the camera moves and the canopy sways.
  if (S.frame - S.lastRefreshFrame >= WALKER_SHADOW.refreshEvery) {
    S.lastRefreshFrame = S.frame;
    gl.shadowMap.needsUpdate = true;
  }
}
