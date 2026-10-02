"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const WOOD = "#A67C3B";
const WOOD_DARK = "#8B6914";
const BARK = "#5C3A1E";
const PLATFORM_Y = 5;

// Gabled roof: a triangle profile extruded along the cabin depth.
function buildRoofGeometry(width, rise, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// Railing posts placed along an arc at the front of the deck.
function Railing() {
  const ref = useRef(null);
  const count = 16;
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      // Sweep an arc from -60 to +120 degrees around the deck centre (front and right side).
      const a = THREE.MathUtils.degToRad(-60 + (i / (count - 1)) * 180);
      dummy.position.set(1.4 + Math.cos(a) * 3.0, 0.45, Math.sin(a) * 3.0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow>
        <boxGeometry args={[0.07, 0.9, 0.07]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
      </instancedMesh>
      {/* Handrail: a partial torus following the same arc, 180 degrees of the circle */}
      <mesh
        position={[1.4, 0.9, 0]}
        rotation={[Math.PI / 2, 0, THREE.MathUtils.degToRad(-60)]}
        castShadow
      >
        <torusGeometry args={[3.0, 0.04, 6, 32, Math.PI]} />
        <meshStandardMaterial color={WOOD} roughness={0.85} />
      </mesh>
    </group>
  );
}

// Straight stair flight climbing from the forest floor up to the deck edge.
function Stairs() {
  const steps = 14;
  const rise = PLATFORM_Y / steps;
  const run = 0.52;
  return (
    <group>
      {Array.from({ length: steps }).map((_, i) => (
        <mesh key={i} position={[4.1 + (steps - i) * run, rise * (i + 1) - 0.06, 1.1]} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.1, 1.0]} />
          <meshStandardMaterial color={WOOD} roughness={0.9} />
        </mesh>
      ))}
      {/* Support posts under every third step */}
      {[0, 3, 6, 9, 12].map((i) => (
        <mesh key={i} position={[4.1 + (steps - i) * run, (rise * (i + 1)) / 2, 1.5]} castShadow>
          <boxGeometry args={[0.1, rise * (i + 1), 0.1]} />
          <meshStandardMaterial color={BARK} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Lantern({ position }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color="#FFD9A0" emissive="#FFB347" emissiveIntensity={2.2} />
      </mesh>
      <pointLight color="#FFB86B" intensity={6} distance={7} decay={2} />
    </group>
  );
}

export default function Treehouse() {
  const roof = useMemo(() => buildRoofGeometry(3.3, 1.2, 2.9), []);
  const glow = { color: "#FFE2B0", emissive: "#FFA94D", emissiveIntensity: 1.6 };

  return (
    <>
    <group position={[0, PLATFORM_Y, 0]}>
      {/* Deck: 14-sided disc, offset so the trunk passes through its left side */}
      <mesh position={[1.4, -0.1, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[3.4, 3.2, 0.22, 14]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
      </mesh>
      {/* Support beams angled down into the trunk */}
      {[-1, 0, 1].map((k) => (
        <mesh
          key={k}
          position={[1.2, -0.95, k * 1.0]}
          rotation={[0, 0, -0.9]}
          castShadow
        >
          <boxGeometry args={[2.4, 0.14, 0.14]} />
          <meshStandardMaterial color={BARK} roughness={1} />
        </mesh>
      ))}

      {/* Cabin */}
      <mesh position={[1.9, 0.9, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 1.8, 2.3]} />
        <meshStandardMaterial color={WOOD} roughness={0.85} />
      </mesh>
      {/* Roof overhangs the cabin slightly; drawn as a dark gable */}
      <mesh geometry={roof} position={[1.9, 1.8, -0.2]} castShadow>
        <meshStandardMaterial color="#5C3A1E" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Chimney */}
      <mesh position={[2.9, 2.5, -0.5]} castShadow>
        <boxGeometry args={[0.35, 0.9, 0.35]} />
        <meshStandardMaterial color="#6B6055" roughness={1} />
      </mesh>

      {/* Windows and door on the camera-facing side (+Z) */}
      <mesh position={[1.2, 1.1, 0.96]}>
        <planeGeometry args={[0.6, 0.7]} />
        <meshStandardMaterial {...glow} />
      </mesh>
      <mesh position={[2.9, 1.1, 0.96]}>
        <planeGeometry args={[0.6, 0.7]} />
        <meshStandardMaterial {...glow} />
      </mesh>
      <mesh position={[2.05, 0.7, 0.96]}>
        <planeGeometry args={[0.65, 1.3]} />
        <meshStandardMaterial color="#5C3A1E" roughness={0.9} />
      </mesh>
      {/* Round window in the gable */}
      <mesh position={[1.9, 2.3, 0.96]}>
        <circleGeometry args={[0.28, 20]} />
        <meshStandardMaterial {...glow} />
      </mesh>

      <Railing />
      <Lantern position={[4.2, 1.5, 1.8]} />
      <Lantern position={[0.4, 1.5, 2.6]} />
    </group>
    {/* Stairs use world-space heights, so they sit outside the raised deck group */}
    <Stairs />
    </>
  );
}
