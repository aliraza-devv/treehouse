"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createRng, range } from "@/lib/random";

const COUNT = 320;

// Floating pollen and dust motes. All motion happens in the vertex shader, so the
// CPU cost per frame is a single uniform update.
export default function Particles() {
  const mat = useRef(null);

  const geo = useMemo(() => {
    const rng = createRng(11);
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 3); // phase, speed, size
    for (let i = 0; i < COUNT; i++) {
      pos.set([range(rng, -16, 22), range(rng, 0.3, 14), range(rng, -12, 14)], i * 3);
      seed.set([rng() * Math.PI * 2, range(rng, 0.25, 0.9), range(rng, 0.6, 1.8)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color("#FFE6B0") } }),
    [],
  );

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          uniform float uTime;
          attribute vec3 aSeed;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            float t = uTime * aSeed.y;
            // Slow lazy drift on a Lissajous-like path, plus a gentle upward float.
            p.x += sin(t + aSeed.x) * 0.9;
            p.y += sin(t * 0.7 + aSeed.x * 1.7) * 0.5 + mod(uTime * 0.05 * aSeed.y, 1.0);
            p.z += cos(t * 0.8 + aSeed.x) * 0.9;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            // Perspective size attenuation: constant world size; 90 is a pixel tuning scale.
            gl_PointSize = aSeed.z * 90.0 / -mv.z;
            // Twinkle, and fade with distance so far motes dissolve into fog.
            vAlpha = (0.35 + 0.65 * sin(uTime * 1.3 + aSeed.x * 5.0) * 0.5 + 0.325)
                     * smoothstep(60.0, 8.0, -mv.z);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(uColor, a * a * vAlpha * 0.9);
          }
        `}
      />
    </points>
  );
}
