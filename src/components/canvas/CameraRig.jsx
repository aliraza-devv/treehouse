"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import useReducedMotion from "@/hooks/useReducedMotion";

export const CAMERA_BASE = new THREE.Vector3(1, 3, 17);
export const CAMERA_TARGET = new THREE.Vector3(3.6, 6.5, 0);

// Idle camera: a slow figure-of-eight drift plus a light pointer parallax,
// so the hero never feels frozen. Later scroll sections will drive this rig.
export default function CameraRig() {
  const reduced = useReducedMotion();
  const look = useRef(new THREE.Vector3().copy(CAMERA_TARGET));
  const pointer = useRef(new THREE.Vector2());

  useFrame(({ camera, clock, pointer: p }, delta) => {
    const t = reduced ? 0 : clock.elapsedTime;
    // Ease the pointer so parallax glides rather than snaps (exponential smoothing).
    const k = 1 - Math.exp(-delta * 2.5);
    pointer.current.lerp(reduced ? new THREE.Vector2() : p, k);

    camera.position.set(
      CAMERA_BASE.x + Math.sin(t * 0.21) * 0.45 + pointer.current.x * 0.6,
      CAMERA_BASE.y + Math.sin(t * 0.34) * 0.16 + pointer.current.y * 0.3,
      CAMERA_BASE.z + Math.sin(t * 0.13) * 0.4,
    );
    // The look target drifts slightly out of phase for a handheld, breathing feel.
    look.current.set(
      CAMERA_TARGET.x + Math.sin(t * 0.17 + 1) * 0.25,
      CAMERA_TARGET.y + Math.sin(t * 0.26) * 0.12,
      CAMERA_TARGET.z,
    );
    camera.lookAt(look.current);
  });
  return null;
}
