"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import Lighting from "./Lighting";
import Tree from "./Tree";
import Treehouse from "./Treehouse";

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene() {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        // Camera sits low on the forest floor and looks up toward the treehouse deck.
        camera={{ position: [1, 3, 17], fov: 45, near: 0.1, far: 120 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ camera }) => camera.lookAt(3.6, 6.5, 0)}
      >
        <color attach="background" args={["#C5D5E0"]} />
        <Lighting />
        {/* Tree sits right of centre so the headline can live on the left */}
        <group position={[2.6, 0, 0]}>
          <Tree />
          <Treehouse />
        </group>
        {/* Temporary ground, replaced by the full forest floor in the next step */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[120, 120]} />
          <meshStandardMaterial color="#2B3D1A" roughness={1} />
        </mesh>
      </Canvas>
    </div>
  );
}
