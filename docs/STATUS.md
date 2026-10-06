# Treehouse Life: project status

Read this instead of exploring the codebase. Last updated 2026-10-07, branch `main` (uncommitted work on top).

## Sections built
- **Hero** (`src/lib/sections/hero.js`, `HeroScene.jsx`, `HeroContent.jsx`). Garden scene: lawn, fence, hedge, shrubs, picnic table, a child (`ChildOnLawn.jsx`, CC-BY, credited in the page and in Section 3's footer).
- **Section 2, The Climb** (`src/lib/sections/climb.js`, `src/components/ui/climb/*`). 2 vh. Camera walks to the ladder, climbs, ends on the deck. Four copy stages. Own depth-of-field focus (`climbFocus`).
- **Section 3, The Journey** (`src/components/ui/journey/*`, copy and constants in `src/lib/site.js`, photos in `src/lib/journeyImages.js` and `public/images/journey`). Ordinary page content after the runway, NOT a camera section. Dome canopy transition over the stage (domes with gradient-faded tops, no hard edge; CanopyCurtain.jsx), photo collage statement, build-journal process (polaroids, vine, hand-drawn marks), pinned horizontal rope-bridge walkway (Audience.jsx: four project frames hang from a timber beam on ropes, swing with scroll speed, end with a sign carrying the Start Project button; uses the `pinned:` variant from globals.css), one framed proof card (photo, drawn Surrey-to-Seychelles route, count-up stats strip) and a row of gold laurel award badges (`Awards.jsx`), the one marquee, then a slim credits footer (the closing CTA section was removed at the owner's request; the navbar Start Project button goes to ENQUIRY_HREF). Anchors: #about, #products, #projects.
- Old Approach walk (`approach.js`, `canvas/approach/*`) is kept but not in `SECTIONS`.

## Type and scroll feel
- Fonts: Fraunces variable (headings, opsz 144, weight 800, SOFT 55, WONK 1, set in globals.css; closest free match to the owner's Briston and Clara references; Briston is a paid font), Figtree (body and UI), Caveat (Section 3 margin notes). Hero and Section 2 headings are set big (up to about 9rem) with one warm word.
- Scroll: Lenis in lerp mode (`src/lib/lenis.js`, lerp 0.09, smooth anchors), driven by the gsap ticker; the scroll driver adds only a short damper (`SMOOTH_TAU` 0.12) and GSAP scrubs use `scrub: true`, so smoothing is not stacked. The 3D scene steps its quality tier down when it cannot hold about 45 fps (`QualityGovernor` in `Scene.jsx`, tiers in `PostProcessing.jsx`).

## Scroll and camera rig
- One scroll value: Lenis, `ScrollDriver` (damped), `scrollState.progress`. `readMaxScroll` (`src/lib/scroll/driver.js`) measures the RUNWAY only, so progress hits 1 where the runway ends and Section 3 scrolls over the fixed stage.
- `src/lib/sections/index.js`: `SECTIONS = [hero, climb]`. `cameraPath.js` merges keyframes. First keyframe of a section must equal the previous END pose (`heroKeyframe(aspect)` for the first).
- Add a camera section: config in `src/lib/sections/<id>.js`, scene under `src/components/canvas/<id>/`, one line in `SECTIONS`.
- Section 3 hooks into the stage: `data-stage` and `data-stage-dim` (page.js) are animated by `CanopyCurtain.jsx`. `Scene.jsx` sets `frameloop="never"` once `[data-journey-body]` reaches the viewport top.

## END_POSE exports
- `hero.js`: `HERO_POSE`, `heroKeyframe(aspect)`. Climb ends at its last keyframe (deck, left front, facing the cabin). `approach.js` still exports `END_POSE`.

## Shared helpers (src/lib)
- `sections/cameraPath.js`, `sections/reveal.js`, `sections/world.js` (path, trunks, `TREEHOUSE_CENTER`), `scroll/driver.js`, `foliageMaterial.js`, `lenis.js`, `gsap.js` (`afterFontsReady`), `layers.js` (z scale), `site.js` (Section 3 copy, `ENQUIRY_HREF`).

## Known issues and TODOs
- **Set `ENQUIRY_HREF` in `src/lib/site.js`** (currently the site root). All "Start Project" buttons use it.
- **Section 3 photos are free Pexels stock stand-ins** (ids in `public/images/journey/CREDITS.txt`). Replace with real Treehouse Life project photography: same file names, 800 and 1600 px webp, nothing else changes. Photo credit is in the Section 3 footer.
- **Awards** (`AWARDS` in `site.js`) are the four wins listed on treehouselife.com (2021 and 2022). Owner to confirm titles and years and add newer ones. No awarding body logos are used.
- Section 3 copy is draft: it only uses brief facts (250+ projects, 20+ years, 5 continents, real project places). Owner to approve wording, product lists per audience, and add real testimonials (#reviews has no target).
- Dev scene is over the 50k triangle budget (about 58k visible): garden additions plus the child. Trim fence, hedge, shrubs, or the foliage.
- Child model has no animation (static, procedural hop only). CLAUDE.md says "no external models"; the owner supplied this one.
- Pinned audience track: keyboard focus cannot reach offscreen panels (they have no links). Add links only with a focus-to-scroll handler.
- Real GPU frame time is unmeasured. The browser pane renders the scene very slowly, and cannot screenshot position-fixed content after a scroll.
