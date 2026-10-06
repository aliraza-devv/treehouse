// Stacking order for the hero. Always use these values (inline style zIndex), never ad hoc numbers.
// Tailwind cannot generate arbitrary z-index from a JS constant, so components apply them via style.
export const LAYERS = {
  scene: 0, // the WebGL canvas and its static fallback
  journey: 5, // Section 3 (the page after the climb): scrolls OVER the fixed stage, under the navbar
  scrim: 10, // soft deep-forest gradients that keep text legible over bright mist
  content: 20, // hero heading, subline, stats, scroll cue
  dim: 25, // inside the stage: fades the stage to forest while Section 3's canopy rises over it
  nav: 30, // fixed navbar
  menu: 40, // mobile menu overlay and its toggle (always above the nav)
  skip: 50, // skip-to-content link while focused
  loader: 60, // the loader covers everything (even the skip link) until the page is ready
};
