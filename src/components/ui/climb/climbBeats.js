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
// Roles: heading (the hero's size), headingM (a step down, for the longer lines), subline, proof.
// `lines` fixes where a heading breaks; `accent` is the one word or phrase set in the warm colour.
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
    peakStart: 0.09,
    peakEnd: 0.24,
    exit: 0.3,
    drift: 40,
    scrim: 1,
  },
  {
    id: "climb-1-subline",
    role: "subline",
    group: "stage1",
    side: "left",
    text: "Award-winning treehouse, rope bridge and treetop walkway builders.",
    enter: 0.07,
    peakStart: 0.13,
    peakEnd: 0.24,
    exit: 0.3,
    drift: 24,
    scrim: 1,
  },
  // Stage 2: scale and reach
  {
    id: "climb-2-heading",
    role: "heading",
    group: "stage2",
    side: "left",
    lines: ["250+ projects", "across 5 continents."],
    accent: "250+",
    enter: 0.32,
    peakStart: 0.38,
    peakEnd: 0.5,
    exit: 0.56,
    drift: 40,
    scrim: 1,
  },
  {
    id: "climb-2-subline",
    role: "subline",
    group: "stage2",
    side: "left",
    text: "Each one designed and built by one dedicated team.",
    enter: 0.36,
    peakStart: 0.42,
    peakEnd: 0.5,
    exit: 0.56,
    drift: 24,
    scrim: 1,
  },
  // Stage 3: the luxury, bespoke work
  {
    id: "climb-3-heading",
    role: "headingM",
    group: "stage3",
    side: "left",
    lines: ["Bespoke for private", "gardens, estates,", "resorts and schools."],
    accent: "Bespoke",
    enter: 0.58,
    peakStart: 0.64,
    peakEnd: 0.76,
    exit: 0.82,
    drift: 40,
    scrim: 1,
  },
  // Stage 4: the feeling they build for (holds to the end of the climb), with the small proof line
  {
    id: "climb-4-heading",
    role: "headingM",
    group: "stage4",
    side: "left",
    lines: ["Built around childhood", "wonder, family memories", "and a closer connection", "to nature."],
    accent: "family memories",
    enter: 0.84,
    peakStart: 0.9,
    peakEnd: 1,
    exit: null,
    drift: 40,
    scrim: 1,
  },
  {
    id: "climb-proof",
    role: "proof",
    group: "stage4",
    side: "left",
    text: "Treehouses, rope bridges and treetop walkways, designed and built by one dedicated team.",
    enter: 0.9,
    peakStart: 0.94,
    peakEnd: 1,
    exit: null,
    drift: 20,
    scrim: 0.6,
  },
];
