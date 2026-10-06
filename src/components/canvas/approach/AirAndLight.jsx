"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PALETTE } from "@/lib/sceneConfig";
import { makeFoliageDepthMaterial } from "@/lib/foliageMaterial";
import { scrollState } from "@/lib/scroll/scrollStore";
import { LIGHT_RAMP } from "@/lib/sections/world";
import { makeRevealable } from "@/lib/sections/reveal";
import useReducedMotion from "@/hooks/useReducedMotion";
import useStaged from "@/hooks/useStaged";
import { SUN_DIR } from "../GodRays";
import { buildLeafMatGeometry, composeClump, gustOffset, planCanopy } from "./airCanopy";
import { makeLeafMatTexture } from "./airCanopyTexture";
import { buildDustGeometry } from "./airDust";
import { createRampState, restoreHero, updateLightRamp } from "./airLight";
import { DUST_FRAG, SHAFT_FRAG, SHAFT_VERT, dustVert } from "./airShaders";
import { buildShaftGeometry, planShafts } from "./airShafts";
import { CANOPY, DUST, FROZEN_TIME, SHAFTS, SHAFT_LOOK } from "./airTuning";

// ===========================================================================================
// AIR AND LIGHT (Section 2: The Approach)
//
//   LightRamp (named export, non visual, mounted OUTSIDE the reveal group)
//       fog, haze, sun colour and intensity, environment, exposure and the sun's shadow camera, all driven by
//       the section's local progress. At progress 0 it does nothing. See airLight.js.
//   default export (visible world pieces, mounted INSIDE the reveal group)
//       CanopyShadows   a shadow only canopy: leaf cards 9 to 15 m up that cast and render nothing, so the ground
//                       and trunks get dappled shade that moves
//       LightShafts     four soft shafts of sun in the mist, billboarded about their axis
//       DustAndMotes    pollen and dust glinting in the shafts, midges and drifting seeds
//
// Budget: about 240 + 16 triangles, 5 draw calls (2 canopy, 1 shafts, 1 dust, plus the shadow pass for the
// canopy). Painting: two 256 px alpha masks, about 5 ms each, one per frame.
//
// REVEAL: every material here is passed through makeRevealable. It works on ShaderMaterial: three runs
// onBeforeCompile with the program parameters, whose `uniforms` are the material's own uniforms and whose
// fragmentShader is the source, so reveal.js adds uReveal and the dither discard at the top of main() with no
// help from us (our fragment shaders keep the literal text `void main() {`, which its regex needs).
//
// SHADOW CASTING WITHOUT BEING SEEN (verified in three r186, WebGLShadowMap.js):
//   * renderObject() adds an object to the shadow pass when object.visible, layers pass and
//     (castShadow && frustum check). It never reads material.colorWrite, material.depthWrite or depthFunc.
//   * getDepthMaterial() picks object.customDepthMaterial (ours: leaf shaped, with the foliage wind), and
//     only copies visible, side, map, alphaTest (and displacement and clipping state) from the visible material.
//     It must therefore carry the same map and alphaTest as the depth material, which ours does.
//   * Rendering the object to the screen with colorWrite false, depthWrite false and depthFunc NEVER writes
//     nothing at all, and its fragment shader is patched to a bare discard so it costs no texture fetch.
//   The post stack is not affected either: N8AO only re-renders transparent objects when transparency
//   detection is on (it is switched off in PostProcessing.jsx), and the DoF reads the depth buffer, which a
//   NEVER depth test never writes.
//
// SOFT DAPPLES: the softness is the shadow RADIUS of the sun, a property of the light that HeroScene owns
// (2.5 texels). LightRamp raises it toward WALKER_SHADOW.radiusEnd (6, in airTuning.js) while the walk is
// active and restores 2.5 at progress 0, so HeroScene needs no change. At about 7 mm per texel that is a 4 cm
// penumbra: soft, still shaped like leaves.
// ===========================================================================================

// ---------------------------------------------------------------------------------------------
// LightRamp
// ---------------------------------------------------------------------------------------------
export function LightRamp() {
  const stateRef = useRef(null);
  if (stateRef.current === null) stateRef.current = createRampState();

  useFrame((state, delta) => {
    updateLightRamp(stateRef.current, state, delta);
  });

  // Unmounted early (visitor still near the top): put the hero values back. Unmounted at the end (the
  // visitor scrolled past), leave them: the next section continues from the end of the ramp, a restore would
  // be a visible jump.
  useEffect(() => {
    const S = stateRef.current;
    return () => {
      if (S.active && (scrollState.sections.approach ?? 0) < 0.5) restoreHero(S);
    };
  }, []);

  return null;
}

// The scene fog's current density, and the fog strength relative to the hero (1 at the hero fog, about 0.6 at
// the end of the ramp: LightRamp thins the fog, and shafts and motes weaken with it).
const fogDensityOf = (scene) => (scene.fog && scene.fog.isFogExp2 ? scene.fog.density : LIGHT_RAMP.fogDensity[0]);
const hazeOf = (density) => THREE.MathUtils.clamp(density / LIGHT_RAMP.fogDensity[0], 0, 1.3);

// ---------------------------------------------------------------------------------------------
// CanopyShadows: the shadow only canopy
// ---------------------------------------------------------------------------------------------
const _gust = { x: 0, z: 0 };
const _matrix = new THREE.Matrix4();

// One InstancedMesh of one leaf mat (all clumps that use that mask). The mesh renders nothing (see the header).
function CanopyBatch({ clumps, species, seed, paint }) {
  const reduced = useReducedMotion();
  const meshRef = useRef(null);
  const matRef = useRef(null);

  const resources = useMemo(() => {
    const map = makeLeafMatTexture(paint);
    return {
      map,
      geometry: buildLeafMatGeometry(seed),
      // Same map and alphaTest as the visible material (getDepthMaterial copies them onto this one), plus the
      // shared foliage wind so the leaf shaped shadows shimmer with the rest of the foliage.
      depth: makeFoliageDepthMaterial({ map, alphaTest: 0.5, wind: CANOPY.wind }),
    };
  }, [paint, seed]);

  useEffect(
    () => () => {
      resources.map.dispose();
      resources.geometry.dispose();
      resources.depth.dispose();
    },
    [resources],
  );

  // The visible material draws nothing: a bare discard (so no texture fetch), no colour, no depth. It is
  // made revealable like everything else (harmless: it never reaches the screen), and given its own program
  // cache key so no other MeshBasicMaterial can share this discard only program by accident.
  useLayoutEffect(() => {
    const m = matRef.current;
    if (!m || m.userData.airPatched) return; // idempotent: React strict mode runs layout effects twice in dev
    m.userData.airPatched = true;
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(/void main\(\)\s*\{/, "void main() {\n  discard;\n");
    };
    makeRevealable(m);
    const key = m.customProgramCacheKey;
    m.customProgramCacheKey = () => `${key.call(m)}|air-canopy-caster`;
    m.needsUpdate = true;
  }, []);

  // Initial matrices (so the first shadow refresh already has the canopy in place).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // rewritten every frame while walking
    gustOffset(FROZEN_TIME, _gust);
    clumps.forEach((c, i) => mesh.setMatrixAt(i, composeClump(c, FROZEN_TIME, _gust, _matrix)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [clumps]);

  // Sway: every clump drifts in its own slow ellipse on top of a shared gust, so the dapples slide over the
  // ground and trunks. Skipped at progress 0 (the group is invisible and casts nothing) and frozen for
  // reduced motion. 60 matrices per frame is a few microseconds.
  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || (scrollState.sections.approach ?? 0) <= 0 || reduced) return;
    const time = state.clock.elapsedTime;
    gustOffset(time, _gust);
    for (let i = 0; i < clumps.length; i++) mesh.setMatrixAt(i, composeClump(clumps[i], time, _gust, _matrix));
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      name={`air:canopy-${species}`}
      args={[resources.geometry, undefined, clumps.length]}
      customDepthMaterial={resources.depth}
      castShadow
      frustumCulled={false}
    >
      <meshBasicMaterial
        ref={matRef}
        map={resources.map}
        alphaTest={0.5}
        side={THREE.DoubleSide}
        colorWrite={false}
        depthWrite={false}
        depthFunc={THREE.NeverDepth}
        fog={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

// Mask paint options at module scope: a new object per render would defeat the useMemo in CanopyBatch and
// repaint the texture every time the staging hook re-renders.
const PAINT_DENSE = { seed: 1 }; // about 65 percent opaque
const PAINT_BROKEN = { seed: 2, leaves: 150, holes: 0.58, leafLen: [0.09, 0.13] }; // about 49 percent, more open

function CanopyShadows() {
  // The clumps are planned once (about 3 ms): where each lands, then lifted up the sun ray. Deterministic.
  const plan = useMemo(() => {
    const landings = planShafts().map(({ def, landing }) => ({
      x: landing[0],
      z: landing[2],
      radius: def.width * 0.5 + CANOPY.shaftClear,
    }));
    const clumps = planCanopy({ sunDir: SUN_DIR, shaftLandings: landings });
    return { dense: clumps.filter((c) => c.species === "dense"), broken: clumps.filter((c) => c.species === "broken") };
  }, []);
  // Each mask is painted in its own frame so no frame carries more than about 5 ms of it.
  const readyDense = useStaged(4);
  const readyBroken = useStaged(9);
  return (
    <>
      {readyDense && plan.dense.length > 0 ? (
        <CanopyBatch clumps={plan.dense} species="dense" seed={1} paint={PAINT_DENSE} />
      ) : null}
      {readyBroken && plan.broken.length > 0 ? (
        <CanopyBatch clumps={plan.broken} species="broken" seed={2} paint={PAINT_BROKEN} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// LightShafts
// ---------------------------------------------------------------------------------------------
function LightShafts() {
  const reduced = useReducedMotion();
  const matRef = useRef(null);
  const plan = useMemo(() => planShafts(), []);
  const geometry = useMemo(() => buildShaftGeometry(plan), [plan]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      uStrength: { value: SHAFT_LOOK.strength },
      uFogDensity: { value: LIGHT_RAMP.fogDensity[0] },
      uBreath: { value: SHAFT_LOOK.breath },
      uNear: { value: new THREE.Vector2(...SHAFT_LOOK.nearFade) },
      uUnder: { value: SHAFT_LOOK.under },
      uAxis: { value: new THREE.Vector3(...SUN_DIR) },
      // Sunlight scattered by mist: brand cream, and the lantern warm light for the tint mix per shaft.
      uCream: { value: new THREE.Color(PALETTE.cream) },
      uWarm: { value: new THREE.Color(PALETTE.warmLight) },
    }),
    [],
  );

  useLayoutEffect(() => {
    if (matRef.current) makeRevealable(matRef.current);
  }, []);

  useFrame((state) => {
    const m = matRef.current;
    const t = scrollState.sections.approach ?? 0;
    if (!m || t <= 0) return;
    const u = m.uniforms;
    const density = fogDensityOf(state.scene);
    const haze = hazeOf(density);
    u.uTime.value = reduced ? FROZEN_TIME : state.clock.elapsedTime;
    u.uFogDensity.value = density;
    // Shafts are scattered light: they weaken as the haze thins and as the sun climbs.
    u.uStrength.value =
      SHAFT_LOOK.strength * Math.pow(haze, SHAFT_LOOK.haze) * (1 - SHAFT_LOOK.dimWithT * THREE.MathUtils.smoothstep(t, 0, 1));
  });

  return (
    <mesh geometry={geometry} renderOrder={3} frustumCulled={false} name="air:shafts">
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={SHAFT_VERT}
        fragmentShader={SHAFT_FRAG}
        transparent
        depthWrite={false}
        fog={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------------------------
// DustAndMotes
// ---------------------------------------------------------------------------------------------
const _dir = new THREE.Vector3();

function DustAndMotes() {
  const reduced = useReducedMotion();
  const matRef = useRef(null);
  const centre = useRef({ x: 0, z: 0, ready: false });
  const plan = useMemo(() => planShafts(), []);
  const geometry = useMemo(() => buildDustGeometry(plan), [plan]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const vertexShader = useMemo(() => dustVert(SHAFTS.length), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      uViewPx: { value: 1080 },
      uDpr: { value: 1 },
      uMinPx: { value: DUST.minPx },
      uFogDensity: { value: LIGHT_RAMP.fogDensity[0] },
      uHaze: { value: 1 },
      uBreath: { value: SHAFT_LOOK.breath },
      uFreeBright: { value: DUST.freeBrightness },
      uBeamBright: { value: DUST.beamBrightness },
      uCenter: { value: new THREE.Vector3(0, DUST.boxY0 + DUST.box[1] / 2, 9) },
      uBoxSize: { value: new THREE.Vector3(...DUST.box) },
      uAxis: { value: new THREE.Vector3(...SUN_DIR) },
      uShaftBase: { value: plan.map(({ def, landing }) => new THREE.Vector4(landing[0], landing[1], landing[2], def.length)) },
      uShaftDim: { value: plan.map(({ def }) => new THREE.Vector4(def.width, def.taper, 0, 0)) },
      uShaftAnim: { value: plan.map(({ def }) => new THREE.Vector4(def.period, def.phase, def.gain, 0)) },
      // Warm white-gold: brand cream nudged toward the lantern tone, like the hero motes.
      uColor: { value: new THREE.Color(PALETTE.particle).lerp(new THREE.Color(PALETTE.warmLight), 0.14) },
    }),
    [plan],
  );

  useLayoutEffect(() => {
    if (matRef.current) makeRevealable(matRef.current);
  }, []);

  useFrame((state, delta) => {
    const m = matRef.current;
    const t = scrollState.sections.approach ?? 0;
    if (!m || t <= 0) return;
    const u = m.uniforms;
    const density = fogDensityOf(state.scene);
    const haze = hazeOf(density);
    u.uTime.value = reduced ? FROZEN_TIME : state.clock.elapsedTime;
    u.uFogDensity.value = density;
    // Thinner haze and a higher sun make the motes fainter, like the shafts they glint in.
    u.uHaze.value = 1.25 * Math.pow(haze, 0.8);
    const dpr = state.gl.getPixelRatio();
    u.uDpr.value = dpr;
    u.uViewPx.value = state.size.height * dpr;
    // The wrap volume rides DUST.boxAhead metres ahead of the camera (flattened to the ground plane), eased so
    // a quick glance sideways does not drag the box edge across the view.
    state.camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1);
    _dir.normalize();
    const tx = state.camera.position.x + _dir.x * DUST.boxAhead;
    const tz = state.camera.position.z + _dir.z * DUST.boxAhead;
    const c = centre.current;
    if (!c.ready) {
      c.x = tx;
      c.z = tz;
      c.ready = true;
    } else {
      const k = 1 - Math.exp(-delta * 1.5);
      c.x += (tx - c.x) * k;
      c.z += (tz - c.z) * k;
    }
    u.uCenter.value.set(c.x, DUST.boxY0 + DUST.box[1] / 2, c.z);
  });

  return (
    <points geometry={geometry} renderOrder={4} frustumCulled={false} name="air:dust">
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={DUST_FRAG}
        transparent
        depthWrite={false}
        fog={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ---------------------------------------------------------------------------------------------
// The visible world pieces (default export, no props)
// ---------------------------------------------------------------------------------------------
export default function AirAndLight() {
  return (
    <group name="air-and-light">
      <CanopyShadows />
      <LightShafts />
      <DustAndMotes />
    </group>
  );
}
