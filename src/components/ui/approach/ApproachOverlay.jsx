"use client";

import ScrollOverlay from "@/components/ui/ScrollOverlay";
import { APPROACH_BEATS } from "@/components/ui/approach/beats";

// Section 2 copy. Typography is the hero's: Cormorant Garamond (font-display) for the heading and
// subline, Inter (the body sans) for the small proof line, warm cream brand tokens, hero text shadows.
// No cards, no glass, no backgrounds. The tree sits right of centre in the frame throughout, so the
// copy lives at the LEFT, in the lower middle, with the hero's left gutter.
//
// Layout notes
//  - `fixed inset-0`: the overlay is a viewport-sized layer regardless of how tall the scroll runway is.
//  - Group "main" (heading + subline) starts about 54 percent down and stacks naturally, so the line
//    under the heading never shifts: hidden beats keep their space.
//  - Group "proof" sits near the bottom-left, small and quiet.
//  - Below md (portrait phones) both groups become a centred block, max 22rem, at the bottom, clear of
//    the nav at the top.
const ROLE_CLASSES = {
  heading:
    "text-shadow-hero max-w-[26rem] font-display text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[1.15] tracking-[-0.01em] text-balance text-brand-cream max-md:mx-auto max-md:text-center",
  subline:
    "text-shadow-logo mt-4 max-w-[24rem] font-display text-[clamp(1.125rem,1.7vw,1.5rem)] font-medium leading-snug text-pretty text-brand-cream/80 max-md:mx-auto max-md:text-center",
  proof:
    "text-shadow-logo max-w-[24rem] text-[13px] leading-relaxed tracking-[0.01em] text-pretty text-brand-cream/60 max-md:mx-auto max-md:text-center",
};

const GROUP_CLASSES = {
  main: "absolute inset-x-0 top-[54%] px-6 md:px-8 lg:px-16 max-md:top-auto max-md:bottom-28 max-md:mx-auto max-md:max-w-[22rem]",
  proof: "absolute inset-x-0 bottom-12 px-6 md:px-8 lg:px-16 max-md:bottom-14 max-md:mx-auto max-md:max-w-[22rem]",
};

// Very soft deep-forest radial scrim (about 45 percent at its core, fading to nothing), built from the
// brand token so there is no hard-coded colour. Anchored behind the left-hand copy; centred low on phones.
const SCRIM_CLASS =
  "bg-[radial-gradient(ellipse_55%_46%_at_12%_70%,color-mix(in_srgb,var(--color-brand-forest)_45%,transparent),transparent_72%)] max-md:bg-[radial-gradient(ellipse_95%_42%_at_50%_86%,color-mix(in_srgb,var(--color-brand-forest)_45%,transparent),transparent_74%)]";

export default function ApproachOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0">
      <ScrollOverlay
        beats={APPROACH_BEATS}
        sectionId="approach"
        roleClassNames={ROLE_CLASSES}
        groupClassNames={GROUP_CLASSES}
        scrim={{ className: SCRIM_CLASS }}
      />
    </div>
  );
}
