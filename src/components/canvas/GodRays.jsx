"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Beam layout: x offset, depth, width, length, strength, flicker phase.
const BEAMS = [
  { x: -9, z: -7, w: 2.6, len: 34, a: 0.16, ph: 0.0 },
  { x: -4, z: -9, w: 1.4, len: 36, a: 0.12, ph: 1.3 },
  { x: 1, z: -11, w: 3.4, len: 40, a: 0.14, ph: 2.1 },
  { x: 6, z: -8, w: 1.8, len: 34, a: 0.11, ph: 3.4 },
  { x: 11, z: -12, w: 2.8, len: 40, a: 0.13, ph: 4.2 },
  { x: -14, z: -5, w: 1.6, len: 30, a: 0.09, ph: 5.0 },
];

// Tilt of each beam so it travels along the key light's screen direction.
// The key light travels (+8, -14) in x,y, so the beam's long axis (local Y) leans
// atan(8/14) = 0.52 rad from vertical.
const LEAN = Math.atan2(8, 14);

// Crepuscular rays: long additive planes that fade at both ends and at their edges.
export default function GodRays() {
  const uniforms = useMemo(
    () => BEAMS.map((b) => ({ uTime: { value: 0 }, uAlpha: { value: b.a }, uPhase: { value: b.ph } })),
    [],
  );
  useFrame(({ clock }) => {
    for (const u of uniforms) u.uTime.value = clock.elapsedTime;
  });

  return (
    <group>
      {BEAMS.map((b, i) => (
        <mesh key={i} position={[b.x, 8, b.z]} rotation={[0, 0, LEAN]} renderOrder={3}>
          <planeGeometry args={[b.w, b.len]} />
          <shaderMaterial
            uniforms={uniforms[i]}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            vertexShader={/* glsl */ `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `}
            fragmentShader={/* glsl */ `
              uniform float uTime;
              uniform float uAlpha;
              uniform float uPhase;
              varying vec2 vUv;
              void main() {
                // Soft edges across the width, brightest at the top where light enters the canopy.
                float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0);
                float along = smoothstep(0.0, 0.25, vUv.y) * pow(vUv.y, 0.8);
                float shimmer = 0.75 + 0.25 * sin(uTime * 0.5 + uPhase);
                float a = edge * along * shimmer * uAlpha * 2.6;
                gl_FragColor = vec4(vec3(1.0, 0.92, 0.72) * a, a);
              }
            `}
          />
        </mesh>
      ))}
    </group>
  );
}
