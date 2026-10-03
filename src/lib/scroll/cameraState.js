import * as THREE from "three";

// The scroll camera's pose for THIS frame, before the idle sway. Tiny mutable record on purpose
// (read every frame, never React state).
//
//   Writer : ScrollCameraRig (useFrame priority -1, so it runs before everything that reads it).
//   Reader : useIdle, which uses it as the base pose (instead of the fixed hero pose) and lays the
//            handheld sway on top while `active` is true.
//
// `active` is false at progress 0, which makes useIdle run its original hero code path untouched
// (pixel identical to the approved hero frame). `roll` is in degrees, positive = leaning to the
// right (the camera's top tilts toward the right shoulder, clockwise as the viewer sees it).
// `fov` is the final vertical FOV in degrees (portrait widening already included).
export const cameraState = {
  active: false,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  roll: 0,
  fov: 50,
};
