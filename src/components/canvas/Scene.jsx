"use client";

import { Canvas } from "@react-three/fiber";

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene() {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 1.6, 9], fov: 45, near: 0.1, far: 120 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#C5D5E0"]} />
      </Canvas>
    </div>
  );
}
