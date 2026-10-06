import * as THREE from "three";
import { heroKeyframe } from "@/lib/sections/hero";
import { TREEHOUSE_CENTER } from "@/lib/sections/world";
import ClimbOverlay from "@/components/ui/climb/ClimbOverlay";

// Depth of field: focus on the ladder while the camera climbs, then rack onto the cabin on the deck.
// Without this the Climb inherited the hero focus (13 m), which left the cabin soft at the end.
const LADDER_MID = new THREE.Vector3(1.45, 4.6, 5.2); // midway up the ladder (Treehouse.jsx, buildLadder)
const _toLadder = new THREE.Vector3();
const _toCabin = new THREE.Vector3();
function climbFocus(local, pose) {
  const toLadder = _toLadder.copy(LADDER_MID).distanceTo(pose.position);
  const toCabin = _toCabin.copy(TREEHOUSE_CENTER).distanceTo(pose.position);
  // hand over from ladder to cabin between local 0.4 and 0.6 (the camera reaches the deck around 0.85)
  const t = THREE.MathUtils.smoothstep(local, 0.4, 0.6);
  return THREE.MathUtils.lerp(toLadder, toCabin, t);
}

// ===========================================================================================
// SECTION 2: THE CLIMB
//
// The camera leaves the hero frame, walks to the foot of the timber ladder on the lawn, climbs it
// (the ladder is in the Treehouse model, Treehouse.jsx buildLadder), and comes onto the deck at the
// front of the cabin. Coordinates are WORLD metres. The treehouse group sits at TREE (x 2.2, z 0):
//   deck       world x 0.3 .. 6.5, z -1.6 .. 3.2, floor about 8.8 m up
//   ladder     top at the deck front edge (about 1.25, 8.8, 3.3), foot on the lawn (about 1.55, 0.35, 4.5)
// Each keyframe is a point on that route. The first one is the hero pose, the end of the hero anchor.
// ===========================================================================================

const climb = {
  id: "climb",
  length: 2, // viewport heights of scroll: the whole climb fits in two scrolls
  camera: {
    // A function of aspect: the hero pose depends on the viewport (portrait phones are dollied back), so the
    // first keyframe must be the hero keyframe for THIS aspect, or the camera jumps at the start of the climb.
    keyframes: (aspect) => [
      heroKeyframe(aspect), // start exactly where the hero camera is (continuity rule)
      // walking in toward the foot of the ladder
      { position: [1.6, 1.4, 11.5], lookAt: [1.5, 2.5, 7.0], roll: 0, fov: 50 },
      // at the foot, looking up the ladder
      { position: [2.2, 2.6, 9.4], lookAt: [1.5, 3.5, 6.8], roll: 0, fov: 50 },
      // halfway up: the camera sits in front of the ladder so the rungs read
      { position: [3.0, 4.8, 8.4], lookAt: [1.45, 4.6, 5.2], roll: 0, fov: 50 },
      // near the top
      { position: [2.9, 7.2, 7.4], lookAt: [1.3, 7.8, 3.6], roll: 0, fov: 50 },
      // stepping onto the deck
      { position: [2.4, 9.4, 5.2], lookAt: [1.4, 9.6, 2.2], roll: 0, fov: 50 },
      // final view: the LEFT front of the deck, facing diagonally across to the cabin. The hero trunk
      // (x 2.2, z 0) stands between the cabin and any pose straight to the left, so the camera sits forward
      // (z 6.8) and the line of sight passes in front of the trunk, not through it. Eye height is just above
      // the deck rail, looking up so the whole house fills the frame.
      { position: [-1.5, 10.0, 6.8], lookAt: [4.2, 11.4, -0.2], roll: 0, fov: 50 },
    ],
    pace: null, // linear; the keyframes already spread the climb evenly
    focus: climbFocus,
  },
  Scene: null, // the hero scene stays mounted and the camera simply travels through it
  Controllers: null,
  overlay: ClimbOverlay,
  reveal: false,
};

export default climb;
