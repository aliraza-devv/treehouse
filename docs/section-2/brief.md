# SECTION 2 REQUEST (verbatim from the owner)

Build Section 2: THE APPROACH for the Treehouse Life site.

BEFORE WRITING ANY CODE
1. Read CLAUDE.md, AGENTS.md and the existing Section 1 (hero) code. Reuse its palette, fog, particles, postprocessing, camera sway and file conventions. Do not restyle or rewrite the hero. Some hero improvements may still be in progress, so touch shared files only for minimal wiring.
2. Work on a new branch from the latest main (section-2-approach). Put new code in new files and wire it in with the smallest possible change.
3. Check whether a scroll-driven camera system already exists. If it does not, building it is part of this task (see next block).

BUILD THE SCROLL AND CAMERA RIG FIRST (every later section depends on it)
- One page-level scroll driven by Lenis, producing a single global progress value from 0 to 1, smoothed with damping.
- A sections config array. Each entry has an id, a start and end progress, and a camera keyframe path. Adding a new section later must mean adding one config entry and one scene file, nothing else.
- Camera path built from keyframes (position, look-at target, roll, FOV) interpolated with smooth curves such as CatmullRomCurve3. No linear jumps.
- The hero's idle sway stays active on top of the scroll movement.
- Overlay text is driven by the same progress value so copy and camera never drift apart.
- At progress 0 the camera must sit exactly at the hero pose, so there is no jump when scrolling begins.

WHAT THIS SECTION IS
The camera leaves the forest floor and walks toward the tree through the woodland. It introduces Treehouse Life and builds credibility without ever stopping the experience. Movement must begin within the first 5% of scroll so the user never feels they are scrolling past a static background. The treehouse is only glimpsed through gaps in the foliage here, never shown in full. Curiosity turns into intent. The light moves from cool misty morning toward brighter daylight.

THE BIG RULE: NOTHING GENERIC
Generic means: a flat green ground, evenly scattered identical ferns, trunks as plain cylinders, one flat directional light, an empty background, and objects that look script-placed. Avoid all of it. This should look like a real British woodland that someone has walked through for twenty years.

REQUIRED SPECIFIC DETAILS
- A worn dirt path that winds toward the tree, lighter in the center, with a few stepping stones set into it. The camera follows it with a gentle S-curve weave.
- Fern clusters in at least 3 size and shape variants, each leaning in a different direction, instanced. Leaf litter, a moss-covered fallen log, exposed roots, 2 or 3 mushroom clusters, patches of ivy on trunks.
- Mid-ground trunks with bark ridges, moss on the north side, and a few broken low branches. At least 2 trunks pass close to the camera for a moment of strong parallax as it weaves between them.
- Hand-carved wooden signposts along the path, weathered and slightly leaning. Each one is a credibility beat that reads in the world, not a UI card. Carve these place names: "Surrey", "Lake Como", "Quebec", "Seychelles". They come from real Treehouse Life projects.
- One quiet story prop per stretch of path: a child's wellington boot at the base of a trunk, a coil of hemp rope on a stump, a small hand-painted arrow nailed to a tree.
- Treehouse glimpses: it appears and disappears between trunks and leaves as the camera moves, growing from partly hidden to mostly visible by the end, but the bridge and walkway stay out of view.
- Light: dappled moving shadows on the ground and trunks. 3 or 4 soft light shafts catching floating dust. Fog thins as we advance and color temperature warms slightly. Never a single flat light.
- Depth: always three layers. Blurred foreground leaves passing close, in-focus midground, atmospheric background fading into mist. Never an empty background.

CAMERA
- Walking pace at about eye level, rising slightly toward the end. Subtle footstep bob, very small. Slight roll on the weaves.
- Ease the speed so the camera slows slightly at each signpost, then moves on.
- End pose: close to the base of the main trunk, looking at the first wooden steps and roots, tilted up a few degrees. The Climb section will continue from this exact pose. Export it as END_POSE with position, look-at, roll and FOV.

BEATS (by scroll progress through this section)
- 0.00 to 0.25: leave the hero pose, enter the path, first fern and trunk parallax
- 0.25 to 0.60: signposts, woodland detail, first clear glimpse of the treehouse
- 0.60 to 1.00: the trunk grows in the frame, light brightens, arrive at the base and the first steps

OVERLAY COPY (same typography as the hero, no cards, no glass boxes, no em dashes)
- Hero text fades and drifts up during the first 10% of scroll.
- Heading, appears around 0.30: "Twenty years in the trees."
- Subline: "The UK's most awarded treehouse builder, from Surrey gardens to Seychelles resorts."
- Small proof line near the end, around 0.85: "Treehouses, rope bridges and treetop walkways, designed and built by one dedicated team."
- Place text on the side away from the tree so it never covers the scene.

PERFORMANCE
Under 50k triangles visible at once. Instance ferns, leaves, stones and mushrooms. No new heavy postprocessing. Target a smooth 60fps.

SELF-REVIEW BEFORE PUSHING
1. If you can run a headless browser (Playwright) here, take screenshots at 0, 25, 50, 75 and 100 percent progress and critique each honestly. If you cannot, say so.
2. Check the result against the "nothing generic" list. Find at least 5 things that still look generic and fix them.
3. Confirm there is no visible jump between the hero and the start of this section.
4. Run npm run build, commit, and push the branch. Do not merge.
5. In your final message, list what you built, the 5 things you fixed, how to add a new section to the rig, and where END_POSE is exported.

# PROJECT NOTES ADDED BY THE LEAD (not from the owner)
- Interpretation: "progress 0 to 1" is the page-wide progress over all registered sections. Each section config has a scroll `length` (in viewport heights); start and end are DERIVED from the lengths so adding a section never means editing other entries. "Section progress" in the beats above is the section-local 0..1.
- Known geometric tension: the treehouse deck is at y 8.8 to 11 and the end pose is about 3 m from the trunk looking at the steps. From there the cabin is above the frame. So the glimpses peak (about 70 percent visible, camera tilted up through gaps) around local 0.75 to 0.88 and the cabin leaves the frame as the camera drops its gaze to the steps.
- Hero look at progress 0 must stay pixel-identical: all Section 2 world objects live in <RevealGroup> (src/lib/sections/reveal.js) and use makeRevealable on every material.
- Visual direction stays the owner's updated one: grounded cinematic realism, procedural only, brand palette via PALETTE/BRAND in src/lib/sceneConfig.js.
