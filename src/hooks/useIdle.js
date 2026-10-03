"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, TREE, getCameraTarget } from "@/lib/sceneConfig";
import { cameraState } from "@/lib/scroll/cameraState";
import useReducedMotion from "@/hooks/useReducedMotion";

// ---------------------------------------------------------------------------
// Camera rig: base pose + handheld idle sway + responsive framing.
//
// BASE POSE
//   position = CAMERA.position, looking at getCameraTarget() (20 units ahead along the
//   forward vector pitched up CAMERA.pitchDeg). The pose is rebuilt from lookAt every time the
//   aspect ratio changes, so the framing is a pure function of the viewport and never drifts.
//
// IDLE SWAY (documentary handheld feel, NOT a tripod)
//   Each axis follows its own slow sine. Periods are deliberately unequal (6.3 s, 7.1 s, 7.9 s
//   for position; 6.7 s, 7.5 s, 7.9 s for rotation) so the motion never visibly loops:
//   with unequal periods the combined path only repeats after the least common multiple of the
//   periods, which is minutes, far longer than anyone watches the hero.
//     position amplitude  0.02 units on every axis (2 cm at the scene scale of 1 unit = 1 m)
//     rotation amplitude  0.005 rad (about 0.29 degrees) pitch and yaw, half of that for roll
//   The rotation offset is applied as a small Euler quaternion multiplied onto the lookAt
//   quaternion (local space), so it rocks around the lens, which is how a hand-held camera moves.
//
// RESPONSIVE FRAMING (portrait and narrow windows)
//   Landscape (aspect >= 1) keeps CAMERA.fov and CAMERA.position exactly. Below aspect 1 the
//   horizontal field of view collapses (hfov = 2 atan(tan(vfov / 2) * aspect)): at aspect 0.5 a
//   50 degree vertical FOV gives only 27 degrees horizontally, which cannot hold the 6 m deck
//   plus branches 15 m away. So with t = 0 (landscape) to 1 (aspect 0.45 or narrower) we:
//     1. widen the vertical FOV from CAMERA.fov up to PORTRAIT_FOV (62 degrees),
//     2. slide camera AND look target sideways by up to PORTRAIT_SHIFT_X toward the tree, which
//        keeps the view direction identical (a pure truck move, no yaw) so foreground leaves
//        placed against the base camera still hug the frame edges,
//     3. dolly back by up to PORTRAIT_DOLLY units so the deck and roof both fit vertically.
//   Check at t = 1: hfov = 2 atan(tan(31 deg) * 0.45) = 30 degrees; the camera is 17.5 m from
//   the deck plane, so the frame is 2 * 17.5 * tan(15 deg) = 9.4 m wide, centred 2.6 m right of
//   the base axis, spanning x in about [-2.1, 7.3] around the deck (x 0.3 to 6.5) and its branches
//   (the 17.5 above is approximate: 14 + 3.5 dolly minus the deck depth of about 0.8).
//   There is NO pointer parallax and NO user camera control by design.
//
// SCROLL CAMERA (Section 2 onward)
//   While cameraState.active (src/lib/scroll/cameraState.js, written by ScrollCameraRig with a
//   negative useFrame priority so it runs first) the base pose is the scroll camera pose (position,
//   look-at target, roll, fov) instead of the fixed hero pose. The sway below is applied on top of it
//   with the same amplitudes. At progress 0 cameraState.active is false and this hook behaves exactly
//   as before, so the hero frame is untouched.
// ---------------------------------------------------------------------------

const PORTRAIT_FOV = 62; // widest vertical FOV in degrees
const PORTRAIT_SHIFT_X = TREE.x + 0.4; // truck toward the tree axis (world units)
const PORTRAIT_DOLLY = 3.5; // pull back along +Z (world units)
const PORTRAIT_MIN_ASPECT = 0.45; // at or below this aspect the portrait adjustments are complete

const TAU = Math.PI * 2;

// Sway tuning. Periods in seconds, amplitudes in world units (position) and radians (rotation).
const POS_AMP = 0.02;
const ROT_AMP = 0.005;
const POS_PERIOD = [6.3, 7.1, 7.9];
const ROT_PERIOD = [6.7, 7.5, 7.9];
// Starting phases (radians) so the three axes are never in lock step at t = 0.
const POS_PHASE = [0.0, 1.7, 3.1];
const ROT_PHASE = [2.2, 0.6, 4.0];

// Hermite smoothstep, local so this hook has no dependency on three internals per frame.
function smoothstep01(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// All scratch objects live in one lazily created record so useFrame allocates nothing.
function createScratch() {
  return {
    aspect: -1, // last aspect the base pose was built for (forces a first build)
    fov: CAMERA.fov,
    basePos: new THREE.Vector3(),
    baseTarget: new THREE.Vector3(),
    baseQuat: new THREE.Quaternion(),
    lookMatrix: new THREE.Matrix4(),
    up: new THREE.Vector3(0, 1, 0),
    euler: new THREE.Euler(0, 0, 0, "YXZ"),
    swayQuat: new THREE.Quaternion(),
    // Scroll camera base pose (used while cameraState.active)
    rigPos: new THREE.Vector3(),
    rigQuat: new THREE.Quaternion(),
    rollQuat: new THREE.Quaternion(),
    forwardZ: new THREE.Vector3(0, 0, 1),
  };
}

// 0 for aspect >= 1 (landscape, untouched), 1 for aspect <= PORTRAIT_MIN_ASPECT.
function portraitAmount(aspect) {
  return 1 - smoothstep01((aspect - PORTRAIT_MIN_ASPECT) / (1 - PORTRAIT_MIN_ASPECT));
}

// Rebuild base position, look target and orientation for a viewport aspect ratio.
function buildBasePose(s, aspect) {
  const t = portraitAmount(aspect);
  const [cx, cy, cz] = CAMERA.position;
  const [tx, ty, tz] = getCameraTarget();
  const shiftX = PORTRAIT_SHIFT_X * t;
  const dolly = PORTRAIT_DOLLY * t;
  s.fov = CAMERA.fov + (PORTRAIT_FOV - CAMERA.fov) * t;
  s.basePos.set(cx + shiftX, cy, cz + dolly);
  // Target moves with the camera so the forward vector (and 20 degree pitch) is unchanged.
  s.baseTarget.set(tx + shiftX, ty, tz + dolly);
  // Camera.lookAt convention: a camera looks down -Z, so lookAt(eye, target, up) builds the
  // rotation matrix whose -Z column points at the target.
  s.lookMatrix.lookAt(s.basePos, s.baseTarget, s.up);
  s.baseQuat.setFromRotationMatrix(s.lookMatrix);
  s.aspect = aspect;
}

// The un-swayed camera pose for a viewport aspect: other components (the foreground leaves) use it
// to anchor themselves to the real frame instead of guessing.
export function getRigPose(aspect) {
  const s = createScratch();
  buildBasePose(s, aspect);
  return { position: s.basePos.clone(), target: s.baseTarget.clone(), fov: s.fov, portrait: portraitAmount(aspect) };
}

// useIdle: drives the active camera every frame. Call it once, inside <Canvas>.
export default function useIdle() {
  const reduced = useReducedMotion();
  // The frame loop reads the latest preference through a ref, so a change never re-subscribes.
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  const scratchRef = useRef(null);
  if (scratchRef.current === null) scratchRef.current = createScratch();

  useFrame((state) => {
    const s = scratchRef.current;
    const camera = state.camera;
    const aspect = state.size.width / Math.max(1, state.size.height);

    if (aspect !== s.aspect) buildBasePose(s, aspect);

    // Base pose for this frame: the hero pose, or the scroll camera while it is active.
    let basePos = s.basePos;
    let baseQuat = s.baseQuat;
    let fov = s.fov;
    if (cameraState.active) {
      s.rigPos.copy(cameraState.position);
      s.lookMatrix.lookAt(s.rigPos, cameraState.target, s.up);
      s.rigQuat.setFromRotationMatrix(s.lookMatrix);
      // Roll about the view axis. Positive roll leans right (clockwise for the viewer), which is a
      // NEGATIVE rotation about the camera's local +Z (it points back toward the viewer).
      s.rollQuat.setFromAxisAngle(s.forwardZ, -THREE.MathUtils.degToRad(cameraState.roll));
      s.rigQuat.multiply(s.rollQuat);
      basePos = s.rigPos;
      baseQuat = s.rigQuat;
      fov = cameraState.fov;
    }
    if (camera.isPerspectiveCamera && Math.abs(camera.fov - fov) > 1e-6) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // Reduced motion: no sway, but the base pose is still applied (and re-applied, which also
    // restores it if anything else nudged the camera).
    if (reducedRef.current) {
      camera.position.copy(basePos);
      camera.quaternion.copy(baseQuat);
      return;
    }

    const time = state.clock.elapsedTime;
    // Position: base + a tiny sine per axis (world axes: x right, y up, z toward the viewer).
    camera.position.set(
      basePos.x + POS_AMP * Math.sin((TAU * time) / POS_PERIOD[0] + POS_PHASE[0]),
      basePos.y + POS_AMP * Math.sin((TAU * time) / POS_PERIOD[1] + POS_PHASE[1]),
      basePos.z + POS_AMP * Math.sin((TAU * time) / POS_PERIOD[2] + POS_PHASE[2]),
    );
    // Rotation: small pitch (x), yaw (y) and half-strength roll (z), applied in camera space.
    s.euler.set(
      ROT_AMP * Math.sin((TAU * time) / ROT_PERIOD[0] + ROT_PHASE[0]),
      ROT_AMP * Math.sin((TAU * time) / ROT_PERIOD[1] + ROT_PHASE[1]),
      ROT_AMP * 0.5 * Math.sin((TAU * time) / ROT_PERIOD[2] + ROT_PHASE[2]),
    );
    s.swayQuat.setFromEuler(s.euler);
    camera.quaternion.copy(baseQuat).multiply(s.swayQuat);
  });
}

// Mount inside <Canvas>. Renders nothing; it only drives the camera.
export function CameraRig() {
  useIdle();
  return null;
}
