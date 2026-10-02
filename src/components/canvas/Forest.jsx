"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { groundHeight, TREE_X } from "@/lib/terrain";

// Rolling forest floor with vertex colours blending #1A2E0F to #2B3D1A.
function Ground() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(220, 220, 90, 90);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const dark = new THREE.Color("#1A2E0F");
    const light = new THREE.Color("#2B3D1A");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = groundHeight(x, z);
      pos.setY(i, h);
      // Patchy moss: low-frequency noise picks between the two floor tones.
      const t = 0.5 + 0.5 * Math.sin(x * 0.6) * Math.cos(z * 0.5);
      c.copy(dark).lerp(light, t);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  );
}

// Background forest: tall slim trunks plus blobby canopies, all instanced.
const BG_TREES = 78;
function BackgroundTrees() {
  const trunkRef = useRef(null);
  const crownRef = useRef(null);
  const CROWNS_PER_TREE = 3;

  const trees = useMemo(() => {
    const rng = createRng(21);
    const out = [];
    while (out.length < BG_TREES) {
      // Depth-weighted: more trees far back, sparse close to the hero tree.
      const z = range(rng, -75, 6);
      const x = range(rng, -55, 60);
      // Keep a clear pocket around the hero tree, stairs and camera line of sight.
      if (Math.hypot(x - TREE_X, z) < 15) continue;
      out.push({ x, z, h: range(rng, 22, 34), r: range(rng, 0.45, 0.9), tone: rng() });
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const rng = createRng(5);
    const bark = new THREE.Color("#5C3A1E");
    const bark2 = new THREE.Color("#3E2A18");
    const leafDark = new THREE.Color("#2D5016");
    const leafMid = new THREE.Color("#4A7A2E");
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      const y = groundHeight(t.x, t.z);
      dummy.position.set(t.x, y + t.h / 2 - 1, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.r, t.h, t.r);
      dummy.updateMatrix();
      trunkRef.current.setMatrixAt(i, dummy.matrix);
      trunkRef.current.setColorAt(i, c.copy(bark2).lerp(bark, t.tone));
      for (let k = 0; k < CROWNS_PER_TREE; k++) {
        const s = range(rng, 3.5, 6);
        dummy.position.set(
          t.x + range(rng, -2.5, 2.5),
          y + t.h * range(rng, 0.62, 0.95),
          t.z + range(rng, -2.5, 2.5),
        );
        dummy.rotation.set(rng() * 3, rng() * 3, 0);
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        const idx = i * CROWNS_PER_TREE + k;
        crownRef.current.setMatrixAt(idx, dummy.matrix);
        crownRef.current.setColorAt(idx, c.copy(leafDark).lerp(leafMid, rng() * 0.7));
      }
    });
    for (const m of [trunkRef.current, crownRef.current]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }, [trees]);

  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, BG_TREES]}>
        <cylinderGeometry args={[0.8, 1.1, 1, 6, 1, true]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, BG_TREES * CROWNS_PER_TREE]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}

// Ferns and shrubs: squashed icosahedra scattered across the clearing.
const SHRUBS = 90;
function Undergrowth() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const rng = createRng(33);
    const dummy = new THREE.Object3D();
    const a = new THREE.Color("#2D5016");
    const b = new THREE.Color("#4A7A2E");
    const c = new THREE.Color();
    let placed = 0;
    while (placed < SHRUBS) {
      const x = range(rng, -30, 36);
      const z = range(rng, -30, 11);
      // Leave the stair run and the base of the hero tree readable.
      if (Math.hypot(x - TREE_X, z) < 4.5) continue;
      if (z > -1 && z < 3 && x > TREE_X + 3) continue;
      const s = range(rng, 0.5, 1.4);
      dummy.position.set(x, groundHeight(x, z) + s * 0.2, z);
      dummy.rotation.set(0, rng() * 6, 0);
      dummy.scale.set(s * 1.4, s * 0.7, s * 1.4);
      dummy.updateMatrix();
      ref.current.setMatrixAt(placed, dummy.matrix);
      ref.current.setColorAt(placed, c.copy(a).lerp(b, rng()));
      placed++;
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.instanceColor.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, SHRUBS]} receiveShadow castShadow>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  );
}

export default function Forest() {
  return (
    <>
      <Ground />
      <BackgroundTrees />
      <Undergrowth />
    </>
  );
}
