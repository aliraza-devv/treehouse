import { CAMERA, getCameraTarget } from "@/lib/sceneConfig";
import { getRigPose } from "@/hooks/useIdle";

// ===========================================================================================
// SECTION 0: THE HERO (anchor)
//
// The hero has no scroll length of its own. It is an ANCHOR entry (length 0) whose only job is to
// hold the hero camera pose: the approved forest-floor frame, looking up at the treehouse. Its single
// keyframe is the hero base pose, so the global camera curve starts exactly where the hero camera is.
//
// The base pose is a function of the viewport aspect (portrait phones are dollied back and
// widened, see getRigPose in src/hooks/useIdle.js), so the keyframe is a function of aspect too.
// Keyframe fov is the LANDSCAPE value; cameraPath.js adds the portrait widening to every keyframe,
// which makes pose(0) equal getRigPose(aspect) for any viewport.
// ===========================================================================================

export function heroKeyframe(aspect) {
  const rig = getRigPose(aspect);
  return { position: rig.position.toArray(), lookAt: rig.target.toArray(), roll: 0, fov: CAMERA.fov };
}

// The landscape hero pose as plain numbers (position, and the point 20 m ahead pitched up).
export const HERO_POSE = {
  position: [...CAMERA.position],
  lookAt: getCameraTarget(),
  roll: 0,
  fov: CAMERA.fov,
};

const hero = {
  id: "hero",
  length: 0, // anchor: no scroll length, it only holds the pose at progress 0
  camera: { keyframes: (aspect) => [heroKeyframe(aspect)], pace: null },
  Scene: null, // the hero scene is mounted by HeroScene itself, not by the sections host
  Controllers: null,
  overlay: null, // hero copy is page level (HeroContent inside HeroFade)
  reveal: false,
};

export default hero;
