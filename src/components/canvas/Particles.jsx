"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { CAMERA, PALETTE } from "@/lib/sceneConfig";
import useReducedMotion from "@/hooks/useReducedMotion";
import { GOD_RAY_BEAMS, SUN_DIR } from "./GodRays";

const COUNT = 120;
// Wrap volume around the tree and the camera: x -10..14, y 0.5..16, z -14..12.
const BOX_MIN = [-10, 0.5, -14];
const BOX_SIZE = [24, 15.5, 26];
// Reduced motion freezes the motes at this clock time.
const FROZEN_TIME = 20.0;
// Smallest point size in device pixels per dpr unit. A 0.03 unit mote is ~1.5 px at 15 units, which
// would shimmer and vanish, so it is clamped up and dimmed by the lost coverage instead.
const MIN_PX = 4.2;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uViewPx;     // drawing buffer height in pixels
  uniform float uDpr;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  uniform vec3 uSunDir;
  uniform vec3 uBeamAxis;
  uniform vec4 uBeams[${GOD_RAY_BEAMS.length}]; // xyz = centre, w = half width
  attribute vec4 aSeed;      // x = phase, y = speed multiplier, z = world size, w = twinkle rate
  varying float vBright;
  varying float vAlpha;

  void main() {
    float ph = aSeed.x;
    // Per-mote drift velocity (units per second): a slow rise, a small shared breeze toward +x and
    // a lazy individual lateral wander. All well under 0.15 u/s so the motes hang in the air.
    vec3 vel = vec3(0.035 + 0.05 * sin(ph * 3.1), 0.045 + 0.05 * (0.5 + 0.5 * sin(ph * 1.7)), 0.05 * cos(ph * 2.3)) * aSeed.y;
    // Wrap into the box. The wobble is added after the wrap so it can never cause a jump.
    vec3 pw = uBoxMin + mod(position - uBoxMin + vel * uTime, uBoxSize);
    vec3 wob = vec3(sin(uTime * 0.31 + ph), 0.5 * sin(uTime * 0.23 + ph * 1.7), cos(uTime * 0.27 + ph * 1.3)) * 0.35;
    vec3 p = pw + wob;

    // Fade across the last 7% of each box face so wrapping is never seen as a pop.
    vec3 l = (pw - uBoxMin) / uBoxSize;
    vec3 e = smoothstep(vec3(0.0), vec3(0.07), l) * (1.0 - smoothstep(vec3(0.93), vec3(1.0), l));
    float edge = e.x * e.y * e.z;

    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;

    // World size to pixels: pixels = size * (H / 2) / (tan(fov / 2) * dist), and projectionMatrix[1][1] = 1 / tan(fov / 2).
    float px = aSeed.z * uViewPx * projectionMatrix[1][1] * 0.5 / dist;
    float minPx = ${MIN_PX.toFixed(1)} * uDpr;
    gl_PointSize = max(px, minPx);
    float coverage = clamp(px / minPx, 0.3, 1.0);

    // Twinkle: slow shimmer, never fully dark.
    float tw = 0.65 + 0.35 * sin(uTime * aSeed.w + ph * 5.0);

    // Forward scattering: motes between the camera and a sun behind the tree catch more light.
    vec3 viewDir = normalize(p - cameraPosition);
    float fwd = pow(max(dot(viewDir, uSunDir), 0.0), 3.0);

    // Motes inside a god ray are lit by the shaft itself: distance from the beam axis line.
    float beam = 0.0;
    for (int i = 0; i < ${GOD_RAY_BEAMS.length}; i++) {
      vec3 rel = p - uBeams[i].xyz;
      float along = dot(rel, uBeamAxis);
      float perp = length(rel - along * uBeamAxis);
      float inside = (1.0 - smoothstep(0.35, 1.0, perp / uBeams[i].w)) * (1.0 - smoothstep(10.0, 15.0, abs(along)));
      beam = max(beam, inside);
    }
    beam *= smoothstep(1.5, 5.0, p.y);

    vBright = (0.55 + 0.45 * tw) * (0.9 + 1.2 * fwd) + 4.0 * beam;

    // Distance fade: dissolve into the haze far away, and soften motes right at the lens.
    float farFade = 1.0 - 0.75 * smoothstep(14.0, 32.0, dist);
    float nearFade = (0.4 + 0.6 * smoothstep(0.8, 4.0, dist)) * smoothstep(0.5, 1.5, dist);
    vAlpha = edge * coverage * farFade * nearFade * 1.25;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vBright;
  varying float vAlpha;
  void main() {
    // Soft round sprite: bright pinpoint core inside a quick falloff.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.0);
    gl_FragColor = vec4(uColor * vBright, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Dust and pollen: 100 additive soft points whose whole life (drift, wrap, twinkle, beam light)
// is computed in the vertex shader. CPU cost per frame is a handful of uniform writes.
export default function Particles() {
  const reduced = useReducedMotion();
  const mat = useRef(null);

  const geometry = useMemo(() => {
    const rng = createRng(11);
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 4);
    const up = new THREE.Vector3(...SUN_DIR);
    const cam = new THREE.Vector3(...CAMERA.position);
    for (let i = 0; i < COUNT; i++) {
      let x = range(rng, BOX_MIN[0], BOX_MIN[0] + BOX_SIZE[0]);
      let y = range(rng, BOX_MIN[1], BOX_MIN[1] + BOX_SIZE[1]);
      let z = range(rng, BOX_MIN[2], BOX_MIN[2] + BOX_SIZE[2]);
      // The first motes are seeded inside the left and right shafts so a few glint from the first frame.
      if (i < 16) {
        const b = GOD_RAY_BEAMS[i % 2 === 0 ? 0 : 2];
        const c = new THREE.Vector3(...b.center);
        const side = new THREE.Vector3().crossVectors(up, cam.clone().sub(c)).normalize();
        const p = c.addScaledVector(up, range(rng, -7, 7)).addScaledVector(side, range(rng, -0.5, 0.5) * b.width);
        x = THREE.MathUtils.clamp(p.x, BOX_MIN[0] + 1, BOX_MIN[0] + BOX_SIZE[0] - 1);
        y = THREE.MathUtils.clamp(p.y, BOX_MIN[1] + 1, BOX_MIN[1] + BOX_SIZE[1] - 1);
        z = THREE.MathUtils.clamp(p.z, BOX_MIN[2] + 1, BOX_MIN[2] + BOX_SIZE[2] - 1);
      }
      pos.set([x, y, z], i * 3);
      // phase, speed multiplier, world size (0.02..0.04), twinkle rate
      seed.set([rng() * Math.PI * 2, range(rng, 0.6, 1.5), range(rng, 0.02, 0.04), range(rng, 0.6, 1.8)], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: FROZEN_TIME },
      uViewPx: { value: 1080 },
      uDpr: { value: 1 },
      uBoxMin: { value: new THREE.Vector3(...BOX_MIN) },
      uBoxSize: { value: new THREE.Vector3(...BOX_SIZE) },
      uSunDir: { value: new THREE.Vector3(...SUN_DIR) },
      uBeamAxis: { value: new THREE.Vector3(...SUN_DIR) },
      uBeams: { value: GOD_RAY_BEAMS.map((b) => new THREE.Vector4(...b.center, b.width * 0.5)) },
      // Warm white-gold: brand cream nudged toward the lantern tone.
      uColor: { value: new THREE.Color(PALETTE.particle).lerp(new THREE.Color(PALETTE.warmLight), 0.14) },
    }),
    [],
  );

  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    m.uniforms.uTime.value = reduced ? FROZEN_TIME : state.clock.elapsedTime;
    const dpr = state.gl.getPixelRatio();
    m.uniforms.uDpr.value = dpr;
    m.uniforms.uViewPx.value = state.size.height * dpr;
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={4}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        fog={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
