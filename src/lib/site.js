// Copy and constants for Section 3 (the page after the climb). Facts come from the owner brief only:
// 250+ projects, 20+ years, 5 continents, award-winning, bespoke builds for private gardens, estates,
// resorts and schools, one dedicated design and build team, and the real project places Surrey, Lake
// Como, Quebec and Seychelles. No client names, prices, timelines or certifications are claimed.
// Straight apostrophes, no em or en dashes (CLAUDE.md).

// TODO(owner): the real enquiry page, or a mailto: link. Every "Start Project" button on the page uses this.
export const ENQUIRY_HREF = "https://treehouselife.com/";
export const CTA_LABEL = "Start Project"; // one label for one intent: it matches the navbar

export const STATEMENT = "A treehouse is not an extra room in the garden. It is where your family's stories begin.";
export const STATEMENT_ACCENT = "stories";

// The process, told in four plain steps. mark is the word that gets a hand-drawn underline, caption the
// handwritten note on the photo, tilt how far the photo hangs off straight (degrees), photo a key of
// JOURNEY_IMAGES (src/lib/journeyImages.js).
export const STEPS = [
  {
    id: "walk",
    mark: "garden",
    title: "We walk your garden.",
    body: "The tree, the light and the view decide where it goes, so we start with them before a line is drawn.",
    photo: "step-walk",
    caption: "Where will it sit?",
    tilt: -3,
    aspect: "aspect-[4/5]",
  },
  {
    id: "draw",
    mark: "your tree",
    title: "We draw it for your tree.",
    body: "Every design is bespoke, shaped around your tree, your family and the way you want to use it.",
    photo: "step-draw",
    caption: "Drawn for this tree.",
    tilt: 2.5,
    aspect: "aspect-[5/4]",
  },
  {
    id: "build",
    mark: "One team",
    title: "One team builds it.",
    body: "The people who design your treehouse are the people who build it, so nothing gets lost between drawing and garden.",
    photo: "step-build",
    caption: "Start to finish.",
    tilt: -2,
    aspect: "aspect-square",
  },
  {
    id: "climb",
    mark: "climb up",
    title: "Then you climb up.",
    body: "A place to read, play, host and watch the seasons change, ready for the first evening.",
    photo: "step-climb",
    caption: "The first evening up there.",
    tilt: 3,
    aspect: "aspect-[4/5]",
  },
];

// Four kinds of project. photo is a key of JOURNEY_IMAGES; mono marks the black and white photo.
export const AUDIENCES = [
  {
    id: "family",
    name: "Family gardens",
    body: "A place of their own, for the children who already climb everything.",
    offers: "Treehouses, nest swings, rope bridges",
    photo: "audience-family",
  },
  {
    id: "estate",
    name: "Private estates",
    body: "Quiet retreats and treetop walkways, set among the oldest trees on the grounds.",
    offers: "Treehouses, treetop walkways, rope bridges",
    photo: "audience-estate",
  },
  {
    id: "resort",
    name: "Resorts and hospitality",
    body: "Signature stays and treetop experiences that guests talk about long after they leave.",
    offers: "Treehouse stays, treetop walkways, rope bridges",
    photo: "audience-resort",
  },
  {
    id: "school",
    name: "Schools and communities",
    body: "Rope bridges and walkways that get children outdoors, moving and looking up.",
    offers: "Rope bridges, treetop walkways, treehouses",
    photo: "audience-school",
    mono: true,
  },
];

export const STATS = [
  { value: 250, suffix: "+", label: "Projects" },
  { value: 20, suffix: "+", label: "Years" },
  { value: 5, suffix: "", label: "Continents" },
];

// Real project places from the brief (the Section 2 signposts).
export const PLACES = ["Surrey", "Lake Como", "Quebec", "Seychelles"];

// Awards Treehouse Life lists on its own site (treehouselife.com, awards pages). Each is a win with an awarding
// body and a year; the Great British Entrepreneur Awards 2022 entry is a finalist place, so it is not here. The
// badges are text and a laurel drawn in brand colours: no awarding body's logo or trademark is used.
// TODO(owner): confirm the exact titles and years, and add any newer awards (add an object to this array).
export const AWARDS = [
  { id: "lux-2022", year: "2022", title: "Best Treetop Accommodation & Walkway Design / Build Company", body: "LUX Magazine Travel & Tourism Awards" },
  { id: "uk-enterprise-2022", year: "2022", title: "Best Treehouse & Rope Bridge Design Provider", body: "UK Enterprise Awards, SME News" },
  { id: "business-excellence-2022", year: "2022", title: "Best Rope Bridges & Treehouse Design / Build Company", body: "Business Excellence Awards, Acquisition International" },
  { id: "lux-2021", year: "2021", title: "Best Bespoke Tree-House Builders", body: "LUX Magazine Travel & Tourism Awards" },
];
