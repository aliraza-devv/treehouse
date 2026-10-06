# Sections: the scroll and camera rig

The whole page is one continuous camera journey, driven by ONE scroll value.

```
window.scrollY --(Lenis, or native scroll)--> ScrollDriver (gsap ticker, damped) --> scrollState
scrollState.progress (0..1, global)
   |-- ScrollCameraRig  evaluates the global camera path  --> cameraState --> useIdle (+ handheld sway)
   |-- SectionsHost     mounts each section's 3D scene while the page is near it
   |-- overlays         HeroFade, ApproachOverlay... read scrollState in their own frame loops
   `-- post / light     scrollState.look.focusDistance and .exposure (PostProcessing reads them)
```

Camera and copy never drift apart because they read the same `scrollState.progress`.

## Files

| File | Job |
| --- | --- |
| `src/lib/scroll/scrollStore.js` | The one shared mutable state (`progress`, `velocity`, `sections[id]`, `activeId`, `look`, `override`). |
| `src/lib/scroll/driver.js` | Pure logic: critically damped smoothing, section progress, `sectionToGlobal`. |
| `src/lib/scroll/cameraState.js` | The camera pose of this frame, before sway. Written by the rig, read by `useIdle`. |
| `src/components/ui/ScrollDriver.jsx` | `<ScrollDriver />`, `<ScrollRunway />`, `<SectionOverlays />` (lazy loaders, see the file). Implementation in `ScrollRuntime.jsx`. |
| `src/lib/sections/index.js` | `SECTIONS` (page order), the timeline builder, `RUNWAY_VH`. |
| `src/lib/sections/<id>.js` | One config per section: length, camera keyframes, pace, scene, overlay. |
| `src/lib/sections/cameraPath.js` | Builds the ONE global camera curve from every section's keyframes. |
| `src/lib/sections/reveal.js` | `RevealGroup` and `makeRevealable` (dissolve in from the hero, prewarm). |
| `src/lib/sections/world.js` | The Approach's world layout contract (path, trunks, signs...). |
| `src/components/canvas/SectionsHost.jsx` | Mounts section scenes inside the Canvas. |
| `src/components/canvas/ScrollCameraRig.jsx` | Evaluates the path each frame, footstep bob, focus distance. |

## How progress maps to sections

Each section has a `length` in viewport heights (the scroll distance it occupies). The timeline builder
turns the lengths into `start` and `end` global progress, so adding a section never edits another entry:

```
hero      length 0   start 0     end 0       (anchor: holds the hero pose)
approach  length 7   start 0     end 1
```

Add `climb` with length 5 and the same builder gives approach `0 .. 0.583` and climb `0.583 .. 1`.
`scrollState.sections[id]` is the local 0..1 progress of each section; `scrollState.activeId` is the one
that owns the camera. The page's scroll runway is `RUNWAY_VH` = total length + 1 viewport tall (the fixed
stage fills one viewport and the document scrolls by its height minus the viewport, so lengths are exact
scroll distances).

## Adding a section

It is always exactly three things:

1. **One config file** `src/lib/sections/<id>.js` (length, camera, scene, overlay).
2. **One scene file** (a React component under `src/components/canvas/<id>/`).
3. **One line** in the `SECTIONS` array in `src/lib/sections/index.js`.

Nothing else changes: not the page, not the camera rig, not the host, not another section's entry.

### Example: a `climb` section

`src/lib/sections/climb.js`

```js
import { lazy } from "react";
import { END_POSE } from "@/lib/sections/approach";
import ClimbOverlay from "@/components/ui/climb/ClimbOverlay";

const Scene = lazy(() => import("@/components/canvas/climb/ClimbScene")); // default export, no props

const climb = {
  id: "climb",
  length: 5, // viewport heights of scroll
  camera: {
    keyframes: [
      // The FIRST keyframe must equal the previous section's LAST one (END_POSE of the approach).
      { position: END_POSE.position, lookAt: END_POSE.lookAt, roll: END_POSE.roll, fov: END_POSE.fov },
      { position: [3.6, 3.5, 3.2], lookAt: [2.2, 5, 1.4], roll: 2, fov: 52 },
      { position: [3.7, 6.5, 1.2], lookAt: [2.2, 9, 0.5], roll: 0, fov: 55 }, // this is climb's own end pose
    ],
    pace: null, // null = linear; see "Pace" below
  },
  Scene, // the 3D world of this section
  Controllers: null, // optional non visual drivers (light, fog)
  overlay: ClimbOverlay, // the HTML copy; reads scrollState.sections.climb itself
  reveal: false, // true wraps Scene in <RevealGroup> (only the approach needs it: it dissolves in from the hero)
};
export default climb;
```

`src/lib/sections/index.js`

```js
import climb from "@/lib/sections/climb";
export const SECTIONS = [hero, approach, climb]; // <- the one line
```

In development the rig warns (`console.warn`) if a section's first keyframe does not equal the previous
section's last (the END_POSE rule). Without that equality the path would jump there.

## Keyframes

`camera.keyframes` is an array, or a function `(aspect) => array` when it depends on the viewport (the
approach's first keyframe is the hero pose, which depends on the aspect). Each keyframe:

```
{ position: [x, y, z], lookAt: [x, y, z], roll: degrees, fov: degrees }
```

* **roll** is positive when leaning RIGHT (the camera's top tilts toward the right shoulder).
* **fov** is the LANDSCAPE vertical FOV. The path adds the hero's portrait widening (up to +12 degrees at
  aspect 0.45) to every keyframe, so phones keep a usable view along the whole journey and the first
  keyframe still equals the hero base pose for any viewport. Do not add it yourself.
* Position and lookAt go through `THREE.CatmullRomCurve3` (centripetal), roll and fov through smooth C1
  splines, all with ONE shared parameter across every section. Tangents are therefore continuous across
  section boundaries: no linear jumps, no kinks.
* Space keyframes roughly evenly in walked distance (the approach has one every 0.28 m). The path parameter
  is the keyframe index, so evenly spaced keyframes make `pace` a plain speed profile.
* An anchor section (`length: 0`, like `hero`) contributes its keyframes to the curve but owns no scroll.

## Pace

`camera.pace(local)` maps the section's local scroll 0..1 to `q` in 0..1, the fraction of the section's
keyframe range already walked. `null` means linear. For a speed profile use `makePace(speedAt)` from
`cameraPath.js`: `speedAt(q)` is the relative speed (1 = nominal); time per distance is `1 / speed`, so slow
stretches take more scroll. The approach uses it for a standing-start-free beginning (0.6x), a slow-down to
0.45x at each signpost and a gentle ease to 0.3x at the end.

Optional `camera.focus(local, pose)` returns the depth of field focus distance in metres (the rig writes it to
`scrollState.look.focusDistance`, PostProcessing reads it). Omit it to leave the hero focus behaviour.

## Mounting and the hero identity

`SectionsHost` mounts a section's `Scene` when progress is within 0.06 of its range (unmounts beyond 0.14),
or `mountDelayFrames` frames after start for a pre-mount (the approach: 90). React state changes only when a
threshold is crossed. `Controllers` mount alongside, outside the `RevealGroup`.

At progress 0 the approved hero frame must not change, so a section with `reveal: true` mounts inside
`<RevealGroup>`: invisible at progress 0, dissolving in (dithered discard, no alpha sorting) over the first
4.5 percent of scroll. Every material in such a scene must go through `makeRevealable(material)` once.
`RevealGroup` also prewarms shaders and textures while still invisible (batched, one batch per frame, all
fragments discarded) and switches shadow casting on in batches once the dissolve is mostly in; the long
comment at the top of `reveal.js` explains why that is sound for the main and shadow passes.

At progress 0 `cameraState.active` is false, so `useIdle` runs its original hero code path untouched.

## The camera at runtime

`ScrollCameraRig` (useFrame priority -1, before `useIdle` at 0 and the post stack at 1) evaluates the path,
adds the footstep bob (0.012 m vertical, 0.006 m lateral counter sway, one step per 0.75 m of distance walked,
scaled by speed so it vanishes at rest, off for reduced motion) and writes `cameraState`. `useIdle` uses it as
the base pose and keeps its handheld sway on top (same amplitudes as the hero).

## Development helpers (absent from production bundles)

```js
window.__scrub(0.5);            // pin global progress, no damping (null releases)
window.__sectionToGlobal("approach", 0.25); // local -> global progress
window.__cam();                 // { position, lookAt, roll, fov, progress, activeId } of the final camera
```

`window.__scrub(window.__sectionToGlobal("approach", 0.25))` is the usual way to screenshot a beat.

## Tuning knobs for the approach (top of `approach.js`)

`SCROLL_LENGTH_VH`, `S_END`, `WEAVE_AMPLITUDE` / `WEAVE_WAVELENGTH` / `ROLL_MAX_DEG`, `RISE_END_S`, `FOV_END`,
`END_LOOK_AT`, `LOOK_AHEAD_M`, `SIGN_GLANCE_MAX`, the glimpse window constants, `CABIN_NDC_X` / `CABIN_NDC_Y`,
`START_SPEED` / `SIGN_SPEED` / `SIGN_LEAD_M` / `END_SPEED`, `FOCUS_MIDGROUND`. Rig: `STEP_LENGTH`, `BOB_*`
in `ScrollCameraRig.jsx`. Driver: `SMOOTH_TAU` in `driver.js`. Reveal: `REVEAL_END` and the prewarm constants
in `reveal.js`.

## Section 3: page content after the runway

Not every section is a camera section. Section 3 (`src/components/ui/journey/`) is ordinary page content that
follows `<ScrollRunway />` in `page.js`, so its text, links and anchors are real document content.

- `readMaxScroll` (`driver.js`) measures the runway, not the document, so camera progress reaches 1 where the
  runway ends and holds while the page keeps scrolling. `Journey` has a 30dvh top margin: that is the beat the
  last camera frame is held for before the canopy curtain rises.
- The transition (`CanopyCurtain.jsx`) is one scrubbed GSAP timeline: three canopy layers lag the page by
  different amounts (parallax), while the fixed stage (`[data-stage]`) pushes in and fades to forest
  (`[data-stage-dim]`).
- `Scene.jsx` stops rendering the canvas (`frameloop="never"`) once `[data-journey-body]` is at the top of the
  viewport, and resumes on scroll back.
- ScrollTriggers are measured before the lazy runway mounts, so `Journey` calls `ScrollTrigger.refresh()` once
  `[data-runway]` exists and again after fonts load.
- Every animation sits behind `gsap.matchMedia`; reduced motion shows the final state, phones stack the
  audience panels instead of pinning.
