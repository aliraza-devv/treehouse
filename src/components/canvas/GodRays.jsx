"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, LIGHT, PALETTE } from "@/lib/sceneConfig";
import useReducedMotion from "@/hooks/useReducedMotion";

// Unit vector from the scene toward the sun: key light position minus its target, normalised, the
// same direction the shadow map uses. Light travels along the opposite direction. Exported as a
// plain array so every consumer builds its own vector.
const SUN_VEC = LIGHT.keyPosition.map((v, i) => v - LIGHT.target[i]);
const KEY_LEN = Math.hypot(...SUN_VEC);
export const SUN_DIR = SUN_VEC.map((v) => v / KEY_LEN);

// Shafts of sunlight. Each beam is a flat quad whose long axis lies along the sun direction and whose
// normal is as close to the camera as that constraint allows. Centres are chosen so the shafts fall
// to the right of and behind the treehouse (z < 0), leaving the cabin itself unwashed, and one slips
// through the canopy left of the trunk. Particles.jsx reads this list to brighten motes inside beams.
export const GOD_RAY_BEAMS = [
  { center: [9.5, 10, -6.3], width: 4.0, length: 30, gain: 1.0, phase: 0.0, seed: 0.13 },
  { center: [14.5, 10, -3.3], width: 2.8, length: 28, gain: 0.8, phase: 2.1, seed: 0.51 },
  { center: [-3.5, 10, -9.3], width: 3.4, length: 32, gain: 0.9, phase: 4.2, seed: 0.77 },
  // Two thinner shafts of different width and strength, so the set is not three similar bars.
  { center: [5.0, 10, -12.5], width: 1.7, length: 30, gain: 0.7, phase: 1.0, seed: 0.31 },
  { center: [-9.0, 10, -6.5], width: 2.2, length: 30, gain: 0.6, phase: 3.3, seed: 0.93 },
];

// Reduced motion freezes everything at this clock time (beams near mid brightness).
const FROZEN_TIME = 3.0;
// Opacity swings between 0.08 and 0.15 (centre 0.115, amplitude 0.035) with a 10 s period. These
// are normalised values: the shader multiplies by 4 and the per-beam gain, so the real peak alpha
// is about 0.3 to 0.6 before the shape terms. The 1.875x ratio and the 10 s rhythm are the spec.
const BEAM_BASE = 0.115;
const BEAM_AMP = 0.035;
const BEAM_PERIOD = 10.0;

// Warm cream with a touch of the lantern orange: sunlight scattered by mist.
const BEAM_COLOR = new THREE.Color(PALETTE.cream).lerp(new THREE.Color(PALETTE.warmLight), 0.5);
const HAZE_COLOR = new THREE.Color(PALETTE.cream).lerp(new THREE.Color(PALETTE.warmLight), 0.5);

const BEAM_VERT = /* glsl */ `
  attribute vec3 aBeam; // x = phase, y = gain, z = seed
  varying vec2 vUv;
  varying vec3 vBeam;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vBeam = aBeam;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uBase;
  uniform float uAmp;
  uniform float uPeriod;
  uniform vec3 uColor;
  uniform sampler2D uNoise;
  varying vec2 vUv;
  varying vec3 vBeam;
  varying vec3 vWorld;
  void main() {
    // Soft sides: 1 on the beam axis, 0 at both edges, eased so no edge line is ever visible.
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float edge = smoothstep(0.0, 0.9, across);
    edge *= edge;
    // Both ends dissolve; the upper (sun) end is a little denser than the lower one.
    float along = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
    // Density streaks: high frequency across the beam, low along it, so the shaft reads as light
    // cut by gaps in the canopy and breaking up in mist, not as a flat gradient. The streaks slide
    // sideways very slowly, as if the foliage were stirring.
    float n1 = texture2D(uNoise, vec2(vUv.x * 3.0 + vBeam.z, vUv.y * 0.7 - uTime * 0.012)).r;
    float n2 = texture2D(uNoise, vec2(vUv.x * 7.0 - vBeam.z * 1.7 + uTime * 0.01, vUv.y * 1.6 + 0.3)).r;
    float streak = smoothstep(0.28, 0.78, n1 * 0.6 + n2 * 0.4);
    // Fade out near the ground so a beam never visibly stabs into the forest floor.
    float groundFade = smoothstep(1.5, 6.5, vWorld.y);
    // Breathing: opacity 0.08 .. 0.15, own phase per beam.
    float o = uBase + uAmp * sin(6.2831853 * uTime / uPeriod + vBeam.x);
    float a = edge * along * streak * groundFade * o * vBeam.y * 4.0;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const HAZE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HAZE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform vec3 uColor;
  uniform sampler2D uNoise;
  varying vec2 vUv;
  void main() {
    // Radial glow with a broad, noisy shoulder so it reads as scattering in mist, not a sprite.
    float r = length(vUv - 0.5) * 2.0;
    float glow = pow(1.0 - smoothstep(0.0, 1.0, r), 1.8);
    float n = texture2D(uNoise, vUv * 1.4 + vec2(uTime * 0.003, 0.0)).r;
    float a = glow * (0.55 + 0.9 * n) * uAlpha;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Build the three shafts as one merged geometry (a single draw call).
function buildBeamGeometry() {
  const up = new THREE.Vector3(...SUN_DIR); // beam long axis, pointing at the sun
  const cam = new THREE.Vector3(...CAMERA.position);
  const positions = [];
  const uvs = [];
  const attrs = [];
  const index = [];
  GOD_RAY_BEAMS.forEach((b, i) => {
    const c = new THREE.Vector3(...b.center);
    const toCam = cam.clone().sub(c).normalize();
    // Orthonormal basis: Y = sun axis, X = Y x toCam (side), Z = X x Y = toCam minus its Y component.
    // Z is therefore the plane normal and it faces the camera as much as the axis constraint allows.
    const side = new THREE.Vector3().crossVectors(up, toCam).normalize().multiplyScalar(b.width / 2);
    const along = up.clone().multiplyScalar(b.length / 2);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [sx, sy] of corners) {
      const p = c.clone().addScaledVector(side, sx).addScaledVector(along, sy);
      positions.push(p.x, p.y, p.z);
      uvs.push((sx + 1) / 2, (sy + 1) / 2);
      attrs.push(b.phase, b.gain, b.seed);
    }
    const o = i * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("aBeam", new THREE.Float32BufferAttribute(attrs, 3));
  g.setIndex(index);
  return g;
}

// Crepuscular rays plus a faint warm haze on the sun side. Two draw calls, 8 triangles.
// `noiseMap` is the shared tileable fbm texture (single red channel) built by Atmosphere.jsx.
export default function GodRays({ noiseMap }) {
  const reduced = useReducedMotion();
  const beamMat = useRef(null);
  const hazeMat = useRef(null);

  const beamGeometry = useMemo(() => buildBeamGeometry(), []);
  useEffect(() => () => beamGeometry.dispose(), [beamGeometry]);

  const beamUniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      uBase: { value: BEAM_BASE },
      uAmp: { value: BEAM_AMP },
      uPeriod: { value: BEAM_PERIOD },
      uColor: { value: BEAM_COLOR },
      uNoise: { value: noiseMap },
    }),
    [noiseMap],
  );

  // Haze: a big camera-facing quad behind the canopy toward the sun (upper right of frame).
  const haze = useMemo(() => {
    // Upper right of frame: about 28 degrees right of the view axis and 9 degrees above it.
    const position = new THREE.Vector3(30, 36, -40);
    const m = new THREE.Matrix4().lookAt(position, new THREE.Vector3(...CAMERA.position), new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    return { position: position.toArray(), quaternion: q.toArray(), size: 70 };
  }, []);

  const hazeUniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      uAlpha: { value: 0.18 },
      uColor: { value: HAZE_COLOR },
      uNoise: { value: noiseMap },
    }),
    [noiseMap],
  );

  useFrame((state) => {
    const t = reduced ? FROZEN_TIME : state.clock.elapsedTime;
    if (beamMat.current) beamMat.current.uniforms.uTime.value = t;
    if (hazeMat.current) {
      hazeMat.current.uniforms.uTime.value = t;
      // Slow 17 s breathing, out of step with the beams.
      hazeMat.current.uniforms.uAlpha.value = 0.18 + 0.035 * Math.sin((t * Math.PI * 2) / 17 + 1.1);
    }
  });

  return (
    <group>
      <mesh position={haze.position} quaternion={haze.quaternion} scale={[haze.size, haze.size, 1]} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={hazeMat}
          uniforms={hazeUniforms}
          vertexShader={HAZE_VERT}
          fragmentShader={HAZE_FRAG}
          transparent
          depthWrite={false}
          fog={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={beamGeometry} renderOrder={3} frustumCulled={false}>
        <shaderMaterial
          ref={beamMat}
          uniforms={beamUniforms}
          vertexShader={BEAM_VERT}
          fragmentShader={BEAM_FRAG}
          transparent
          depthWrite={false}
          fog={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
