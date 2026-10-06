// One type structure for every piece of copy that sits on the 3D stage: the hero and the four climb stages. They share
// the same left edge, the same bottom edge, the same line height and the same subline, so the words read as one
// system as the camera moves and only the words change. Edit the numbers here, not in the components.
//
//   left edge      px-6 / md:px-8 / lg:px-16 (the navbar logo sits on the same line)
//   bottom edge    3.5rem above the bottom of the screen (the hero's last row and each stage's subline end there)
//   headings       two short, balanced lines (the hero is the same shape, one size up)
//   block width    the block is exactly as wide as its widest heading line (STAGE_BLOCK); the subline (and, in the
//                  hero, the numbers) are stretched to that width, so the block has a clean right edge
export const STAGE_PAD_X = "px-6 md:px-8 lg:px-16";
export const STAGE_BOTTOM = "bottom-14";

// The block: as wide as its widest line, never narrower than 34rem, never wider than the screen.
export const STAGE_BLOCK = "w-fit max-w-full min-w-[min(34rem,100%)]";

export const HERO_HEADING =
  "text-shadow-big font-display text-[clamp(3rem,6.4vw,8rem)] leading-[0.96] tracking-normal text-brand-cream max-md:text-[clamp(2.6rem,12.4vw,4.2rem)]";

export const STAGE_HEADING =
  "text-shadow-big font-display text-[clamp(2.8rem,5.8vw,7rem)] leading-[0.98] tracking-normal text-brand-cream max-md:text-[clamp(2.1rem,9.4vw,3.4rem)]";

// w-0 min-w-full: the line adds nothing to the block's width (so it cannot widen it) and then fills it.
export const SUBLINE =
  "text-shadow-logo mt-8 w-0 min-w-full text-[clamp(1.15rem,1.6vw,1.45rem)] font-medium leading-snug text-pretty text-brand-cream";
