# Treehouse Life - 3D Immersive Landing Page

## Project overview
A 3D immersive, scroll-driven landing page for Treehouse Life (treehouselife.com), a luxury UK treehouse design and building company. Built with Next.js, React Three Fiber, and GSAP. The site is a continuous camera journey called "From Forest Floor to Canopy."

## Tech stack
- Next.js 14+ (App Router, TypeScript)
- React Three Fiber (@react-three/fiber)
- Drei (@react-three/drei)
- @react-three/postprocessing
- GSAP with ScrollTrigger
- Lenis (smooth scrolling)
- Tailwind CSS (UI overlay)
- TypeScript (strict)

## Efficiency rules
- Do not re-read files you already know. Read only the files the task touches.
- Do not print full build or install output. Show errors only.
- No screenshots or headless browser runs unless I ask.
- Batch related edits into one pass.
- Reuse the shared kit in src/lib/world instead of rewriting materials or helpers.

## Architecture
- `src/app/` - Next.js App Router pages and layout
- `src/components/canvas/` - All R3F 3D scene components
- `src/components/ui/` - HTML overlay components (navbar, text, CTA)
- `src/lib/` - Lenis init, GSAP registration, utilities
- `src/hooks/` - Custom React hooks

## Code standards
- Use TypeScript for everything. No `any` types.
- Components are functional with hooks. No class components.
- R3F components go in `components/canvas/`. HTML overlay components go in `components/ui/`.
- Use Tailwind for styling HTML elements. No separate CSS files except globals.css.
- Keep 3D scene components focused: one component per visual concern (tree, atmosphere, postprocessing, etc).
- All 3D models are procedural (built from Three.js geometry). Do NOT use external model files or placeholder images.
- Keep total triangle count under 50k per scene section.
- Use instancing for repeated elements (trees, particles).
- No OrbitControls or debug helpers in production code.
- Prefer `MeshStandardMaterial` over `MeshBasicMaterial` for anything that should respond to light.
- Comment non-obvious math (camera positions, geometry construction, animation timing).

## Color palette (official brand colours, owner supplied)
- Primary green #6F9D68, light green (sage) #B6D4A5, deep forest #18251C, moss #66745A
- Warm timber #8A633F, dark timber #49372A
- Warm cream #F1EEE4, soft stone #D8D5C9, charcoal #1C211D
- Warm light (lanterns, sunset accent) #D89A52
- UI: page background deep forest, text warm cream, accents primary green and warm light. Use the Tailwind tokens `brand-*` from globals.css, never hard-coded hexes. Scene: `BRAND` and `PALETTE` in `src/lib/sceneConfig.js` (leaves = greens, bark = dark timber, wood = warm timber, floor = deep forest and moss). Fog, sky and cool ambient light stay a cool misty blue-gray because the brand has no equivalent.

## Visual direction
- Style: grounded cinematic realism. A believable misty English woodland at dawn with a real, beautifully crafted luxury treehouse. NOT low-poly, NOT flat-shaded, NOT cartoonish, NOT game-asset. (Updated at the owner's request after the stylized first pass read as generic.)
- Everything stays procedural: realism comes from runtime-generated PBR textures (canvas + noise), organic geometry, alpha-cut foliage cards, image-based lighting from a procedural sky, and a photographic post stack. No external models or image files.
- Reference feel: nature-documentary opening shot, award-winning web (mont-fort.com, pasqua.it).
- Film grain, depth of field, vignette on every scene.
- Cool morning mist atmosphere with warm sun shafts, transitioning to warm golden hour later in the journey.
- Typography: serif display font (Cormorant Garamond) for headings, sans-serif (Inter or system) for UI.
- No em dashes in any copy or content.

## Dev server
```bash
npm run dev
```
Runs on http://localhost:3000

## Build
```bash
npm run build
```

