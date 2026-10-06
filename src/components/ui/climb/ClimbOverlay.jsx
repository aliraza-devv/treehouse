"use client";

import ScrollOverlay from "@/components/ui/ScrollOverlay";
import { CLIMB_BEATS } from "@/components/ui/climb/climbBeats";

// Section 2 copy (The Climb), set at the hero's scale so the words are the first thing you see: Fraunces
// (font-display, heavy) for the headings, Figtree for the lines under them, one warm word per
// stage. Every stage is anchored at the same bottom-left spot, as in the hero, so the copy changes in place and
// never fights the ladder, which sits right of centre.
const ROLE_CLASSES = {
  heading:
    "text-shadow-big font-display text-[clamp(3.1rem,7vw,8.4rem)] leading-[0.95] tracking-normal text-brand-cream max-md:text-[clamp(2.8rem,13vw,4.4rem)]",
  headingM:
    "text-shadow-big font-display text-[clamp(2.5rem,5vw,6rem)] leading-[1] tracking-normal text-brand-cream max-md:text-[clamp(2.2rem,10.5vw,3.4rem)]",
  subline:
    "text-shadow-logo mt-7 max-w-[30rem] text-[clamp(1.1rem,1.55vw,1.4rem)] font-medium leading-snug text-pretty text-brand-cream/90",
  proof:
    "text-shadow-logo mt-6 max-w-[30rem] text-[15px] leading-relaxed text-pretty text-brand-cream/85",
};

// Each stage is its own group, all at the same left-hand slot, so the copy changes in place.
const STAGE_CLASS = "absolute inset-x-0 bottom-[8%] px-6 md:px-8 lg:px-16 max-md:bottom-20";
const GROUP_CLASSES = {
  stage1: STAGE_CLASS,
  stage2: STAGE_CLASS,
  stage3: STAGE_CLASS,
  stage4: STAGE_CLASS,
};

// A deep-forest scrim behind the left-hand copy, built from the brand token (no hard-coded colour). Big type over
// bright mist needs more than the hero's: stronger at the core and wide enough for the largest stage.
const SCRIM_CLASS =
  "bg-[radial-gradient(ellipse_80%_74%_at_6%_92%,color-mix(in_srgb,var(--color-brand-forest)_84%,transparent),transparent_80%)] max-md:bg-[radial-gradient(ellipse_120%_62%_at_30%_100%,color-mix(in_srgb,var(--color-brand-forest)_86%,transparent),transparent_84%)]";

export default function ClimbOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0">
      <ScrollOverlay
        beats={CLIMB_BEATS}
        sectionId="climb"
        roleClassNames={ROLE_CLASSES}
        groupClassNames={GROUP_CLASSES}
        scrim={{ className: SCRIM_CLASS }}
      />
    </div>
  );
}
