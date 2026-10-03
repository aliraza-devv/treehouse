"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cameraState } from "@/lib/scroll/cameraState";
import { scrollState } from "@/lib/scroll/scrollStore";
import { createPose, getCameraPath, smooth } from "@/lib/sections/cameraPath";
import { TIMELINE } from "@/lib/sections";
import useReducedMotion from "@/hooks/useReducedMotion";

// ---------------------------------------------------------------------------
// ScrollCameraRig: turns scroll progress into the camera pose.
//
// Runs with a NEGATIVE useFrame priority, so it executes before useIdle (priority 0) and before the
// post stack (priority 1) and everything else that reads the camera. Each frame it
//   1. evaluates the global camera path at scrollState.progress (see cameraPath.js),
//   2. adds the FOOTSTEP BOB,
//   3. writes the result into cameraState, which useIdle uses as its base pose (and puts the same
//      handheld sway on top of),
//   4. publishes scrollState.look.focusDistance (depth of field) while a section provides one.
// It never touches the Three camera itself: useIdle does, so there is one writer of the camera.
//
// At progress 0 cameraState.active is false and useIdle runs its original hero code path untouched, so
// the hero frame is pixel identical. For progress above 0 the path is evaluated; at the first
// keyframe it equals the hero base pose to floating point precision (see the identity check in the
// notes), so there is no jump at the handover either.
// ---------------------------------------------------------------------------

// Progress at or below this is "the hero": the rig steps aside completely.
const HERO_EPS = 1e-6;

// FOOTSTEP BOB. Phase advances with DISTANCE WALKED along the camera curve (not with time), so the
// steps keep pace with the ground whatever the scroll speed, stop when scrolling stops and run
// backwards when the visitor scrolls back. One step (one vertical bounce) per STEP_LENGTH metres.
const STEP_LENGTH = 0.75; // metres per footstep
const BOB_VERTICAL = 0.012; // peak vertical oscillation (metres), a very small head bob
const BOB_LATERAL = 0.006; // peak lateral counter sway (metres), at half the step frequency (left/right foot)
// The bob amplitude follows the camera speed: zero when stationary, full above BOB_FULL_SPEED m/s. The speed
// is low pass filtered (BOB_SPEED_TAU seconds) so the bob fades in and out instead of switching.
const BOB_FULL_SPEED = 0.9;
const BOB_SPEED_TAU = 0.15;

const TAU = Math.PI * 2;

export default function ScrollCameraRig() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // All per frame state lives in one record created once (no allocation inside useFrame).
  const rig = useRef(null);
  if (rig.current === null) {
    rig.current = {
      aspect: -1,
      path: null,
      pose: createPose(),
      lastDistance: null, // metres walked at the previous frame (null = no previous frame)
      speed: 0, // filtered camera speed, m/s
      forward: new THREE.Vector3(),
      camera: null, // the Three camera, for the dev helper
    };
  }

  useFrame((state, delta) => {
    const r = rig.current;
    r.camera = state.camera;
    const aspect = state.size.width / Math.max(1, state.size.height);
    if (r.path === null || r.aspect !== aspect) {
      r.path = getCameraPath(TIMELINE, aspect);
      r.aspect = aspect;
    }

    const progress = scrollState.progress;
    if (progress <= HERO_EPS) {
      // The hero owns the camera. Reset what the walk accumulated so a scroll back to the top is clean.
      cameraState.active = false;
      scrollState.look.focusDistance = null;
      r.lastDistance = null;
      r.speed = 0;
      return;
    }

    const pose = r.path.evaluate(progress, r.pose);
    const dt = Math.min(0.1, Math.max(1 / 240, delta));

    // ----- footstep bob -----------------------------------------------------------------------------------
    let bobY = 0;
    let bobSide = 0;
    if (!reducedRef.current) {
      const walked = pose.distance;
      const instant = r.lastDistance === null ? 0 : Math.abs(walked - r.lastDistance) / dt;
      r.lastDistance = walked;
      r.speed += (instant - r.speed) * (1 - Math.exp(-dt / BOB_SPEED_TAU));
      const amount = smooth(0.04, BOB_FULL_SPEED, r.speed);
      if (amount > 0) {
        const phase = (TAU * walked) / STEP_LENGTH;
        bobY = BOB_VERTICAL * amount * Math.sin(phase);
        bobSide = BOB_LATERAL * amount * Math.sin(phase * 0.5);
      }
    } else {
      r.lastDistance = null;
      r.speed = 0;
    }

    // The lateral sway is along the camera's right vector on the ground plane: right = (-fz, fx).
    r.forward.subVectors(pose.target, pose.position);
    const horizontal = Math.hypot(r.forward.x, r.forward.z) || 1;
    const rightX = -r.forward.z / horizontal;
    const rightZ = r.forward.x / horizontal;

    cameraState.position.set(pose.position.x + rightX * bobSide, pose.position.y + bobY, pose.position.z + rightZ * bobSide);
    cameraState.target.copy(pose.target);
    cameraState.roll = pose.roll;
    cameraState.fov = pose.fov;
    cameraState.active = true;

    // ----- depth of field focus -----------------------------------------------------------------------------
    // Provided by the owning section (approach: rack from the cabin to the midground about 6 m ahead,
    // then to the steps). null hands the focus back to the hero behaviour in PostProcessing.
    const focus = pose.entry?.camera?.focus;
    scrollState.look.focusDistance = focus ? focus(pose.local, pose, progress) : null;
  }, -1);

  // Development helper: window.__cam() reports the FINAL camera (rig pose plus sway). Folded away in
  // production builds by the NODE_ENV check.
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      window.__cam = () => {
        const r = rig.current;
        const camera = r.camera;
        if (!camera) return null;
        const distance = cameraState.active ? cameraState.position.distanceTo(cameraState.target) : 20;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const lookAt = camera.position.clone().addScaledVector(forward, distance);
        return {
          position: camera.position.toArray(),
          lookAt: lookAt.toArray(),
          roll: cameraState.active ? cameraState.roll : 0,
          fov: camera.fov,
          progress: scrollState.progress,
          activeId: scrollState.activeId,
        };
      };
      return () => {
        delete window.__cam;
      };
    }
  }, []);

  return null;
}
