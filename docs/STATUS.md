# Treehouse Life: project status

Read this instead of exploring the codebase. Last updated 2026-10-06, branch `main`.

## Sections built
- **Hero** (`src/lib/sections/hero.js`, `src/components/canvas/HeroScene.jsx`, `src/components/ui/HeroContent.jsx`, `HeroFade.jsx`). Holds the opening pose, `HERO_POSE`.
- **Section 2, The Approach** (`src/lib/sections/approach.js`, `world.js`, `src/components/canvas/approach/*`, `src/components/ui/approach/ApproachOverlay.jsx`). Woodland walk, 7 vh, ends at `END_POSE`.
- Shared forest and treehouse scene: `Tree.jsx`, `Treehouse.jsx`, `ForestEnvironment.jsx`, `Atmosphere.jsx`, `ForegroundLeaves.jsx`.

## Scroll and camera rig
- One scroll value drives everything: Lenis, `ScrollDriver` (damped), then `scrollState.progress` (`src/lib/scroll/scrollStore.js`).
- `src/lib/sections/index.js` holds `SECTIONS = [hero, approach]` and builds the timeline. `RUNWAY_VH` sets the page height.
- `cameraPath.js` merges every section's keyframes into one curve. `ScrollCameraRig` writes `cameraState`, and `useIdle` adds sway.
- **Add a section:** (1) write `src/lib/sections/<id>.js`, (2) write its scene under `src/components/canvas/<id>/`, (3) add it to `SECTIONS`. The first keyframe must equal the previous section's `END_POSE`.

## END_POSE exports
- `src/lib/sections/approach.js`: `export const END_POSE` (Section 2 end, Climb's start pose).
- `src/lib/sections/hero.js`: `export const HERO_POSE` (hero pose). `heroKeyframe(aspect)` is also exported.
- `src/lib/sections/world.js`: `END_POSE_SEED` (seed values only, not the final pose).

## Shared helpers (src/lib)
- `sections/cameraPath.js`: `buildCameraPath`, `resolveKeyframes`, `makePace`, `smooth`, `lerp`, `clamp01`.
- `sections/reveal.js`: `RevealGroup`, `makeRevealable`, `revealAmount`.
- `sections/world.js`: path helpers (`pathAt`, `atPath`, `onPath`), tree and prop layout constants.
- `scroll/driver.js`: `stepScroll`, `updateSections`, `sectionToGlobal`.
- `foliageMaterial.js`: `makeFoliageMaterial`, `buildLeafClusterGeometry`.
- `lenis.js`: `initLenis`, `stopScroll`, `startScroll`. `gsap.js`: `afterFontsReady`, `delayFromLoad`.
- `hooks/useReducedMotion.js`, `hooks/useIdle.js` (`CameraRig`).

## Known issues and TODOs
- Section 2 trunk and crown `InstancedMesh` groups lack the distance culling their comments promise (see HANDOFF.md "Known gaps").
- Surrey and Seychelles signposts are not render-verified for legibility.
- Real GPU frame time is unmeasured (60fps target unconfirmed).
- `docs/section-2/` holds the brief and builder specs. Fonts use `next/font/google` (Cormorant Garamond, Inter).
- Climb section is not started. Add it with the three-step recipe above.
