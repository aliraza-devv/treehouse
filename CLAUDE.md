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

## Color palette
- Tree bark: #5C3A1E to #6B4226
- Treehouse wood: #8B6914 to #A67C3B
- Leaves/canopy: #2D5016 to #4A7A2E, highlights #6B8F3A
- Forest floor: #1A2E0F to #2B3D1A
- Fog/mist: #A0ADB8 to #B8C4CC
- Sky: #C5D5E0 to #E0E8EE

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

