// TUNING KNOBS for the understorey flora (UnderstoryFlora.jsx and the flora*.js helpers).
// Everything an integrator might want to change lives here. Units are metres and degrees unless noted.
// Triangle cost per element class is noted next to each count (all instanced, drawn at once).

export const FLORA_SEED = 7301; // one seed for the whole understorey: the woodland is identical on every load

// Time the build may take per rendered frame (ms). Painting and geometry run as generators that are
// pumped for at most this long each frame, so mounting never blocks the main thread for more than a
// few milliseconds at a time (whole build is spread over roughly 60 to 120 frames).
export const BUILD_BUDGET_MS = 5;

// World rectangle candidates are drawn from (the path corridor and the woodland either side of it).
export const REGION = { xMin: -14, xMax: 15, zMin: -4, zMax: 17.5 };

// Keep decor out of the hero trunk's footprint and its roots (the Climb steps live there).
export const HERO_TRUNK_KEEP_OUT = 2.45;

// ----- Ferns -----------------------------------------------------------------------------------------
// count      instances of that species placed by the clumpy density field
// variants   different cluster geometries per species (each its own InstancedMesh, so no two
//            neighbouring clumps share a silhouette)
// scale      per instance scale range (the cluster geometry is authored at scale 1)
// cost       triangles per clump (approximate, the geometry builder reports exact numbers)
// Garden pass: the woodland understorey is cut back to a few tidy border clumps so the walk reads as a
// clean family garden, not a jungle. Raise the counts again to bring the wilder look back.
export const FERNS = {
  male: { count: 4, variants: 2, scale: [0.55, 1.2], gamma: 1.5 }, //   ~52 tris per clump
  harts: { count: 3, variants: 1, scale: [0.6, 1.2], gamma: 1.6 }, //   ~42 tris per clump
  bracken: { count: 2, variants: 1, scale: [0.55, 1.1], gamma: 1.5 }, // ~36 tris per clump
  leanDeg: [4, 18], // each clump tilts away from vertical by this much, in its own random direction
  // Clumps deliberately placed at the verge whose fronds overhang the dirt (crown always stays off it).
  edge: { male: 0, harts: 0, bracken: 0 },
  overhang: 0.4, // fronds may reach this far (m) over the edge of the clear half width
  // Share of clumps that are ageing: browning, yellowing (the rest are healthy greens)
  browning: 0.07,
  yellowing: 0.12,
  // Pairs may overlap by this fraction of their combined reach (1 = touching, lower = more overlap)
  spacing: 0.62,
  // Density fades from full to this at the far edge of the corridor (so the far background thins to mist)
  farFade: [7.5, 13.5],
};

// ----- Ground cover (all beyond the path) --------------------------------------------------------------
// pathMargin used to leave a bare strip of the hero's own forest floor between the worn dirt (edge at
// PATH_WIDTH / 2 = 0.85 m) and where cover was allowed to start (1.12 m): close enough to the path that
// the walking camera weaves right over it (WEAVE_AMPLITUDE 0.4 m either side of the centreline), so that
// strip's floor texture (a 3.2 m hero tile, de-tiled only by a low frequency fbm tuned for the hero's
// static 15 m+ camera) read as an obvious repeat up close, exactly the "flat ground... script-placed"
// tell CLAUDE.md calls out. Pulling cover in to just past the already-clear path corridor
// (PATH_CLEAR_HALF_WIDTH = 0.95 m in world.js) closes most of that bare strip with moss, sedge and
// mercury instead, with a touch more of each so the extra ground is not left thin.
export const COVER = {
  moss: { count: 12, size: [0.7, 1.2] }, // flat cards, 2 tris each (lawn edge, kept low)
  ivy: { count: 0, size: [0.55, 1.15] }, // runner cards, 4 tris each (removed: reads as jungle)
  mercury: { patches: 0, perPatch: [9, 16], size: [0.55, 1.0] }, // dog's mercury, 6 tris each (removed)
  sorrel: { patches: 0, perPatch: [7, 12], size: [0.5, 0.9] }, // wood sorrel carpets, 4 tris each (removed)
  sedge: { clumps: 0, perClump: [2, 4], size: [0.8, 1.4] }, // tufts in the light gaps, 6 tris each (removed)
  bramble: { count: 0, size: [0.8, 1.3] }, // arching canes, 8 tris each (removed)
  beech: { count: 0 }, // fallen beech leaves drifted in the lee of the log, 2 tris each (removed)
  pathMargin: 0.99, // ground cover keeps at least this far (m) from the centreline
  lift: 0.034, // low cards float this high over the rendered ground (it is a coarse grid, +-3 cm off groundHeight)
};

// ----- Mushrooms (about 48 tris each) ------------------------------------------------------------------
export const MUSHROOMS = {
  honeyOnLog: 0, // extra honey fungus caps growing from the fallen log itself (removed in the garden pass)
  radial: 8, // lathe segments around the cap
};

// ----- The fallen log (FALLEN_LOG in world.js) ---------------------------------------------------------
export const LOG = {
  sides: 16, // vertices around the trunk
  stations: 26, // rings along its length
  texture: [384, 768], // albedo and normal map (around x along)
  mossCards: 62, // shaggy moss tufts on the top and shaded side (4 tris each)
  buttFlare: 0.55, // how much the root end flares (fraction of radius)
  sink: 0.2, // fraction of the trunk radius buried in the ground
  roots: 9, // roots on the upturned root plate
  stubs: 3, // broken branch stubs along the trunk
  flaps: 8, // fallen flaps of peeled bark on the ground
  ferns: 5, // small ferns growing on top (appended to the fern instances)
  ivy: 7, // ivy runners draped over the trunk
  brackets: 3, // bracket fungus shelves
  cavity: { v: 0.5, alpha: 55, length: 0.95, depth: 0.5 }, // rotted hollow: centre along (0..1), side angle (deg), length (m), depth (fraction of radius)
};

// ----- Texture sizes -----------------------------------------------------------------------------------
export const TEX = {
  male: [384, 512], // two fronds side by side
  harts: [128, 512], // sterile and fertile strap fronds
  bracken: [576, 512], // two fronds
  mercury: [256, 384],
  sorrel: [256, 256],
  sedge: [256, 512],
  ivy: [256, 512],
  bramble: [256, 512],
  moss: 256,
  beech: 256, // atlas of four leaves
  mushroom: 256,
  soil: 128,
};
