"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { groundHeight } from "@/lib/sceneConfig";
import useReducedMotion from "@/hooks/useReducedMotion";

// A child on the lawn, between the hero tree and the picnic table. The model is a third party CC-BY-4.0
// asset ("FHC: Crying Child" by Speed F1, see public/models/child/LICENSE.txt). It is static (no rig, no
// clips), so the "playing" is a light procedural idle: a small hop on the spot and a slow turn of the body.
const MODEL_URL = "/models/child/child.glb";
const HEIGHT = 1.2; // metres, about a five year old
// On the open lawn to the right of the ladder foot. About 8 m from the hero camera, so it sits in the lower
// middle of the frame (the lawn only reaches the middle of the frame when it is close), clear of the
// picnic table and the ladder.
const SPOT = { x: 3.6, z: 6.6 };
const FACE_YAW = Math.PI; // turned toward the camera (+z)
const HOP_HEIGHT = 0.02; // metres of bounce: a gentle weight shift, not a jump
const HOP_RATE = 1.6; // radians per second of the bounce
const SWAY = 0.08; // radians of body turn either side of FACE_YAW

export default function ChildOnLawn() {
  const { scene } = useGLTF(MODEL_URL);
  const reduced = useReducedMotion();
  const group = useRef(null);
  const baseY = groundHeight(SPOT.x, SPOT.z);

  // Clone so this instance owns its transform, then scale the model to HEIGHT metres and stand it on
  // y = 0 with its feet at the origin. The box is measured twice: once to get the scale, once after the
  // scale is applied, because the offsets are in scaled units.
  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    clone.scale.setScalar(HEIGHT / size.y);
    box.setFromObject(clone);
    const centre = box.getCenter(new THREE.Vector3());
    clone.position.set(-centre.x, -box.min.y, -centre.z);
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    if (reduced) {
      g.position.y = baseY;
      g.rotation.y = FACE_YAW;
      return;
    }
    // |sin| gives a hop that touches down at each bounce instead of sinking under the lawn
    g.position.y = baseY + Math.abs(Math.sin(t * HOP_RATE)) * HOP_HEIGHT;
    g.rotation.y = FACE_YAW + Math.sin(t * 0.7) * SWAY;
  });

  return (
    <group ref={group} position={[SPOT.x, baseY, SPOT.z]} rotation={[0, FACE_YAW, 0]} name="lawn-child">
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
