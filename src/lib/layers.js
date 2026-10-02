// Stacking order for the hero. Always use these values (inline style zIndex), never ad hoc numbers.
// Tailwind cannot generate arbitrary z-index from a JS constant, so components apply them via style.
export const LAYERS = {
  scene: 0, // the WebGL canvas and its static fallback
  scrim: 10, // soft deep-forest gradients that keep text legible over bright mist
  content: 20, // hero heading, subline, stats, scroll cue
  nav: 30, // fixed navbar
  menu: 40, // mobile menu overlay and its toggle (always above the nav)
};
