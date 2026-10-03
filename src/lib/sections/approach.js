import { lazy } from "react";
import * as THREE from "three";
import { CAMERA, TREE } from "@/lib/sceneConfig";
import {
  EYE_HEIGHT,
  EYE_HEIGHT_END,
  GLIMPSES,
  PATH_LENGTH,
  SIGNS,
  TREEHOUSE_CENTER,
  atPath,
  pathAt,
} from "@/lib/sections/world";
import { lerp, makePace, smooth } from "@/lib/sections/cameraPath";
import { heroKeyframe } from "@/lib/sections/hero";
import { getRigPose } from "@/hooks/useIdle";
import ApproachOverlay from "@/components/ui/approach/ApproachOverlay";

// ===========================================================================================
// SECTION 1: THE APPROACH
//
// The camera leaves the forest floor and walks the worn path toward the tree: eye level, a gentle
// S weave, slight roll leaning into the weave, a pitch schedule that mostly looks down the path
// and lifts through the gaps to glimpse the treehouse, slowing at each signpost, and settling at
// END_POSE close to the base of the main trunk, looking at the first wooden steps.
//
// Everything below is derived from the world contract (src/lib/sections/world.js), so moving a
// sign, a trunk or a glimpse there moves the camera with it. The tuning knobs are the constants at
// the top of each block.
//
// Vocabulary: `s` is the fraction of the path centreline (0 = hero camera, 1 = trunk base). The
// camera walks s = 0 .. S_END and the section's local scroll progress maps onto that walk through
// the PACE function (a speed profile with a slow-down at every signpost).
// ===========================================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ----- walk extent ---------------------------------------------------------------------------------
export const S_END = 0.94; // the camera stops here (about 0.85 m before the path meets the trunk)
export const KEY_COUNT = 48; // keyframes incl. the hero one: one every 0.02 of the path, about 0.28 m
export const SCROLL_LENGTH_VH = 7; // scroll distance of the section in viewport heights

// ----- the weave -----------------------------------------------------------------------------------
// Lateral offset from the centreline (metres, + right) is a sine: lateral = A sin(2 pi s / lambda).
// lambda 0.42 puts the extremes at s = 0.105, 0.315, 0.525, 0.735, which is where the four close
// trunks stand (0.10, 0.33, 0.55, 0.73), alternating right, left, right, left. With A = 0.4 the camera
// is 0.4 m off the centreline exactly as it passes each one, so a trunk standing 1.2 to 1.4 m off the
// centreline is passed at about 0.8 to 1.0 m from its axis (0.4 to 0.55 m from the bark).
const WEAVE_AMPLITUDE = 0.4;
const WEAVE_WAVELENGTH = 0.42;
const WEAVE_START_RAMP = 0.04; // the weave grows in over the first 4 percent of the path
const WEAVE_FADE_FROM = 0.76; // and settles to the centreline toward the end pose
const ROLL_MAX_DEG = 1.2; // roll leans into the turn: negative at a right extreme (turning back left)

export function weaveLateral(s) {
  const envelope = smooth(0, WEAVE_START_RAMP, s) * (1 - smooth(WEAVE_FADE_FROM, S_END, s));
  return WEAVE_AMPLITUDE * Math.sin((TAU * s) / WEAVE_WAVELENGTH) * envelope;
}

// Camera roll in degrees. Lateral acceleration is -A k^2 sin(k s), so the lean is proportional to
// -sin(k s): positive roll (lean right) while swinging right, then left as the weave turns back.
export function weaveRollDeg(s) {
  const envelope = smooth(0, 0.06, s) * (1 - smooth(0.78, S_END, s));
  return -ROLL_MAX_DEG * Math.sin((TAU * s) / WEAVE_WAVELENGTH) * envelope;
}

// ----- eye height and field of view ------------------------------------------------------------------
const RISE_END_S = 0.14; // from the hero's 0.9 m (forest floor) up to walking eye level by here
const FOV_END = 54; // the lens opens a little as we arrive so the trunk and steps fit the frame

function eyeHeight(s) {
  const rise = smooth(0, RISE_END_S, s);
  const walking = lerp(CAMERA.position[1], EYE_HEIGHT, rise);
  return walking + (EYE_HEIGHT_END - EYE_HEIGHT) * smooth(0.45, S_END, s); // rises slightly at the end
}

const fovAt = (s) => lerp(CAMERA.fov, FOV_END, smooth(0.7, S_END, s)); // landscape value

// Camera position (before the portrait offset) at path fraction s.
function cameraPosition(s) {
  const ground = atPath(s, weaveLateral(s)); // ground.y is groundHeight at the weaving position
  return new THREE.Vector3(ground.x, ground.y + eyeHeight(s), ground.z);
}

// ----- END_POSE ----------------------------------------------------------------------------------------
// Close to the base of the main trunk (about 2.8 m from the bark), looking at the first wooden steps
// (TRUNK_STEPS: azimuth 84 degrees, they spiral up from 0.4 m) and the roots, tilted up about 4 degrees.
// The look-at point sits on the step spiral around the third step, at the bark of the flared trunk.
// Position is the walking path at S_END at eye height (the weave has settled to the centreline).
// The Climb section starts from this EXACT pose: it must repeat END_POSE as its first keyframe. FOV is the
// landscape value (the path adds the portrait widening to every keyframe, see cameraPath.js).
const r3 = (v) => Math.round(v * 1000) / 1000;
const END_POSITION = cameraPosition(S_END);
const END_LOOK_AT = [r3(TREE.x + 0.12), 1.95, r3(TREE.z + 1.1)];
export const END_POSE = {
  position: [r3(END_POSITION.x), r3(END_POSITION.y), r3(END_POSITION.z)],
  lookAt: END_LOOK_AT,
  roll: 0,
  fov: FOV_END,
};

// ----- look direction ----------------------------------------------------------------------------------
// The view direction is built from yaw (0 = -Z, positive = to the right), pitch (up positive) and a
// look-at distance D: lookAt = position + dir * D. The first keyframe is the hero pose (yaw 0, pitch
// 20 degrees, D = 20 m: that is how getCameraTarget() defines it), so the schedule starts there.
const LOOK_AHEAD_M = 6; // base yaw aims at the centreline this far ahead (smooths the tight S bends)
const D_HERO = 20;
const D_WALK = 14;
const BASE_PITCH = (s) => (3 + 1.8 * Math.sin(TAU * s * 1.7 + 0.8)) * DEG; // 1.2 to 4.8 degrees, never constant

const SIGN_GLANCE_MAX = 16 * DEG;

// Glimpse windows: the camera lifts its gaze up through the gaps toward the cabin. The window rises
// over 0.05 of the path, holds for 0.024, and falls over 0.05 (about 0.7 m each way). The last one
// falls more slowly (0.075) because it is the long settle from looking up at the cabin down to the
// trunk steps.
const GLIMPSE_RISE = 0.05;
const GLIMPSE_FALL = 0.05;
const GLIMPSE_FALL_LAST = 0.075;
const GLIMPSE_HALF_HOLD = 0.012;
const PITCH_MIN_PEAK = 14 * DEG;
const PITCH_MAX_PEAK = 36 * DEG;
// Where the cabin centre sits in the frame at each glimpse peak (NDC y; the upper third starts at 0.33).
// It climbs as we get closer so the cabin is never centred, and slides out of the top as we arrive.
const CABIN_NDC_Y = [0.55, 0.62, 0.7, 0.8, 0.85];
// Where the cabin centre sits horizontally at a glimpse peak (NDC x, + right of centre): the tree is to
// the right of the path, so the glance puts it on the right third, never dead centre, never at the edge.
const CABIN_NDC_X = 0.38;

const SIGN_POINTS = SIGNS.map((sign) => ({ s: sign.s, ...atPath(sign.s, sign.lateral) }));

const bearing = (from, x, z) => Math.atan2(x - from.x, -(z - from.z)); // yaw toward (x, z)
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function glimpseWindow(center, s, fall) {
  return (
    smooth(center - GLIMPSE_HALF_HOLD - GLIMPSE_RISE, center - GLIMPSE_HALF_HOLD, s) *
    (1 - smooth(center + GLIMPSE_HALF_HOLD, center + GLIMPSE_HALF_HOLD + fall, s))
  );
}

// Build the approach keyframes for a viewport aspect. keyframes[0] IS the hero pose for that aspect
// (a function of aspect, not a constant); keyframes[KEY_COUNT - 1] IS END_POSE.
export function buildApproachKeyframes(aspect) {
  const rig = getRigPose(aspect);
  const portrait = rig.portrait; // 0 landscape .. 1 portrait phone
  const fovDelta = rig.fov - CAMERA.fov;

  // The portrait hero pose is the landscape one trucked 3 m right and dollied 3.5 m back. That
  // offset fades out over the first stretch of the walk so the camera glides onto the path (a
  // longer fade in portrait, because the offset is bigger).
  const heroLandscape = heroKeyframe(1.78); // aspect >= 1 is exactly the landscape pose
  const offsetPos = rig.position.clone().sub(new THREE.Vector3(...heroLandscape.position));
  const offsetTarget = rig.target.clone().sub(new THREE.Vector3(...heroLandscape.lookAt));
  const fadeWidth = 0.12 + 0.2 * portrait;

  const hfovHalf = (fovDeg) => Math.atan(Math.tan((fovDeg * DEG) / 2) * aspect);

  // Glimpse peaks: pitch that puts the cabin centre at CABIN_NDC_Y[k] of the half frame height.
  const glimpses = GLIMPSES.map((g, k) => {
    const pos = cameraPosition(g.s);
    const fov = fovAt(g.s) + fovDelta;
    const elevation = Math.atan2(TREEHOUSE_CENTER.y - pos.y, Math.hypot(TREEHOUSE_CENTER.x - pos.x, TREEHOUSE_CENTER.z - pos.z));
    const above = Math.atan(CABIN_NDC_Y[Math.min(k, CABIN_NDC_Y.length - 1)] * Math.tan((fov * DEG) / 2));
    return {
      s: g.s,
      peak: THREE.MathUtils.clamp(elevation - above, PITCH_MIN_PEAK, PITCH_MAX_PEAK),
      fall: k === GLIMPSES.length - 1 ? GLIMPSE_FALL_LAST : GLIMPSE_FALL,
    };
  });

  // Where the end pose is looking from the end position (the last keyframes blend toward it).
  const endPos = new THREE.Vector3(...END_POSE.position);
  const endLook = new THREE.Vector3(...END_POSE.lookAt);
  const endDelta = endLook.clone().sub(endPos);
  const endYaw = Math.atan2(endDelta.x, -endDelta.z);
  const endPitch = Math.atan2(endDelta.y, Math.hypot(endDelta.x, endDelta.z));
  const endD = endDelta.length();

  const frameAt = (s) => {
    const base = cameraPosition(s);
    const decay = 1 - smooth(0, fadeWidth, s);

    // Yaw: aim at the centreline LOOK_AHEAD_M ahead (the path is a tight S, aiming at its tangent
    // would whip the view about). A signpost within about 5 m and still ahead of us draws the gaze a
    // little toward it (half the angle, at most SIGN_GLANCE_MAX). The weight is driven by distance
    // and by how far the board is off the view axis, not by the path station, so it fades by itself
    // as the sign comes abeam (looking back over the shoulder would break the walk).
    const ahead = pathAt(Math.min(1, s + LOOK_AHEAD_M / PATH_LENGTH));
    const baseYaw = bearing(base, ahead.x, ahead.z);
    let yaw = baseYaw;
    for (const sign of SIGN_POINTS) {
      const toSign = wrapPi(bearing(base, sign.x, sign.z) - baseYaw);
      const near = smooth(5, 3.2, Math.hypot(sign.x - base.x, sign.z - base.z));
      const ahead = 1 - smooth(60 * DEG, 100 * DEG, Math.abs(toSign));
      yaw += near * ahead * THREE.MathUtils.clamp(0.5 * toSign, -SIGN_GLANCE_MAX, SIGN_GLANCE_MAX);
    }

    // Pitch and the cabin glance.
    let pitch = BASE_PITCH(s);
    const fov = fovAt(s) + fovDelta;
    const offAxis = Math.atan(CABIN_NDC_X * Math.tan(hfovHalf(fov))); // cabin's angle right of the view axis
    for (const g of glimpses) {
      const w = glimpseWindow(g.s, s, g.fall);
      if (w <= 0) continue;
      pitch = lerp(pitch, g.peak, w);
      // Turn (either way) so the cabin ends up offAxis to the right of the view axis: a glance, off centre.
      const cabinYaw = bearing(base, TREEHOUSE_CENTER.x, TREEHOUSE_CENTER.z) - offAxis;
      yaw += w * wrapPi(cabinYaw - yaw);
    }

    // Leave the hero gaze: yaw 0 and pitch 20 degrees at s = 0, easing to the walking gaze.
    yaw = lerp(0, yaw, smooth(0, 0.14, s));
    pitch = lerp(20 * DEG, pitch, smooth(0, 0.13, s));

    // Arrive: blend toward the end pose's view of the trunk steps.
    const arrive = smooth(0.89, S_END, s);
    yaw = lerp(yaw, endYaw, arrive);
    pitch = lerp(pitch, endPitch, arrive);
    const distance = lerp(lerp(D_HERO, D_WALK, smooth(0, 0.2, s)), endD, arrive);

    const cosPitch = Math.cos(pitch);
    const dir = new THREE.Vector3(Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
    return {
      position: base.clone().addScaledVector(offsetPos, decay),
      lookAt: base.clone().addScaledVector(dir, distance).addScaledVector(offsetTarget, decay),
      roll: weaveRollDeg(s),
      fov: fovAt(s),
    };
  };

  const frames = [heroKeyframe(aspect)];
  for (let i = 1; i < KEY_COUNT; i++) frames.push(frameAt((S_END * i) / (KEY_COUNT - 1)));
  // The last keyframe is END_POSE exactly (the loop above lands on it to within a millimetre).
  frames[KEY_COUNT - 1] = { position: [...END_POSE.position], lookAt: [...END_POSE.lookAt], roll: END_POSE.roll, fov: END_POSE.fov };
  return frames;
}

// ----- pace: speed along the walk ------------------------------------------------------------------------
// Relative speed (1 = nominal) as a function of s. Time per distance is 1 / speed, so slow stretches
// take more scroll. Movement starts at progress 0 at 0.6x (never a standing start, so the first 5
// percent of scroll already walks about 0.4 m) and eases up to full pace over the first 8 percent
// of the path. At each signpost the speed falls to SIGN_SPEED: the slow-down starts SIGN_LEAD_M
// before the sign, holds the minimum from 0.5 m before it to 0.1 m after, and is gone 0.9 m after.
// A gentle ease at the end brings the speed down to END_SPEED as we arrive at the trunk.
const START_SPEED = 0.6;
const SIGN_SPEED = 0.45;
const SIGN_LEAD_M = 1.5;
const END_SPEED = 0.3;

export function approachSpeed(s) {
  let v = lerp(START_SPEED, 1, smooth(0, 0.08, s));
  v *= lerp(END_SPEED, 1, smooth(S_END, S_END - 0.1, s));
  for (const sign of SIGNS) {
    const c = sign.s;
    const w =
      smooth(c - SIGN_LEAD_M / PATH_LENGTH, c - 0.5 / PATH_LENGTH, s) *
      (1 - smooth(c + 0.1 / PATH_LENGTH, c + 0.9 / PATH_LENGTH, s));
    v *= 1 - (1 - SIGN_SPEED) * w;
  }
  return v;
}

// Section pace: local scroll 0..1 -> walk fraction q 0..1 (s = q * S_END).
const approachPace = makePace((q) => approachSpeed(q * S_END));

// ----- depth of field focus ----------------------------------------------------------------------------------
// Rack focus. At progress 0 the focus is the hero's (the cabin, 16 m away, so the frame is identical);
// it pulls to the midground 6 m ahead over the first 12 percent of the section, holds there (foreground
// leaves under 2.5 m and the far mist stay soft), then moves to the steps as we arrive (about 3 m).
const FOCUS_MIDGROUND = 6;
const _focusCabin = new THREE.Vector3();
function approachFocus(local, pose) {
  const toCabin = Math.max(4, _focusCabin.copy(TREEHOUSE_CENTER).sub(pose.position).length()); // the hero value
  let focus = lerp(toCabin, FOCUS_MIDGROUND, smooth(0, 0.12, local));
  const toSteps = THREE.MathUtils.clamp(pose.position.distanceTo(pose.target), 3, 12);
  focus = lerp(focus, toSteps, smooth(0.8, 1, local));
  return focus;
}

// ----- the section entry ----------------------------------------------------------------------------------------
// The scene code is a separate chunk (lazy), loaded in the background after the hero is up, so it never
// delays the first frame or ships in the server render.
const loadScene = () => import("@/components/canvas/approach/ApproachScene");
const Scene = lazy(() => loadScene().then((m) => ({ default: m.World })));
const Controllers = lazy(() => loadScene().then((m) => ({ default: m.Controllers })));

const approach = {
  id: "approach",
  length: SCROLL_LENGTH_VH,
  camera: { keyframes: buildApproachKeyframes, pace: approachPace, focus: approachFocus },
  Scene, // the world (path, flora, trunks, signs...): mounted inside <RevealGroup>
  Controllers, // non visual (light ramp): mounted outside <RevealGroup>
  overlay: ApproachOverlay,
  reveal: true,
  mountDelayFrames: 90, // pre-mount (invisible, prewarmed) about 1.5 s after the hero starts rendering
};

export default approach;
