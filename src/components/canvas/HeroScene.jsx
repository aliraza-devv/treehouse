"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FOLIAGE_WIND } from "@/lib/foliageMaterial";
import { LIGHT, PALETTE, TREE } from "@/lib/sceneConfig";
import { CameraRig } from "@/hooks/useIdle";
import useReducedMotion from "@/hooks/useReducedMotion";
import Atmosphere from "./Atmosphere";
import ChildOnLawn from "./ChildOnLawn";
import FallingLeaves from "./FallingLeaves";
import ForestEnvironment from "./ForestEnvironment";
import ScrollCameraRig from "./ScrollCameraRig";
import SectionsHost from "./SectionsHost";
import Treehouse from "./Treehouse";

// ---------------------------------------------------------------------------
// Lighting
//
// Light budget (three.js uses physically based units, so these are starting values the
// integrator tunes against real renders):
//   1. Image based light from the procedural sky (scene.environment, owned by <Atmosphere />).
//      This is the main source on every camera facing surface, because the sun is BEHIND the tree.
//   2. ONE cool AmbientLight, kept low so it only lifts the deepest crevices the IBL misses.
//   3. ONE shadow casting DirectionalLight, the warm sun from upper right behind the tree.
//      It rims the trunk and branches, backlights leaves (foliage translucency reads from the
//      first directional light) and throws long shadows toward the camera.
//   4. A deliberate extra: one weak hemisphere fill (see FILL below).
// ---------------------------------------------------------------------------

// DELIBERATE ADDITION (allowed realism deviation): a weak hemisphere fill, intensity 0.18, below
// the 0.25 ceiling. The sky IBL carries no ground bounce, yet the camera looks UP at deck
// undersides, beams and the lower trunk, which in life glow faintly green-brown from the forest
// floor. Sky colour on top, damp-litter green below, so undersides pick up that bounce.
const FILL = {
  skyColor: PALETTE.skyLow,
  groundColor: PALETTE.floorLight,
  intensity: 0.18,
};

// Where the sun looks. A point on the trunk a little above the platform keeps the long axis of
// the shadow frustum pointed at the treehouse and canopy, not at the ground.
const SUN_TARGET = LIGHT.target;

// World-space region the shadow map must cover: everything that casts onto, or receives a
// shadow from, the hero tree and treehouse. Centered on the trunk (x +-6.5 holds the longest
// branches and the deck), from just below ground to just above the crown (y), and 5 m behind to
// 6 m in front of the trunk (z) so the shadow cast onto the ground toward the camera lands inside.
const SHADOW_REGION = new THREE.Box3(
  new THREE.Vector3(TREE.x - 6.5, -0.3, -5),
  new THREE.Vector3(TREE.x + 6.5, TREE.height + 1.5, 6),
);

// Fit the directional light's orthographic shadow camera to a world-space box.
//
// Method: point the shadow camera exactly as three will at render time (from the light position
// at the light target), push the 8 corners of the box through its view matrix, and take the
// min/max in view space as the ortho extents. In view space the camera looks down -Z, so
//   near = -maxZ, far = -minZ   (distances in front of the camera)
// A tight fit is the whole point: for the box above the frustum is about 17 m wide by 26 m tall,
// so a 4096 map gives roughly 0.4 cm by 0.6 cm per texel, enough for sharp contact shadows on
// plank edges, and a 2048 map still gives about 1.3 cm.
const _corner = new THREE.Vector3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
function fitShadowCamera(light, box) {
  const cam = light.shadow.camera;
  cam.position.set(...LIGHT.keyPosition);
  cam.lookAt(...SUN_TARGET);
  cam.updateMatrixWorld(true);
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    _corner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .applyMatrix4(cam.matrixWorldInverse);
    _min.min(_corner);
    _max.max(_corner);
  }
  const pad = 0.4; // margin so the PCF kernel never samples outside the map at the border
  cam.left = _min.x - pad;
  cam.right = _max.x + pad;
  cam.bottom = _min.y - pad;
  cam.top = _max.y + pad;
  // The light sits inside the box (its y of 15 is below the crown top), so near may be negative:
  // an orthographic camera simply extends its slab behind the light to catch canopy above it.
  cam.near = -_max.z - pad;
  cam.far = -_min.z + pad;
  cam.updateProjectionMatrix();
}

// The hero sun: warm key light with a tightly framed shadow map.
function Sun() {
  const lightRef = useRef(null);
  // 4096 on desktop, 2048 on touch devices (a 4096 depth map is 64 MB of GPU memory).
  const mapSize = useMemo(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    return coarse ? 2048 : 4096;
  }, []);
  // The light needs a target object that lives in the scene graph.
  const target = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(...SUN_TARGET);
    return object;
  }, []);

  useLayoutEffect(() => {
    if (lightRef.current) fitShadowCamera(lightRef.current, SHADOW_REGION);
  }, []);

  // Bias notes. Depth range of the fitted frustum is about 30 m in a 24 bit buffer, so depth
  // resolution is far finer than a texel. Two knobs remain:
  //   bias        small negative depth offset, kills self shadow acne on lit faces
  //   normalBias  pushes the lookup along the surface normal, kills acne on grazing faces
  //               (rim lit bark, shingle edges) without detaching shadows from the 22 cm deck
  // normalBias is about 2 texels in world units: 2 * 0.006 = 0.012 at 4096, 2 * 0.013 = 0.026 at 2048.
  const normalBias = mapSize === 4096 ? 0.014 : 0.028;
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        position={LIGHT.keyPosition}
        target={target}
        color={LIGHT.keyColor}
        intensity={LIGHT.keyIntensity}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0003}
        shadow-normalBias={normalBias}
        // PCFSoftShadowMap no longer exists in this three.js version; PCFShadowMap is the soft
        // Vogel disk filter and its width is shadow.radius, measured in shadow map texels.
        shadow-radius={2.5}
      />
    </>
  );
}

// Advances the shared foliage wind clock once per frame (every foliage material reads it).
// Frozen at zero for visitors who asked for reduced motion.
function WindClock() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  useLayoutEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  useFrame((state) => {
    FOLIAGE_WIND.uTime.value = reducedRef.current ? 0 : state.clock.elapsedTime;
  });
  return null;
}

// The shadow map is re-rendered on a schedule instead of every frame (Scene.jsx turns autoUpdate
// off). A 4096 map with about 1,700 alpha tested leaf clusters in it is the single biggest GPU
// cost in the scene, and the sun and every caster are static: the only motion in the shadow pass
// is 7 cm of leaf wind. Refreshing every 6th frame (about 10 Hz) is invisible and cuts that
// cost by 6x. The first frames refresh every frame so the staged parts (cabin, oak, forest) cast
// as soon as they mount.
const SHADOW_EVERY = 6;
function ShadowScheduler() {
  const frame = useRef(0);
  useFrame((state) => {
    frame.current += 1;
    if (frame.current < 40 || frame.current % SHADOW_EVERY === 0) state.gl.shadowMap.needsUpdate = true;
  });
  return null;
}

// The whole 3D hero: scenery, light and camera. Post processing is mounted by <Scene />.
export default function HeroScene() {
  return (
    <>
      <Atmosphere />
      <ambientLight color={LIGHT.ambientColor} intensity={LIGHT.ambientIntensity} />
      <hemisphereLight args={[FILL.skyColor, FILL.groundColor, FILL.intensity]} />
      <Sun />
      <Treehouse />
      <ForestEnvironment />
      <ChildOnLawn />
      <WindClock />
      <ShadowScheduler />
      <FallingLeaves />
      <CameraRig />
      <ScrollCameraRig />
      <SectionsHost />
    </>
  );
}
