# HANDOFF: Section 2 "The Approach" (read this first)

Branch: `section-2-approach` (from `main` at 83cb6d2). **Do not merge it.** Push to this branch only.
Owner request: `docs/section-2/brief.md` (authoritative). Hero background: `docs/section-2/hero-brief.md`.
Per-agent build specs (very detailed, reuse them): `docs/section-2/builder-specs.txt` (a workflow script kept as text; replace `<SCRATCH>` with a temp folder).

## State of play
`main` already ships the hero (realistic procedural 3D scene + overlay UI + brand palette, PR #2). Section 2 was being built by 8 parallel authors; the cloud session ran out of credits mid-way.

| Piece | Files | Status |
|---|---|---|
| Shared contracts (lead) | `src/lib/scroll/scrollStore.js`, `src/lib/sections/world.js`, `src/lib/sections/reveal.js` | DONE, lint clean |
| Scroll driver, sections config, camera path, rig, host, page wiring | `src/lib/scroll/driver.js`, `cameraState.js`, `src/lib/sections/index.js`, `hero.js`, `approach.js` (exports `END_POSE`), `cameraPath.js`, `README.md`, `src/components/canvas/SectionsHost.jsx`, `ScrollCameraRig.jsx`, `approach/ApproachScene.jsx`, `src/components/ui/ScrollDriver.jsx`, `ScrollRuntime.jsx`, `src/app/page.js`, minimal edits to `useIdle.js`, `HeroScene.jsx`, `PostProcessing.jsx` | WRITTEN, lint clean, numerically checked in node only. NEVER built or rendered. |
| Overlay copy and hero fade | `src/components/ui/HeroFade.jsx`, `ScrollOverlay.jsx`, `approach/ApproachOverlay.jsx`, `approach/beats.js` | WRITTEN, never rendered |
| Path, stepping stones, roots, litter | `src/components/canvas/approach/PathAndGround.jsx` + `path*.js`; one-clause edit in `ForestEnvironment.jsx` `blocked()` | WRITTEN, never rendered |
| Ferns (3 variants), ground cover, mossy log, mushrooms | `approach/UnderstoryFlora.jsx` + `flora*.js` | PARTIAL (helper files exist; `UnderstoryFlora.jsx` may be missing or unfinished) |
| Trunks (4 close, 25 mid), bark, moss, broken branches, ivy, canopy dressing | `approach/Trunks.jsx` + `trunk*.js` | PARTIAL (textures and tones exist; `Trunks.jsx` may be missing) |
| Signposts (carved place names), story props, trunk steps | `approach/Signposts.jsx`, `StoryProps.jsx`, `TrunkSteps.jsx` | NOT STARTED |
| Light ramp, dappled shadows, shafts, dust | `approach/AirAndLight.jsx` (default = visible pieces, named export `LightRamp` = controller) | NOT STARTED |
| Treehouse glimpses | `approach/TreehouseGlimpse.jsx` | NOT STARTED |
| Integration, tuning, budget, review, fixes | | NOT STARTED |

`ApproachScene.jsx` imports the sibling components above; missing ones must be created before the build passes.

## Architecture in one minute
- `scrollState` (mutable, `src/lib/scroll/scrollStore.js`): `progress` (global 0..1, damped), `sections[id]` (local), `look.exposure/focusDistance` overrides read by PostProcessing. Read it inside `useFrame` or rAF, never React state.
- Sections: `src/lib/sections/index.js` lists entries; each has `length` (viewport heights of scroll); start/end are derived. Adding a section = one config file + one scene file + one line in the array (see `src/lib/sections/README.md`).
- Camera: one global CatmullRom through all sections' keyframes; keyframe 0 of the approach is the hero pose built from `getRigPose(aspect)` in `src/hooks/useIdle.js`, so progress 0 has no jump. The idle sway (0.02 units / 0.005 rad) is applied on top by `useIdle`.
- World layout: `src/lib/sections/world.js` is the single source of truth for path, trunks, signs, props, glimpse points, light ramp, `END_POSE_SEED`. The path begins under the hero camera at (0, 15) and ends near the hero trunk (tree at x 2.2, z 0).
- Reveal: every Section 2 world object lives in `<RevealGroup>` and materials go through `makeRevealable()`, so the hero frame at progress 0 is unchanged (the woodland dissolves in over the first 4.5% of scroll).
- Hero scene facts: realistic procedural scene, about 49k triangles already (cap 50k), so the integrator must cull hero parts (ForegroundLeaves, FallingLeaves, hero ground cover behind the camera) to fit the new content.

## What remains (in this order)
1. Finish `UnderstoryFlora.jsx` and `Trunks.jsx`; write the three NOT STARTED pieces (specs are in `docs/section-2/builder-specs.txt`, prompts R1 to GL).
2. `npm run build`, `npx eslint src`, fix import mismatches and runtime errors.
3. Render: `npm run dev`, then `node scripts/scrub.cjs shots/s2 --p 0,0.25,0.5,0.75,1 --section approach` (needs `npm i -D playwright` or the preinstalled one; WebGL runs on SwiftShader, slow: first frame 40 to 90 s, screenshots 20 to 150 s). Read every screenshot, fix the biggest problems first.
4. Hero identity: progress 0 must equal the shipped hero (build `origin/main` in a worktree and compare, grain and particles differ per frame so use a noise floor).
5. Budget: add `visibleTriangles` to `src/components/canvas/DevTools.jsx` (dev only, frustum culled) and keep under 50k at every progress.
6. Self-review required by the owner: screenshots at 0, 25, 50, 75, 100 percent, critique honestly, find AT LEAST 5 things that still look generic and fix them, confirm no jump between hero and section start, `npm run build`, commit, push the branch, DO NOT merge.
7. Final message must list: what was built, the 5 fixes, how to add a new section to the rig, where `END_POSE` is exported (`src/lib/sections/approach.js`).

## Known gotchas
- `r3f-perf` crashes the Next 16 Turbopack dev server: it is not imported anywhere (leave it).
- Dev-only hooks (`window.__scrub`, `__cam`, `__heroStats`) must not exist in production.
- Treehouse geometry tension: the cabin is at y 8.8 to 12.5 and the end pose is about 3 m from the trunk looking at the steps, so the cabin is above the frame there. Glimpses peak (about 70 percent visible) around local 0.75 to 0.88 and the cabin leaves the frame at the very end. Mention this to the owner.
- No em or en dashes in any copy or text. Brand palette only through `PALETTE`/`BRAND` and the `brand-*` Tailwind tokens. Everything procedural (no model or image files).
- Vercel auto-builds every branch push as a preview; production follows `main` (merge only with the owner's explicit OK).
- Agent scratch folders (`.trunktmp/`, `.claude/worktrees/`) are not part of the repo; do not commit them.
