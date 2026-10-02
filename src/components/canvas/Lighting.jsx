"use client";

// Cool morning key light with a pale sky/ground hemisphere fill.
// Colours come from the project palette: sky #C5D5E0 / forest floor #2B3D1A.
export default function Lighting() {
  return (
    <>
      <hemisphereLight args={["#C5D5E0", "#3D5226", 2.0]} />
      <directionalLight
        position={[-8, 14, 9]}
        intensity={2.2}
        color="#FFF1D6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={18}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0004}
      />
      {/* Soft cool rim from behind to separate the tree from the background */}
      <directionalLight position={[6, 8, -10]} intensity={0.8} color="#A0ADB8" />
    </>
  );
}
