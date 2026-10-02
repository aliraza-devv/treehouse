"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import Lighting from "./Lighting";
import Atmosphere, { FOG_COLOR } from "./Atmosphere";
import CameraRig, { CAMERA_BASE } from "./CameraRig";
import Effects from "./Effects";
import Forest from "./Forest";
import ForegroundLeaves from "./ForegroundLeaves";
import GodRays from "./GodRays";
import Particles from "./Particles";
import Tree from "./Tree";
import Treehouse from "./Treehouse";

// Fires once, after the first frames have rendered, so the load-in can start on a warm scene.
function ReadySignal({ onReady }) {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current === 12) onReady?.();
    frames.current += 1;
  });
  return null;
}

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene({ onReady }) {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        // Camera sits low on the forest floor and looks up toward the treehouse deck.
        camera={{ position: CAMERA_BASE.toArray(), fov: 45, near: 0.1, far: 120 }}
        // Antialiasing and tone mapping move into the postprocessing stack (Effects.jsx).
        gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
      >
        <color attach="background" args={[FOG_COLOR]} />
        <Atmosphere />
        <Lighting />
        {/* Tree sits right of centre so the headline can live on the left */}
        <group position={[2.6, 0, 0]}>
          <Tree />
          <Treehouse />
        </group>
        <Forest />
        <ForegroundLeaves />
        <GodRays />
        <Particles />
        <CameraRig />
        <ReadySignal onReady={onReady} />
        <Effects />
      </Canvas>
    </div>
  );
}
