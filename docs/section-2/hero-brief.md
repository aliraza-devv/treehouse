# Treehouse Life — Hero Section Build Prompt (verbatim from the user)

## APPROVED DEVIATIONS (user decisions, override anything below)
- The project is JavaScript. Use `.jsx` / `.js` files, never `.tsx` / `.ts`. Ignore TypeScript wording.
- Use the Tailwind version already installed (v4, CSS-first config, no tailwind.config file).
- Next.js is 16.3.8 (breaking changes vs older versions; docs in node_modules/next/dist/docs). React 19.2, R3F v9, drei v10, @react-three/postprocessing v3.
- No em dashes in any copy or content (CLAUDE.md rule).
- Already installed: @react-three/fiber, drei, postprocessing, gsap, lenis, three, r3f-perf (dev dep).

## LATEST USER DIRECTION (overrides the brief wherever it conflicts, including every "stylized / not photorealistic / storybook / Firewatch / Ghibli" line)
The user reviewed the first stylized pass and said: "The 3D model and scene look very cartoon-like, generic, and typical. Please improve the scene and make it realistic."
So the target look is now GROUNDED CINEMATIC REALISM: a believable misty morning in an English woodland, photographed with a wide-aperture lens, with a real, beautifully built luxury treehouse. NOT low-poly, NOT flat-shaded, NOT faceted blobs, NOT cartoonish, NOT game-asset. Physically plausible materials (PBR roughness/normal/AO variation, imperfection, weathering, moss, grain direction), scale and proportion, organic irregularity (no perfect symmetry, no repeating patterns visible), believable light (image based ambient light from a procedural sky, warm sun shafts through mist, soft contact shadows), and photographic lensing (depth of field, subtle bloom/halation, grain, vignette, filmic tone mapping).
The HARD RULE that stays: everything is procedural. No external model files, no image files, no HDRI downloads, no CDN assets. Textures are generated at runtime in code (canvas 2D drawing + fractal noise -> albedo / normal / roughness / alpha maps), geometry is built from code. Realism comes from: smooth-shaded geometry with real normal maps and displacement, alpha-cut leaf-card foliage with painted leaf textures (thousands of cards, cheap triangles), curved tapered branch tubes, PBR materials, a PMREM environment map generated from a procedural sky, and a real post stack.
Keep total scene under 50k triangles (alpha cards are 2 triangles each, use them for density). The palette in the brief is still the base colour guidance but realistic variation (desaturated, mottled, sun-bleached, shadow-cool) around it is expected. Everything else in the brief (camera, composition, UI, copy, sway, structure of files) stays as written.
Allowed realism deviations: (a) more than 8 background trunks are allowed as a cheap far tree line in addition to the 5-8 detailed background trees; (b) extra supporting lights (fill, interior light) are fine if the single warm key light from [8,15,-5] remains the dominant sun; (c) tone mapping, SSAO/N8AO, chromatic aberration and halation can be added to the post stack.

## BRAND PALETTE OVERRIDE (owner supplied, replaces every palette hex in this brief)
| Role | Hex |
|---|---|
| Primary brand green (muted natural green) | #6F9D68 |
| Light brand green (soft leaf / sage) | #B6D4A5 |
| Deep forest (very dark green) | #18251C |
| Moss (muted secondary green) | #66745A |
| Warm timber (natural wood brown) | #8A633F |
| Dark timber (deep bark brown) | #49372A |
| Warm cream (natural off-white) | #F1EEE4 |
| Soft stone (secondary neutral) | #D8D5C9 |
| Charcoal (UI / text dark) | #1C211D |
| Warm light (lantern / sunset accent) | #D89A52 |
Rules: (1) In code import BRAND and PALETTE from src/lib/sceneConfig.js (already updated, re-read it) instead of typing hexes. (2) Scene mapping: leaves = primary green as the mid tone with light green on sunlit/backlit edges and darkened primary green / moss in shade; moss everywhere (bark, roofs, rocks, ground) = #66745A; bark = dark timber #49372A with lighter ridges; treehouse wood = warm timber #8A633F (lighter sun-dried boards allowed, darker stained ones too); forest floor = deep forest #18251C with moss and litter; lanterns, windows, interior glow, string lights and the sun glow = warm light #D89A52; dust motes, god-ray highlights and the sun halo lean warm cream #F1EEE4; soft stone #D8D5C9 for stone details (chimney, rocks, hardware highlights). Realism rule: these are the BASE hues, real materials still have mottling, wear and lighting-driven variation around them, so do not paint flat swatches. (3) Fog, sky and cool ambient light have no brand equivalent: keep the cool misty blue-gray from the brief. (4) UI: page background deep forest #18251C, text warm cream #F1EEE4 (instead of pure white; secondary text = cream at the opacities the brief gives for white), dark overlays use deep forest/charcoal instead of black, accents use primary green #6F9D68 and warm light #D89A52, CTA hover fills use brand green. Use Tailwind tokens text-brand-cream, bg-brand-forest, etc. (defined in globals.css @theme), no hard-coded hexes in components.

## Project context

I am building a 3D immersive landing page for a luxury treehouse design and building company called **Treehouse Life** (treehouselife.com). They design and build bespoke treehouses, rope bridges, treetop walkways and nest swings for private gardens, estates, resorts and schools. Their brand is about childhood wonder, imagination, family memories and reconnecting with nature. Celebrity clients include Gary Barlow and Elton John. They are UK-based, operating internationally.

This is a spec/concept rebuild of their website. The full site will be a single continuous scroll-driven 3D camera journey called "From Forest Floor to Canopy" with 9 sections. Right now I only want to build **Section 1: the hero**.

Reference site I previously built: https://ford-website-fawn.vercel.app/
Inspiration sites from Awwwards: mont-fort.com, pasqua.it, timeless.club/en

---

## Tech stack

- **Next.js 14+** (App Router)
- **React Three Fiber** (@react-three/fiber)
- **Drei** (@react-three/drei) for helpers (Environment, Float, MeshTransmissionMaterial, etc.)
- **@react-three/postprocessing** for atmosphere (god rays, bloom, depth of field, vignette, noise)
- **GSAP** with ScrollTrigger (for later scroll-driven animation, wire it up now but hero is viewport-locked, no scroll yet)
- **Lenis** for smooth scrolling (initialize it globally even though hero is full viewport)
- **TypeScript** (OVERRIDDEN: use JavaScript)
- **Tailwind CSS** for the UI overlay (navbar, text)

Initialize a clean Next.js project with all these dependencies. Use `src/` directory structure.

---

## What the hero section should look and feel like

### Camera and composition

- The camera sits LOW on the forest floor, roughly at ground level or slightly below eye height, angled upward at roughly 15-20 degrees toward the canopy.
- The treehouse is visible in the upper portion of the frame, partially obscured by foreground leaves and branches. It should feel like a discovery, not a product showcase. The user should think: "what is that up there?"
- The treehouse should be roughly 60-70% visible. Tree trunk, branches, and leaf clusters in the foreground block parts of it naturally.
- The camera has a very subtle idle drift/sway (think handheld documentary feel, not a locked tripod). Amplitude should be tiny: maybe 0.02 units of position oscillation and 0.005 radians of rotation oscillation on a slow sine wave (6-8 second period). This makes the scene feel alive without being distracting.
- Field of view: around 50-55 (cinematic, not fisheye).

### The treehouse (built procedurally with Three.js geometry)

Do NOT load an external 3D model. Build the treehouse from Three.js primitives and basic geometries:

- **Main tree:** A thick central trunk using a tapered CylinderGeometry (wider at base, narrower at top). Add 2-3 major branches using smaller cylinders angled outward from the upper trunk. Use a warm brown wood material (not a flat color — use MeshStandardMaterial with roughness ~0.85, a subtle normal perturbation if possible, and a warm brown baseColor like #5C3A1E or #6B4226).
- **The treehouse structure:** Sits where the main branches fork, roughly 65-75% up the visible trunk height. Build it from:
  - A rectangular platform (flattened box geometry) resting on the branch fork
  - Walls: 3-4 thin box geometries forming a simple cabin shape with one open side (the side facing camera should have an opening like a window or doorway to hint at interior)
  - A peaked roof: two angled planes forming an A-frame or a simple pyramid on top
  - Railings: thin cylinder or box geometries around the platform edge
  - A rope ladder or wooden step ladder hanging down from the platform (a few small box steps connected by thin cylinders)
  - Use the same wood material family but slightly lighter/warmer for the structure vs the tree bark
- **Style direction:** This should NOT look photorealistic. It should feel slightly stylized, like a beautiful architectural model or a Firewatch/Ghibli-inspired scene. Clean geometry, warm materials, not trying to fake photorealism. Think "premium storybook" not "Unreal Engine demo."

### The forest environment

- **Ground plane:** A large plane with a dark earthy green/brown color. Can add subtle vertex displacement for gentle undulation. Not flat.
- **Foreground elements (important for depth):**
  - 2-3 large leaf/fern shapes very close to the camera (screen-space large, slightly blurred by depth of field). These can be simple double-sided plane geometries with leaf-shaped vertices or alpha-cutout textures generated procedurally. Place them at the edges and bottom of the frame.
  - 1-2 thin branch/twig silhouettes crossing the upper corners of the frame
- **Background trees:** 5-8 additional simpler tree shapes (just trunks + rough sphere/ellipsoid canopy clusters) placed behind and around the main tree at varying distances. These should be darker/more muted (atmospheric perspective — fade toward a misty blue-gray at distance).
- **Mist/fog:** Use THREE.FogExp2 with a soft density. Color should be a cool morning mist tone: desaturated blue-gray like #B8C4CC or #A0ADB8. The fog should be thick enough that background trees at 30+ units are significantly faded but the main treehouse at ~15-20 units is clearly visible.

### Atmosphere and lighting

This is what makes it feel premium vs generic. Spend time here:

- **Lighting mood:** Cool misty morning. The light source is warm but the environment scatters it into a cool ambient. Think early morning forest with sun rays breaking through gaps in the canopy.
- **Key light:** A single DirectionalLight coming from upper-right-back (position roughly [8, 15, -5]), warm white color (#FFF5E6), intensity ~1.5. This creates the "sun breaking through" feeling and casts long shadows on the trunk.
- **Ambient:** A cool-toned AmbientLight (#8BA4B8) at low intensity (~0.3) to fill the shadows without flattening them.
- **God rays / volumetric light:** Use postprocessing GodRays effect if available, or fake it with 2-3 semi-transparent angled plane geometries with a soft white-to-transparent gradient, placed in the scene where sunlight would "beam" through gaps between branches. These should be subtle and slightly animated (very slow opacity oscillation).
- **Particles:** Floating dust/pollen motes in the air. Use drei's Sparkles or a custom Points geometry with ~80-120 small particles drifting slowly upward and laterally. Color: warm white/gold (#FFF8E7), size: tiny (0.02-0.04 units), speed: very slow random drift. These sell the "morning forest" feeling.
- **Postprocessing stack** (in this order):
  1. Depth of Field (bokeh): Focus on the treehouse distance. Near foreground leaves should be slightly soft. Background trees very soft. This is what makes foreground leaves feel cinematic.
  2. Bloom: Very subtle, threshold high (~0.85), intensity low (~0.15). Only the brightest light rays and particles should catch it.
  3. Vignette: Gentle darkening at edges. Offset ~0.3, darkness ~0.6.
  4. Noise/grain: Very subtle film grain. Opacity ~0.06-0.08. This kills the CG-clean look instantly.
  5. Color correction if available: Very slight warm tint in highlights, cool tint in shadows (orange-teal color grade).

### Motion and life (non-scroll, idle state)

The hero is full-viewport, no scrolling yet. But it should not feel static:

- Camera idle sway (described above)
- Particles drifting
- 1-2 leaves occasionally falling slowly (use Float from drei on a couple of leaf geometries with random rotation)
- The god ray planes very slowly oscillating in opacity (0.08 to 0.15 range, 10-second period)
- If possible: a very subtle wind effect where some foreground leaf planes gently rotate back and forth (small amplitude oscillation, different periods so they do not sync up)

---

## UI overlay (HTML on top of the 3D canvas)

### Navbar

- Position: fixed, top, full width
- Background: fully transparent (no background, no blur, no glass effect)
- Layout: Logo left, nav links center, CTA button right
- Logo: Text-based for now. "Treehouse Life" in a clean serif font. Color: white (#FFFFFF) with a very subtle text-shadow for legibility against the 3D scene. Font: use a Google Font — either "Cormorant Garamond" or "Playfair Display" at 500 weight.
- Nav links: "About", "Products", "Projects", "Commercial", "Reviews". Font: clean sans-serif (system or "Inter"). Size: 14px, weight 400, color: rgba(255,255,255,0.8), letter-spacing: 0.5px. Hover: color transitions to full white.
- CTA button: "Start Project" — small pill-shaped button. Border: 1px solid rgba(255,255,255,0.4). Background: transparent. Color: white. Hover: background fades to rgba(255,255,255,0.1). Border-radius: 9999px. Padding: 8px 20px. Font size: 13px, weight 500.
- The entire navbar should have a subtle top-to-bottom gradient overlay behind it (a div with background: linear-gradient(to bottom, rgba(0,0,0,0.3), transparent), height ~120px, pointer-events none) to ensure text is always readable regardless of what the 3D scene shows behind it.

### Hero text content

- Positioned in the lower-left area of the viewport (not centered — asymmetric editorial placement)
- Main heading: "Some memories are built, not bought." — large display serif font (same family as logo). Size: clamp(2.5rem, 5vw, 4rem). Color: white. Max-width: 550px. Line height: 1.15. A very subtle text-shadow (0 2px 20px rgba(0,0,0,0.4)).
- Subline: "Award-winning treehouse, rope bridge & treetop walkway builders." — smaller sans-serif. Size: 15px, weight 400, color: rgba(255,255,255,0.7). Margin-top: 16px.
- Small stats row below the subline (margin-top: 32px). Three items inline: "250+ Projects" · "20+ Years" · "5 Continents". Font: 13px sans-serif, color: rgba(255,255,255,0.5). Separated by a dot or thin vertical line.
- All text should animate in on page load: fade up with a slight Y translation (20px), staggered. Heading first (delay 0.8s, duration 1s), subline next (delay 1.1s), stats last (delay 1.4s). Use CSS transitions or GSAP, not framer-motion.

### Scroll indicator

- Bottom center of viewport
- A thin vertical line (1px wide, 40px tall, white at 0.4 opacity) with a small dot or chevron that animates downward in a loop (CSS keyframe, 2s duration, ease-in-out)
- Below it: "Scroll to explore" in 11px uppercase sans-serif, letter-spacing 2px, color rgba(255,255,255,0.35)
- This entire element should fade in after 2.5s delay

---

## File/folder structure (adapt extensions: .tsx -> .jsx, .ts -> .js)

```
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  components/
    canvas/
      Scene.tsx          — main R3F Canvas wrapper
      HeroScene.tsx      — the 3D scene (tree, treehouse, forest, particles, lighting)
      Treehouse.tsx      — the procedural treehouse + tree model
      ForestEnvironment.tsx — ground, background trees, foreground leaves
      Atmosphere.tsx     — particles, god rays, fog setup
      PostProcessing.tsx — the postprocessing stack
    ui/
      Navbar.tsx
      HeroContent.tsx    — heading, subline, stats
      ScrollIndicator.tsx
  lib/
    lenis.ts             — Lenis initialization
    gsap.ts              — GSAP + ScrollTrigger registration
  hooks/
    useIdle.ts           — camera idle sway logic
```

---

## Important build rules

1. **Do NOT use placeholder images or external textures.** Everything should be procedural — colors, materials, geometry. No broken image links.
2. **Performance matters.** Keep total triangle count under 50k for the hero scene. Use instancing for repeated elements (background trees, particles). Profile with r3f-perf in dev mode.
3. **Do NOT make it look like a default Three.js demo.** No grid helpers, no orbit controls, no debug UI in production. The camera is fixed (with idle sway). The user cannot rotate or zoom.
4. **Color palette to follow:**
   - Tree bark: #5C3A1E to #6B4226
   - Treehouse wood: #8B6914 to #A67C3B
   - Leaves/canopy: #2D5016 to #4A7A2E with some #6B8F3A highlights
   - Forest floor: #1A2E0F to #2B3D1A
   - Fog/mist: #A0ADB8 to #B8C4CC
   - Sky (visible through canopy gaps): #C5D5E0 to #E0E8EE
   - UI text: white family as specified above
5. **The treehouse should feel magical, slightly elevated, worthy of aspiration.** It should make someone want to build one. Not a game asset, not a cartoon, not photorealistic. Premium, warm, handcrafted.
6. **Test on a dark background.** If the fog or sky looks wrong against the page, fix it.
7. **Mobile:** For now, make the hero section responsive (full viewport on mobile too), but do not worry about mobile 3D performance optimization yet. We will handle that in a later phase.
8. **No scroll animation in this phase.** The hero is one locked full-screen viewport. Scroll-driven camera movement comes in the next phase. But wire up Lenis and GSAP ScrollTrigger so they are ready.

---

## What "done" looks like

When I open the browser I should see:

- A full-viewport 3D forest scene with a treehouse partially visible through mist and foliage above me
- Cool morning atmosphere with warm light breaking through
- Floating particles, subtle camera sway, gentle leaf movement
- A clean transparent navbar with the Treehouse Life logo, nav links, and a "Start Project" button
- An editorial heading in the lower-left: "Some memories are built, not bought."
- A scroll indicator pulsing at the bottom center
- Film grain and depth of field making it feel cinematic, not CG
- The whole thing should feel like the opening shot of a nature documentary, not a Three.js tutorial

Build the entire hero section now. Start with project setup and dependencies, then the 3D scene, then the UI overlay, then polish (postprocessing, animations, motion).
