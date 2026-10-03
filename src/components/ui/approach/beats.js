// Copy beats for Section 2 (The Approach). All timings are SECTION-LOCAL progress (0..1), i.e.
// scrollState.sections.approach, so the words are locked to the camera: they cannot drift from it.
//
// A beat is visible (opacity > 0) from `enter` to `exit`:
//   enter -> peakStart   fade and drift in
//   peakStart -> peakEnd fully shown (the hold)
//   peakEnd -> exit      fade and drift out
// `exit: null` means the beat holds until the end of the section (the overlay then fades it out
// when the next section takes the camera, see ScrollOverlay).
//
// Copy rules: exact strings from the owner brief, straight apostrophes throughout, no em or en dashes.
// `group` picks the layout slot in ApproachOverlay, `side` the side of the frame the copy sits on
// (the tree sits right of centre, so everything lives left), `scrim` is how strongly the soft
// forest scrim darkens behind the beat (0..1).
export const APPROACH_BEATS = [
  {
    id: "approach-heading",
    role: "heading",
    group: "main",
    side: "left",
    text: "Twenty years in the trees.",
    enter: 0.26,
    peakStart: 0.32,
    peakEnd: 0.52,
    exit: 0.58,
    drift: 24,
    scrim: 1,
  },
  {
    id: "approach-subline",
    role: "subline",
    group: "main",
    side: "left",
    text: "The UK's most awarded treehouse builder, from Surrey gardens to Seychelles resorts.",
    // Follows the heading by about 0.04 so the eye reads heading first, then the line under it.
    enter: 0.31,
    peakStart: 0.37,
    peakEnd: 0.52,
    exit: 0.58,
    drift: 20,
    scrim: 1,
  },
  {
    id: "approach-proof",
    role: "proof",
    group: "proof",
    side: "left",
    text: "Treehouses, rope bridges and treetop walkways, designed and built by one dedicated team.",
    enter: 0.82,
    peakStart: 0.88,
    peakEnd: 1,
    exit: null,
    drift: 16,
    // Small quiet line: a lighter scrim than the heading
    scrim: 0.6,
  },
];
