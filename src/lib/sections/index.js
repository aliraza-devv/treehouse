import hero from "@/lib/sections/hero";
import approach from "@/lib/sections/approach";
import { checkKeyframeContinuity } from "@/lib/sections/cameraPath";

// ===========================================================================================
// THE SECTIONS CONFIG
//
// SECTIONS is the page in order. To add a section: write src/lib/sections/<id>.js (config), write
// its scene file, and add ONE line below. Nothing else changes: start and end progress are derived
// from the lengths here, so no other entry is ever edited. See src/lib/sections/README.md.
//
// Entry shape (the config files default export it):
//   id                 unique string
//   length             scroll length in viewport heights (0 = anchor that only holds a pose)
//   camera             { keyframes, pace, focus? }
//                        keyframes  array or (aspect) => array of { position, lookAt, roll, fov }
//                        pace       (local 0..1) => q 0..1 (null = linear)
//                        focus      optional (local, pose) => depth of field focus distance in metres
//   Scene              React component for the world (or null), mounted by <SectionsHost />
//   Controllers        optional component for non visual drivers (light, fog), never revealed
//   overlay            React component for the HTML copy (or null), mounted by the page
//   reveal             true = wrap Scene in <RevealGroup> (invisible at progress 0, dissolves in)
//   mountDelayFrames   optional: do not pre-mount before this many frames have rendered
// ===========================================================================================

export const SECTIONS = [hero, approach];

// Derive each entry's global start and end progress from the lengths. A total of zero (only anchors)
// is guarded so nothing divides by it.
export function buildTimeline(sections) {
  const totalLength = sections.reduce((sum, section) => sum + section.length, 0);
  const safeTotal = totalLength > 0 ? totalLength : 1;
  let walked = 0;
  const entries = sections.map((section, index) => {
    const start = walked / safeTotal;
    walked += section.length;
    return { ...section, index, start, end: walked / safeTotal };
  });
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  return { entries, byId, totalLength };
}

export const TIMELINE = buildTimeline(SECTIONS);

// Total scroll travel in viewport heights (sum of the section lengths).
export const TOTAL_LENGTH_VH = TIMELINE.totalLength;
// Height of the page's scroll runway in viewport heights. The fixed stage fills one viewport and the
// document can only scroll by (height - viewport), so the runway is one viewport taller than the
// scroll travel: the section lengths are scroll distances, exactly.
export const RUNWAY_VH = TOTAL_LENGTH_VH + 1;

export function getSection(id) {
  return TIMELINE.byId[id] ?? null;
}

// Development only: the END_POSE continuity rule (a section starts where the previous one ended).
if (process.env.NODE_ENV === "development") {
  checkKeyframeContinuity(TIMELINE.entries);
}
