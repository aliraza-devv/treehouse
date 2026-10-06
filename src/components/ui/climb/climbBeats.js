// Copy beats for Section 2 (The Climb). All timings are SECTION-LOCAL progress (0..1), i.e.
// scrollState.sections.climb, so the words are locked to the camera.
//
// A beat is visible (opacity > 0) from `enter` to `exit`:
//   enter -> peakStart   fade and drift in
//   peakStart -> peakEnd fully shown (the hold)
//   peakEnd -> exit      fade and drift out
// `exit: null` holds until the end of the section.
//
// Each stage has its own `group` key (stage1..stage4). ClimbOverlay anchors every stage group at the same
// bottom-left spot, so one stage's copy replaces the last one in place instead of stacking.
//
// Roles: heading and subline (both set in stageType.js, shared with the hero). Every stage is the same shape: a
// two line heading and a subline. `lines` fixes where a heading breaks; `accent` is the one word or phrase set in
// the warm colour.
//
// Timing: a fade is only about 0.035 of the section and the hold is about 0.18, so at almost any scroll position the
// words are fully on screen, not mid-fade. A stage fades out as the next one fades in, in the same slot.
//
// Copy comes only from the owner brief and the hero stats (docs/section-2/hero-brief.md): 20+ years,
// 250+ projects, 5 continents, award-winning, bespoke builds for private gardens, estates, resorts and
// schools, and the childhood, family and nature brand idea. No client names, no unverified claims.
// Straight apostrophes throughout, no em or en dashes.
export const CLIMB_BEATS = [
  // Stage 1: who they are (the scroll starts on the ladder foot)
  {
    id: "climb-1-heading",
    role: "heading",
    group: "stage1",
    side: "left",
    lines: ["Twenty years", "in the trees."],
    accent: "trees.",
    enter: 0.03,
    peakStart: 0.07,
    peakEnd: 0.25,
    exit: 0.285,
    drift: 32,
    scrim: 1,
  },
  {
    id: "climb-1-subline",
    role: "subline",
    group: "stage1",
    side: "left",
    text: "Award-winning treehouse, rope bridge and treetop walkway builders.",
    enter: 0.045,
    peakStart: 0.085,
    peakEnd: 0.25,
    exit: 0.285,
    drift: 20,
    scrim: 1,
  },
  // Stage 2: scale and reach
  {
    id: "climb-2-heading",
    role: "heading",
    group: "stage2",
    side: "left",
    lines: ["250+ projects", "5 continents."],
    accent: "250+",
    enter: 0.265,
    peakStart: 0.3,
    peakEnd: 0.51,
    exit: 0.545,
    drift: 32,
    scrim: 1,
  },
  {
    id: "climb-2-subline",
    role: "subline",
    group: "stage2",
    side: "left",
    text: "Each one designed and built by one dedicated team.",
    enter: 0.28,
    peakStart: 0.315,
    peakEnd: 0.51,
    exit: 0.545,
    drift: 20,
    scrim: 1,
  },
  // Stage 3: the luxury, bespoke work
  {
    id: "climb-3-heading",
    role: "heading",
    group: "stage3",
    side: "left",
    lines: ["Bespoke, for", "every setting."],
    accent: "Bespoke,",
    enter: 0.525,
    peakStart: 0.56,
    peakEnd: 0.755,
    exit: 0.79,
    drift: 32,
    scrim: 1,
  },
  {
    id: "climb-3-subline",
    role: "subline",
    group: "stage3",
    side: "left",
    text: "Private gardens, estates, resorts and schools, each one shaped around its tree.",
    enter: 0.54,
    peakStart: 0.575,
    peakEnd: 0.755,
    exit: 0.79,
    drift: 20,
    scrim: 1,
  },
  // Stage 4: the feeling they build for (holds to the end of the climb)
  {
    id: "climb-4-heading",
    role: "heading",
    group: "stage4",
    side: "left",
    lines: ["Childhood wonder,", "family memories."],
    accent: "family memories.",
    enter: 0.77,
    peakStart: 0.805,
    peakEnd: 1,
    exit: null,
    drift: 32,
    scrim: 1,
  },
  {
    id: "climb-4-subline",
    role: "subline",
    group: "stage4",
    side: "left",
    text: "Treehouses, rope bridges and treetop walkways, built around a closer connection to nature.",
    enter: 0.785,
    peakStart: 0.82,
    peakEnd: 1,
    exit: null,
    drift: 20,
    scrim: 1,
  },
];
