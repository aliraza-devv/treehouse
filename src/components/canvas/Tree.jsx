"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createRng, range } from "@/lib/random";

const TRUNK_HEIGHT = 15;

// Trunk: a tapered cylinder whose vertices are pushed in and out to read as bark ridges.
// Radius profile: wide root flare at y=0 easing to a slim crown at the top.
function buildTrunkGeometry() {
  const geo = new THREE.CylinderGeometry(0.62, 1.0, TRUNK_HEIGHT, 28, 48, true);
  geo.translate(0, TRUNK_HEIGHT / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    // Two sine layers at different frequencies give irregular vertical ridges.
    const ridge =
      1 + 0.05 * Math.sin(angle * 6 + y * 0.7) + 0.035 * Math.sin(angle * 11 - y * 1.9);
    // Exponential flare so the base spreads into the roots.
    const flare = 1 + 0.9 * Math.exp(-y * 0.9);
    const s = ridge * flare;
    pos.setX(i, x * s);
    pos.setZ(i, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

// Branch definitions: height on trunk, azimuth (rad), upward tilt (rad), length, base radius.
const BRANCHES = [
  { y: 8.6, az: 0.5, tilt: 0.75, len: 4.2, r: 0.22 },
  { y: 9.4, az: 2.4, tilt: 0.7, len: 4.6, r: 0.24 },
  { y: 10.2, az: 4.1, tilt: 0.65, len: 4.4, r: 0.22 },
  { y: 11.4, az: 5.5, tilt: 0.6, len: 4.8, r: 0.22 },
  { y: 12.2, az: 1.4, tilt: 0.55, len: 4.2, r: 0.2 },
  { y: 13.0, az: 3.3, tilt: 0.5, len: 3.8, r: 0.18 },
  { y: 6.9, az: 3.7, tilt: 0.8, len: 3.2, r: 0.2 },
  { y: 2.6, az: 2.2, tilt: 1.0, len: 2.4, r: 0.16 },
];

function branchTip(b) {
  const dir = new THREE.Vector3(
    Math.cos(b.az) * Math.cos(b.tilt),
    Math.sin(b.tilt),
    Math.sin(b.az) * Math.cos(b.tilt),
  );
  return { dir, tip: new THREE.Vector3(0, b.y, 0).addScaledVector(dir, b.len) };
}

function Branches() {
  const items = useMemo(
    () =>
      BRANCHES.map((b) => {
        const { dir, tip } = branchTip(b);
        const mid = new THREE.Vector3(0, b.y, 0).addScaledVector(dir, b.len / 2);
        // Rotate the cylinder's local +Y onto the branch direction.
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        return { b, mid, quat, tip };
      }),
    [],
  );
  return (
    <group>
      {items.map(({ b, mid, quat }, i) => (
        <mesh key={i} position={mid} quaternion={quat} castShadow>
          <cylinderGeometry args={[b.r * 0.4, b.r, b.len, 8, 1]} />
          <meshStandardMaterial color="#5C3A1E" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// Canopy: instanced low-poly blobs clustered at branch tips and around the crown.
const LEAF_COUNT = 260;
function Foliage() {
  const ref = useRef(null);

  const blobs = useMemo(() => {
    const rng = createRng(7);
    const out = [];
    // Only the upper branches carry leaves so the treehouse stays visible below.
    const tips = BRANCHES.filter((b) => b.y > 8).map((b) => branchTip(b).tip);
    for (let i = 0; i < LEAF_COUNT; i++) {
      // Most blobs sit around a branch tip, the rest fill the crown above the trunk.
      const crown = i % 4 === 0;
      const base = crown ? new THREE.Vector3(0, 14.5, 0) : tips[Math.floor(rng() * tips.length)];
      const spread = crown ? 3.6 : 2.0;
      out.push({
        pos: new THREE.Vector3(
          base.x + range(rng, -spread, spread),
          base.y + range(rng, -0.8, 1.6) * (crown ? 1.4 : 1),
          base.z + range(rng, -spread, spread),
        ),
        scale: range(rng, 0.8, 1.7),
        rot: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6),
        tone: rng(),
      });
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const dark = new THREE.Color("#2D5016");
    const mid = new THREE.Color("#4A7A2E");
    const light = new THREE.Color("#6B8F3A");
    const c = new THREE.Color();
    blobs.forEach((b, i) => {
      dummy.position.copy(b.pos);
      dummy.rotation.copy(b.rot);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Dark to mid by tone, with higher blobs catching the highlight colour.
      c.copy(dark).lerp(mid, 0.35 + 0.65 * b.tone);
      c.lerp(light, THREE.MathUtils.clamp((b.pos.y - 11) / 8, 0, 1) * 0.6);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [blobs]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, LEAF_COUNT]} castShadow receiveShadow>
      {/* detail 1 icosahedron = 80 triangles; x260 is ~21k triangles */}
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={0.95} flatShading />
    </instancedMesh>
  );
}

export default function Tree() {
  const trunk = useMemo(() => buildTrunkGeometry(), []);
  return (
    <group>
      <mesh geometry={trunk} castShadow receiveShadow>
        <meshStandardMaterial color="#6B4226" roughness={1} flatShading side={THREE.DoubleSide} />
      </mesh>
      <Branches />
      <Foliage />
    </group>
  );
}
