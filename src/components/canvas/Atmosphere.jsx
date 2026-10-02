"use client";

import { useMemo } from "react";
import * as THREE from "three";

export const FOG_COLOR = "#B0BEC9";

// Soft radial blob drawn to a canvas, used as a mist sprite texture.
function makeMistTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const MIST = [
  { pos: [-14, 2.2, -14], scale: [34, 7], opacity: 0.35 },
  { pos: [18, 1.8, -22], scale: [40, 8], opacity: 0.4 },
  { pos: [0, 3.2, -34], scale: [60, 12], opacity: 0.45 },
  { pos: [-6, 1.2, -4], scale: [26, 5], opacity: 0.22 },
  { pos: [14, 1.0, 2], scale: [22, 4], opacity: 0.18 },
];

// Cool morning atmosphere: exponential-ish linear fog, a vertical sky gradient dome,
// and a few low mist sprites drifting between the trunks.
export default function Atmosphere() {
  const mistTex = useMemo(() => makeMistTexture(), []);

  // Gradient dome: sky blue overhead melting into fog colour at the horizon.
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color("#C5D5E0") },
          bottom: { value: new THREE.Color(FOG_COLOR) },
        },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vH = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 bottom;
          varying float vH;
          void main() {
            float t = smoothstep(0.0, 0.55, vH);
            gl_FragColor = vec4(mix(bottom, top, t), 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  return (
    <>
      <fog attach="fog" args={[FOG_COLOR, 16, 78]} />
      <mesh material={skyMat} renderOrder={-1}>
        <sphereGeometry args={[110, 24, 16]} />
      </mesh>
      {MIST.map((m, i) => (
        <mesh key={i} position={m.pos} renderOrder={2}>
          <planeGeometry args={m.scale} />
          <meshBasicMaterial
            map={mistTex}
            transparent
            opacity={m.opacity}
            depthWrite={false}
            color="#B8C4CC"
            fog={false}
          />
        </mesh>
      ))}
    </>
  );
}
