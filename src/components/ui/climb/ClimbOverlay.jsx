"use client";

import ScrollOverlay from "@/components/ui/ScrollOverlay";
import { LAYERS } from "@/lib/layers";
import { CLIMB_BEATS } from "@/components/ui/climb/climbBeats";
import { STAGE_BLOCK, STAGE_BOTTOM, STAGE_HEADING, STAGE_PAD_X, SUBLINE } from "@/components/ui/stageType";

// Section 2 copy (The Climb). Every stage is the same shape (a two line heading and a subline) in the same
// bottom-left slot, set with the hero's type structure (stageType.js), so the copy changes in place and the left and
// bottom edges never move. Each block is exactly as wide as its heading, and the subline fills that width.
// The slot sits left of the ladder, which is right of centre.
const ROLE_CLASSES = {
  heading: STAGE_HEADING,
  subline: SUBLINE,
};

const STAGE_CLASS = `absolute left-0 ${STAGE_BOTTOM} ${STAGE_BLOCK} ${STAGE_PAD_X}`;
const GROUP_CLASSES = {
  stage1: STAGE_CLASS,
  stage2: STAGE_CLASS,
  stage3: STAGE_CLASS,
  stage4: STAGE_CLASS,
};

// A deep-forest scrim behind the copy, built from the brand token (no hard-coded colour). It is local: a soft ellipse
// behind the bottom-left block that fades to nothing well before the middle of the screen, so it lifts the words
// without darkening the whole scene. The words themselves are never faded (see ScrollOverlay), so nothing sits
// between the reader and the type. On phones the block spans the width, so the lift runs from the bottom.
const SCRIM_CLASS =
  "bg-[radial-gradient(ellipse_62%_58%_at_6%_100%,color-mix(in_srgb,var(--color-brand-forest)_72%,transparent),transparent_74%)] max-md:bg-[linear-gradient(to_top,color-mix(in_srgb,var(--color-brand-forest)_86%,transparent)_0%,color-mix(in_srgb,var(--color-brand-forest)_50%,transparent)_44%,transparent_80%)]";

export default function ClimbOverlay() {
  // The container needs its own stacking order: without one it paints below every z-indexed scrim in the stage
  // (the hero's), which sat over the climb words like a veil.
  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: LAYERS.content }}>
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
