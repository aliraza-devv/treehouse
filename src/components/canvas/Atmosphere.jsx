"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, FOG, PALETTE, TREE, groundHeight } from "@/lib/sceneConfig";
import { createNoise, fillFbm } from "@/lib/noise";
import useReducedMotion from "@/hooks/useReducedMotion";
import GodRays, { SUN_DIR } from "./GodRays";
import Particles from "./Particles";

// How strongly the procedural sky lights every PBR material (scene.environmentIntensity).
export const ENVIRONMENT_INTENSITY = 0.6;
// Reduced motion freezes sky drift and mist at this clock time.
const FROZEN_TIME = 12.0;

// ---------------------------------------------------------------------------------------------
// Shared tileable fbm texture (single channel). Used for sky wisps, mist banks, god ray streaks
// and the sun haze, so the whole atmosphere costs one 256x256 upload (about 20 ms to paint).
// ---------------------------------------------------------------------------------------------
function createAtmosphereNoise() {
  const S = 256;
  const field = new Float32Array(S * S);
  fillFbm(createNoise(31), field, S, S, {
    fx: 5,
    fy: 5,
    octaves: 5,
    gain: 0.52,
    warp: { freq: 2, amp: 0.6 },
  });
  // fbm clusters around 0.5; stretch to the full 0..1 range so thresholds in the shaders behave.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (field[i] < lo) lo = field[i];
    if (field[i] > hi) hi = field[i];
  }
  const data = new Uint8Array(S * S);
  const inv = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < field.length; i++) data[i] = Math.round((field[i] - lo) * inv * 255);
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Sky shader. One definition drives both the visible background dome and the PMREM environment,
// so the light that falls on the wood is exactly the sky the viewer sees.
// ---------------------------------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // The dome is never rotated, so object space position is the world direction.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uGround;
  uniform vec3 uCloud;
  uniform vec3 uGlow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uGlowDir;
  uniform float uGlowLobe;
  uniform float uGroundMix;
  uniform float uSunPower;
  uniform float uTime;
  uniform sampler2D uNoise;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;

    // Elevation gradient: fog tone at the horizon, pale blue lower sky, near white overhead.
    vec3 col = mix(uHorizon, uLow, smoothstep(0.0, 0.3, y));
    col = mix(col, uHigh, smoothstep(0.2, 0.9, y));

    // Soft cloud and haze wisps. The sky is projected onto a flat layer, uv = xz / (y + 0.22), so
    // wisps shrink toward the horizon like real cloud decks; two noise octaves drift at different
    // speeds. Contrast is low: these are thin high veils, not cumulus.
    vec2 cuv = d.xz / (max(y, 0.0) + 0.22);
    float n1 = texture2D(uNoise, cuv * 0.22 + vec2(uTime * 0.0015, uTime * 0.0006)).r;
    float n2 = texture2D(uNoise, cuv * 0.61 + vec2(-uTime * 0.002, 3.7)).r;
    float cloud = smoothstep(0.48, 0.82, n1 * 0.7 + n2 * 0.3) * smoothstep(0.05, 0.4, y);
    col = mix(col, uCloud, cloud * 0.55);
    // A little cool grey in the thinnest gaps keeps the veil from looking painted on.
    col = mix(col, uHigh * 0.93, (1.0 - smoothstep(0.2, 0.5, n1)) * 0.18 * smoothstep(0.1, 0.5, y));

    // Warm scattering around the sun: a broad lobe plus a tighter bright one, then the disc itself.
    // The disc is HDR (uSunPower >> 1) so reflections get a real glint and bloom has something to catch.
    float s = max(dot(d, uSunDir), 0.0);
    col += uGlow * (0.32 * pow(s, 6.0) + 0.6 * pow(s, 40.0));
    // Visible dome only (uGlowLobe > 0): a wide warm lobe around a pseudo sun low in the upper
    // right of the frame. The real key light sits 48 degrees up, which is outside the frame, so
    // without this the viewer never sees where the light comes from.
    float sg = max(dot(d, uGlowDir), 0.0);
    col += uGlow * uGlowLobe * (0.55 * pow(sg, 3.0) + 0.9 * pow(sg, 28.0));
    float disc = smoothstep(cos(0.05), cos(0.035), dot(d, uSunDir));
    col += uSunColor * disc * uSunPower;

    // Environment only: below the horizon the sphere becomes the dim mossy bounce from the forest floor.
    col = mix(col, uGround, (1.0 - smoothstep(-0.3, 0.0, y)) * uGroundMix);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Fresh uniform set for one sky material. groundMix 0 = visible dome, 1 = environment capture.
// The visible dome (groundMix 0) is seen through gaps in the crowns, where it must read as MIST,
// not as a bright open sky: if the gap is much brighter than the fog the crown is tinted into,
// distant crowns turn into polka-dot stencils. So its low and high colours are only 8 to 15 percent
// above the fog. The environment capture (groundMix 1) keeps the bright blue sky for lighting.
// Pseudo sun for the visible glow: 28 degrees up, 33 degrees right of the view axis.
const GLOW_DIR = new THREE.Vector3(9, 9, -14).normalize();
function makeSkyUniforms(noiseMap, groundMix, time) {
  const visible = groundMix === 0;
  const fog = new THREE.Color(PALETTE.fog);
  const glow = new THREE.Color(PALETTE.cream).lerp(new THREE.Color(PALETTE.warmLight), visible ? 0.5 : 0.35);
  return {
    uHorizon: { value: fog.clone() },
    uLow: { value: visible ? fog.clone().multiplyScalar(1.08) : new THREE.Color(PALETTE.skyLow) },
    uHigh: { value: visible ? fog.clone().multiplyScalar(1.15) : new THREE.Color(PALETTE.skyHigh) },
    // Forest-floor bounce: dark moss, lifted a little toward the mist because fog scatters light downward too.
    uGround: { value: new THREE.Color(PALETTE.mossTone).lerp(fog, 0.2) },
    uCloud: { value: visible ? fog.clone().multiplyScalar(1.2) : new THREE.Color(PALETTE.skyCloud) },
    uGlow: { value: glow },
    uGlowDir: { value: GLOW_DIR.clone() },
    uGlowLobe: { value: visible ? 1 : 0 },
    uSunColor: { value: new THREE.Color(PALETTE.key) },
    uSunDir: { value: new THREE.Vector3(...SUN_DIR) },
    uGroundMix: { value: groundMix },
    uSunPower: { value: visible ? 0 : 12 },
    uTime: { value: time },
    uNoise: { value: noiseMap },
  };
}

// ---------------------------------------------------------------------------------------------
// Mist banks: eight thin sheets stacked in depth between the camera and the far tree line.
// All six are merged into ONE mesh, ordered far to near so normal blending composes correctly.
// Each bottom edge follows groundHeight() and sits slightly below the soil, while the shader fades
// density to zero at the bottom, so the sheet never shows a hard line where it meets the ground.
// ---------------------------------------------------------------------------------------------
const MIST_BANKS = [
  // z: depth, height: sheet height above the ground, opacity: peak alpha, speed: noise drift in tiles per second
  // Ordered far to near. The two low sheets (z -21 and -11) are the thick ground hugging layer a
  // woodland mist hangs in: thin (1.6 to 1.9 m) and denser than the tall banks, so the lower trunks
  // sink into it while the crowns above stay clearer, which is what separates near, mid and far.
  { z: -36, height: 7.5, opacity: 0.34, speed: 0.004, seed: 0.0 },
  { z: -26, height: 6.5, opacity: 0.28, speed: 0.006, seed: 0.37 },
  { z: -21, height: 1.9, opacity: 0.3, speed: 0.003, seed: 0.71 },
  { z: -16, height: 5.5, opacity: 0.24, speed: 0.005, seed: 0.61 },
  { z: -11, height: 1.6, opacity: 0.26, speed: 0.004, seed: 0.27 },
  { z: -7, height: 4.2, opacity: 0.2, speed: 0.008, seed: 0.83 },
  { z: 3, height: 3.0, opacity: 0.14, speed: 0.007, seed: 0.19 },
  { z: 11, height: 2.2, opacity: 0.16, speed: 0.01, seed: 0.52 },
];

function buildMistGeometry() {
  const positions = [];
  const uvs = [];
  const attrs = [];
  const index = [];
  let base = 0;
  for (const b of MIST_BANKS) {
    // Width grows with distance so a bank always spans past the frame edges (horizontal half-FOV
    // is about 41 degrees at 16:9, so half-width 0.87 * dist; 2.6 * dist leaves margin for sway and narrow screens).
    const dist = CAMERA.position[2] - b.z;
    const width = Math.max(44, dist * 2.6);
    const cols = Math.min(40, Math.max(14, Math.round(width / 3)));
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = TREE.x + (u - 0.5) * width;
      const g = groundHeight(x, b.z);
      const y0 = g - 0.3;
      const y1 = g + b.height;
      positions.push(x, y0, b.z, x, y1, b.z);
      uvs.push(u, 0, u, 1);
      attrs.push(b.opacity, b.speed, b.seed, b.opacity, b.speed, b.seed);
    }
    for (let i = 0; i < cols; i++) {
      const a = base + i * 2; // bottom of column i; a + 1 is its top, a + 2 / a + 3 the next column
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    base += (cols + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("aBank", new THREE.Float32BufferAttribute(attrs, 3));
  g.setIndex(index);
  return g;
}

const MIST_VERT = /* glsl */ `
  attribute vec3 aBank; // x = peak opacity, y = drift speed, z = noise seed
  varying vec2 vUv;
  varying vec3 vBank;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vBank = aBank;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uWarm;
  uniform sampler2D uNoise;
  varying vec2 vUv;
  varying vec3 vBank;
  varying vec3 vWorld;

  void main() {
    // Noise lives in world space (about 22 units per tile horizontally, 9 vertically) so streak size
    // is the same on every bank. The y scale is bigger than x: mist is wider than it is tall.
    vec2 q = vec2(vWorld.x * 0.045 + vBank.z, vWorld.y * 0.11);
    float drift = uTime * vBank.y;
    float n1 = texture2D(uNoise, q + vec2(drift, 0.0)).r;
    float n2 = texture2D(uNoise, q * 2.3 + vec2(-drift * 1.7, 0.37)).r;
    float d = n1 * 0.62 + n2 * 0.38;

    // Vertical profile: zero at the sheet's bottom edge (hides the ground intersection), densest low
    // down, ragged top edge because the cutoff is displaced by the noise.
    float v = vUv.y;
    float rise = smoothstep(0.0, 0.22, v);
    float top = 1.0 - smoothstep(0.2, 1.0, v + (d - 0.5) * 0.7);
    // Sides fade out well before the geometry ends, so there is never a visible left or right edge.
    float side = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
    float body = smoothstep(0.28, 0.78, d);
    float a = rise * top * side * body * vBank.x;

    // Dissolve when the lens is close to a sheet so it never reads as a flat wall in front of the camera.
    a *= smoothstep(1.0, 4.0, distance(vWorld, cameraPosition));

    // Mist toward the sun side (+x, higher up) picks up a warm, lit tint.
    float warm = smoothstep(-6.0, 22.0, vWorld.x) * smoothstep(1.0, 5.0, vWorld.y) * 0.22;
    gl_FragColor = vec4(mix(uColor, uWarm, warm), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function MistBanks({ noiseMap, reduced }) {
  const mat = useRef(null);
  const geometry = useMemo(() => buildMistGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      // Mist reads as the fog colour, lifted slightly toward cream where it is lit.
      uColor: { value: new THREE.Color(PALETTE.fog).lerp(new THREE.Color(PALETTE.cream), 0.25) },
      uWarm: { value: new THREE.Color(PALETTE.cream).lerp(new THREE.Color(PALETTE.warmLight), 0.3) },
      uNoise: { value: noiseMap },
    }),
    [noiseMap],
  );

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = reduced ? FROZEN_TIME : state.clock.elapsedTime;
  });

  return (
    <mesh geometry={geometry} renderOrder={2} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={MIST_VERT}
        fragmentShader={MIST_FRAG}
        transparent
        depthWrite={false}
        fog={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------------------------
// Atmosphere: procedural sky (visible dome + PMREM image based light), exponential fog, mist banks,
// god rays and dust. Renders nothing but these, owns no lights. About 700 triangles, 5 draw calls.
// ---------------------------------------------------------------------------------------------
export default function Atmosphere() {
  const reduced = useReducedMotion();
  const get = useThree((s) => s.get);
  const domeRef = useRef(null);
  const skyMat = useRef(null);

  const noiseMap = useMemo(() => createAtmosphereNoise(), []);
  useEffect(() => () => noiseMap.dispose(), [noiseMap]);

  const domeGeometry = useMemo(() => new THREE.SphereGeometry(90, 32, 16), []);
  useEffect(() => () => domeGeometry.dispose(), [domeGeometry]);

  const domeUniforms = useMemo(() => makeSkyUniforms(noiseMap, 0, FROZEN_TIME), [noiseMap]);

  // Image based lighting: render the same sky (plus a mossy ground hemisphere) into a cube once,
  // prefilter it with PMREM, and use it as scene.environment. Torn down on unmount.
  useEffect(() => {
    const { gl, scene } = get();
    const envScene = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(50, 32, 16);
    const envMat = new THREE.ShaderMaterial({
      uniforms: makeSkyUniforms(noiseMap, 1, FROZEN_TIME),
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    envScene.add(new THREE.Mesh(envGeo, envMat));

    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(envScene, 0.02, 0.1, 100);
    scene.environment = target.texture;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;

    // The capture scene is no longer needed once the cube is built.
    envGeo.dispose();
    envMat.dispose();
    pmrem.dispose();

    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [get, noiseMap]);

  useFrame((state) => {
    // The dome rides with the camera so it is always at infinity (no parallax, no far plane clipping).
    if (domeRef.current) domeRef.current.position.copy(state.camera.position);
    if (skyMat.current) skyMat.current.uniforms.uTime.value = reduced ? FROZEN_TIME : state.clock.elapsedTime;
  });

  return (
    <>
      {/* Background and fog share one colour so no hard horizon edge can ever show. */}
      <color attach="background" args={[FOG.color]} />
      <fogExp2 attach="fog" args={[FOG.color, FOG.density]} />

      <mesh ref={domeRef} geometry={domeGeometry} renderOrder={-1} frustumCulled={false}>
        <shaderMaterial
          ref={skyMat}
          uniforms={domeUniforms}
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          side={THREE.BackSide}
          depthWrite={false}
          depthTest={false}
          fog={false}
        />
      </mesh>

      <MistBanks noiseMap={noiseMap} reduced={reduced} />
      <GodRays noiseMap={noiseMap} />
      <Particles />
    </>
  );
}
