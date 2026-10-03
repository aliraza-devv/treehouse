// The ONE shared scroll state. Mutable on purpose: it is read every frame by the camera rig, the
// scene components and the overlay text, so it must not be React state (no re-renders).
//
// Writer: the scroll driver (src/lib/scroll/*, mounted once by the page). Readers: everything else.
// Rules for readers: never write to it, read it inside useFrame / requestAnimationFrame, and never
// cache a value across frames.
export const scrollState = {
  // Raw normalised page scroll from Lenis (0 at the top, 1 at the bottom of the runway).
  target: 0,
  // THE global progress value, 0 to 1. Critically damped toward `target` so the camera glides.
  // Camera, scene effects and overlay copy all derive from this, so they can never drift apart.
  progress: 0,
  // Signed rate of change of `progress`, in progress units per second (for footstep bob, blur...).
  velocity: 0,
  // Local progress of each registered section, clamped to 0..1, keyed by section id.
  sections: {},
  // Id of the section that currently owns the camera (the one containing `progress`).
  activeId: "hero",
  // Per-frame look overrides written by the active section's light controller and read by the
  // post stack. null means "use the hero default". Writer: AirAndLight (LightRamp). Reader: PostProcessing.
  look: { exposure: null, focusDistance: null },
  // Dev scrubber: when a number, the driver pins `progress` to it (set by window.__scrub in dev).
  override: null,
};

// Local progress of one section (0 before it starts, 1 after it ends).
export function sectionProgress(id) {
  return scrollState.sections[id] ?? 0;
}
