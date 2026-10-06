# HANDOFF: Section 2 "The Approach" (read this first)

Everything in this doc is already live on `main` / production (treehouse-tau-brown.vercel.app). The owner's
rule is: push only to `main`, no feature branches, and only states where `npm run build` and `npx eslint src`
pass (every push to `main` deploys to production on Vercel).

Owner request: `docs/section-2/brief.md` (authoritative). Hero background: `docs/section-2/hero-brief.md`.

## State of play
Section 1 (the hero) and Section 2 ("The Approach", the woodland walk from the forest floor up to the trunk
steps) are both built, built-and-linted clean, and pushed. Commits (newest first): `7f49b96` (review-finding
fixes), `c4d8a96` (the four remaining world pieces: trunks, signposts/props/steps, light/air, glimpses).

| Piece | Files | Status |
|---|---|---|
| Shared contracts | `src/lib/scroll/scrollStore.js`, `src/lib/sections/world.js`, `src/lib/sections/reveal.js` | DONE |
| Scroll driver, camera rig, page wiring | `src/lib/scroll/driver.js`, `cameraState.js`, `src/lib/sections/{index,hero,approach,cameraPath}.js`, `src/components/canvas/{SectionsHost,ScrollCameraRig}.jsx`, `src/app/page.js` | DONE |
| Overlay copy, hero fade | `src/components/ui/{HeroFade,ScrollOverlay,ScrollDriver,ScrollRuntime}.jsx`, `approach/{ApproachOverlay.jsx,beats.js}` | DONE |
| Path, stepping stones, roots, litter | `approach/PathAndGround.jsx` + `path*.js` | DONE |
| Ferns, ground cover, mossy log, mushrooms | `approach/UnderstoryFlora.jsx` + `flora*.js` | DONE |
| Trunks (4 close, 18 mid, 18 far), bark, moss, ivy, canopy | `approach/Trunks.jsx` + `trunk*.js` | DONE |
| Signposts, story props, trunk steps | `approach/{Signposts,StoryProps,TrunkSteps}.jsx` + `prop*.js` | DONE |
| Light ramp, dappled shadows, shafts, dust | `approach/AirAndLight.jsx` (+ named export `LightRamp`) + `air*.js` | DONE |
| Treehouse glimpses | `approach/TreehouseGlimpse.jsx` + `glimpse*.js` | DONE |
| Hero triangle-budget culling | `approach/HeroCull.jsx` | DONE |
| Integration, 4-lens review, fixes | | DONE (one round; see "Known gaps" below) |

## Architecture in one minute
- `scrollState` (mutable, `src/lib/scroll/scrollStore.js`): `progress` (global 0..1, damped), `sections[id]`
  (local), `look.exposure/focusDistance` overrides read by PostProcessing. Read it inside `useFrame` or rAF,
  never React state.
- Sections: `src/lib/sections/index.js` lists entries; each has `length` (viewport heights); start/end are
  derived. **To add a new section**: write one config file (like `approach.js`) with keyframes and a
  `length`, one scene component, add one line to the array in `index.js`. See `src/lib/sections/README.md`
  for the full contract.
- Camera: one global CatmullRom through all sections' keyframes. `ScrollCameraRig.jsx` short-circuits to the
  original, unmodified hero code path when `progress <= 1e-6` (`HERO_EPS`), so pixel identity at progress 0
  is a hard guarantee. Idle sway (0.02 units / 0.005 rad, `useIdle.js`) is applied on top unconditionally.
- **`END_POSE` is exported from `src/lib/sections/approach.js`** — the final camera pose at the trunk steps,
  used as the seed for whatever section comes next.
- World layout: `src/lib/sections/world.js` is the single source of truth for the path, trunks, signs, props,
  glimpse schedule (`GLIMPSES`), light ramp (`LIGHT_RAMP`), `END_POSE_SEED`.
- Reveal: every Section 2 object lives in `<RevealGroup>` and materials go through `makeRevealable()`
  (`src/lib/sections/reveal.js`), dissolving in over the first 4.5% of scroll.
- Hero triangle budget: `HeroCull.jsx` hides hero-only dressing (foreground/falling leaves, far tree line,
  background trees, the hero's own ground cover and rope ladder) via an opacity cross-fade once the walker
  is past local progress 0.10 to 0.14, since those are redundant with Section 2's own corridor dressing.
  `DevTools.jsx`'s `window.__heroStats.visibleTriangles` is the frustum-culled (not raw scene) count the 50k
  budget actually polices; verified 18,661 to 45,024 across 13 points along the walk.

## Known gaps (left for a follow-up pass, not silently skipped)
- Section 2's own trunk/crown `InstancedMesh` groups (mid/far trunks, crowns) still lack the distance culling
  their own code comments promise — a chunk-by-spatial-region job, bigger than a tuning fix.
- Surrey and Seychelles signposts were spot-checked but not exhaustively render-proven legible (Lake Como and
  Quebec had a proven, now-fixed conflict with the glimpse camera pull; the fix should also help these two,
  but wasn't re-screenshotted under the project's new "no screenshots unless asked" rule).
  A possible bridge-like silhouette near one glimpse frame was checked against the geometry (confirmed no
  bridge/walkway exists in code) but not re-rendered close up.
- 60fps / real GPU frame-time could not be measured this session (SwiftShader software rendering only, which
  is minutes per frame, not representative of real hardware).

## Known gotchas
- `r3f-perf` crashes the Next 16 Turbopack dev server: not imported anywhere, leave it that way.
- Dev-only hooks (`window.__scrub`, `__cam`, `__heroStats`, `__stepsStats`, etc.) are gated on `NODE_ENV` and
  must not reach production bundles.
- Treehouse geometry tension: the cabin is at y 8.8 to 12.5; the end pose is close to the trunk looking at
  the steps, so the cabin leaves the frame there by design. Glimpses peak (~70% visible) around local 0.75
  to 0.88.
- No em or en dashes in any copy or text. Brand palette only through `PALETTE`/`BRAND`
  (`src/lib/sceneConfig.js`) and the `brand-*` Tailwind tokens. Everything procedural, no model/image files.
- Vercel auto-builds every push to `main` as production. Push only build+lint-clean states.
- Per CLAUDE.md's efficiency rules: don't re-read known files, don't print full build/install output (errors
  only), don't run screenshots/headless browser checks unless asked, batch edits, reuse `src/lib/world`.
