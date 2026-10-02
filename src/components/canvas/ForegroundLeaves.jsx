"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createRng, range } from "@/lib/random";

// One leaf outline: pointed tip, rounded belly, built from two bezier curves.
// Length 1 along +Y, max width about 0.45.
function buildLeafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.34, 0.18, 0.3, 0.7, 0, 1);
  s.bezierCurveTo(-0.3, 0.7, -0.34, 0.18, 0, 0);
  return new THREE.ShapeGeometry(s, 6);
}

// Leaves hang in from the frame edges, close to the lens so depth of field blurs them.
const COUNT = 36;
export default function ForegroundLeaves() {
  const ref = useRef(null);
  const group = useRef(null);
  const geo = useMemo(() => buildLeafGeometry(), []);

  useLayoutEffect(() => {
    const rng = createRng(99);
    const dummy = new THREE.Object3D();
    const dark = new THREE.Color("#2D5016");
    const light = new THREE.Color("#6B8F3A");
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      // Corner anchors in camera-facing space: top-left, top-right, bottom-left, bottom-right.
      const corner = i % 4;
      const sx = corner % 2 === 0 ? -1 : 1;
      const sy = corner < 2 ? 1 : -1;
      const x = 1 + sx * range(rng, 2.4, 3.8);
      const y = 3 + sy * range(rng, 1.0, 2.1);
      const z = range(rng, 12.5, 14.5);
      dummy.position.set(x, y, z);
      // Point each leaf inward toward the frame centre with some random spread.
      const inward = Math.atan2(-sx, -sy * 0.6);
      dummy.rotation.set(range(rng, -0.6, 0.6), range(rng, -0.5, 0.5), inward + range(rng, -0.7, 0.7));
      const s = range(rng, 0.7, 1.5);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
      ref.current.setColorAt(i, c.copy(dark).lerp(light, rng() * 0.8));
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.instanceColor.needsUpdate = true;
  }, []);

  // Very slow breathing of the whole leaf layer.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    group.current.rotation.z = Math.sin(t * 0.4) * 0.012;
    group.current.position.y = Math.sin(t * 0.6) * 0.04;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={ref} args={[geo, undefined, COUNT]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.8} side={THREE.DoubleSide} flatShading />
      </instancedMesh>
    </group>
  );
}
