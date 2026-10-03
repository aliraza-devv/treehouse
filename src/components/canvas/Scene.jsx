"use client";

import { Suspense, lazy, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, FOG } from "@/lib/sceneConfig";
import HeroScene from "./HeroScene";
import PostProcessing, { EXPOSURE } from "./PostProcessing";

// Development tooling is only referenced behind a build-time constant, so the bundler drops the
// whole import in production and r3f-perf (a dev dependency) never ships.
const DevTools = process.env.NODE_ENV === "development" ? lazy(() => import("./DevTools")) : null;

// Starts the fade-in once the scene has really drawn several frames (the staged parts are in by then). Texture painting and
// shader compilation can block the main thread for a moment, and a CSS transition that begins
// before that block would be eaten by it and look like a pop.
function FadeInTrigger({ onVisible }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 10) onVisible(); // after the staged parts have mounted
  });
  return null;
}

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene() {
  const [visible, setVisible] = useState(false);

  return (
    // The deep forest page colour sits behind the canvas, so the fade-in never reveals white.
    <div
      className={`pointer-events-none fixed inset-0 z-0 bg-brand-forest transition-opacity duration-[1400ms] ease-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <Canvas
        // The soft filter in this three.js version is PCFShadowMap (PCFSoftShadowMap was
        // removed); its softness is set per light with shadow.radius (see HeroScene).
        // autoUpdate is off: HeroScene's ShadowScheduler refreshes the map about 10 times a second.
        shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
        dpr={[1, 1.75]}
        // Rotation is owned by the camera rig (useIdle), which also adapts FOV to the viewport.
        camera={{ position: CAMERA.position, fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far }}
        gl={{
          // Edges are handled by SMAA in the post stack (MSAA cannot coexist with the depth
          // texture used by DoF and AO), and tone mapping happens in the post stack too.
          antialias: false,
          stencil: false,
          powerPreference: "high-performance",
          toneMapping: THREE.NoToneMapping,
          toneMappingExposure: EXPOSURE,
        }}
      >
        <color attach="background" args={[FOG.color]} />
        <HeroScene />
        <PostProcessing />
        <FadeInTrigger onVisible={() => setVisible(true)} />
        {DevTools && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
      </Canvas>
    </div>
  );
}
