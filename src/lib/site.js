// Copy and constants for Section 3 (the page after the climb). Facts come from the owner brief only:
// 250+ projects, 20+ years, 5 continents, award-winning, bespoke builds for private gardens, estates,
// resorts and schools, one dedicated design and build team, and the real project places Surrey, Lake
// Como, Quebec and Seychelles. No client names, prices, timelines or certifications are claimed.
// Straight apostrophes, no em or en dashes (CLAUDE.md).

// TODO(owner): the real enquiry page, or a mailto: link. Every "Start Project" button on the page uses this.
export const ENQUIRY_HREF = "https://treehouselife.com/";
export const CTA_LABEL = "Start Project"; // one label for one intent: it matches the navbar

// How to reach the company, shown in the footer. These are the email address and office number published on the owner's existing
// site (treehouselife.com); the phone link is the same number in international form.
// TODO(owner): confirm both are current, and say if you would rather show a WhatsApp number or an address as well.
export const CONTACT = { email: "hello@treehouselife.co.uk", phone: "01483 351980", phoneHref: "tel:+441483351980" };

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

// Four kinds of project. photo is a key of JOURNEY_IMAGES.
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

// What clients say. These are real: they come from Treehouse Life's own Testimonials page (treehouselife.com, category
// testimonials), where they are published without names, so none is given here either; the attribution says only what the
// words themselves say (a family, grandparents, a school). The wording is theirs. What changed: straight apostrophes, a full
// stop where the original ran sentences together with a comma, "Treetop" spelled as it is on the rest of this site, and the
// school quote is cut after its first sentence. `accent` is the phrase set in the warm colour (it must appear in `quote`),
// `who` and the optional `what` the attribution, `portrait` the square photograph shown large in the round window beside the words, `illustrative` true while that photograph is a stand-in.
// The page shows them one at a time with previous and next buttons, a counter and a row of rungs to jump along, so there is
// no limit built in: add an object to this array. Around ten reads well; past about twelve the rungs get very narrow, and
// quotes of a similar length (one to three sentences) keep the layout calm.
// TODO(owner): confirm you are happy to reuse these on the new site.
// Portraits: the photographs in public/images/clients are free stock portraits (Pexels, see CREDITS.txt there). They are NOT
// these clients. So every testimonial is marked `illustrative: true`, and the page says "Illustrative photo" under the
// attribution, which keeps anyone from being told a stranger wrote the words (and the Pexels licence does not allow implying
// that a pictured person endorses you). When a client sends their own photograph, with their permission, replace that file (same
// name, square, 960px webp) and delete `illustrative: true` from that testimonial: the note goes and the portrait is theirs.
export const TESTIMONIALS = [
  {
    id: "kids",
    quote: "The kids are absolutely delighted with their treehouse. Years of fun to be had and we haven't seen the kids since we've had it installed!",
    accent: "we haven't seen the kids since we've had it installed",
    who: "A family",
    portrait: "/images/clients/kids.webp",
    illustrative: true,
    what: "Treehouse",
  },
  {
    id: "bespoke",
    quote: "I wanted something very special, magical and unique. I had a specific idea in mind with a treehouse that was all crooked and artistic.",
    accent: "crooked and artistic",
    who: "A client",
    portrait: "/images/clients/bespoke.webp",
    illustrative: true,
    what: "Bespoke treehouse",
  },
  {
    id: "grandparents",
    quote: "It makes us wish we were young again. The Tree House is a beautiful feature of the space and a magical place for our grandchildren to play.",
    accent: "wish we were young again",
    who: "Grandparents",
    portrait: "/images/clients/grandparents.webp",
    illustrative: true,
    what: "Treehouse",
  },
  {
    id: "school",
    quote: "We are 100% happy with our Treetop Walkway and Zip Wire.",
    accent: "100% happy",
    who: "A school",
    portrait: "/images/clients/school.webp",
    illustrative: true,
    what: "Treetop walkway and zip wire",
  },
  {
    id: "bridge",
    quote: "It was a delight and breath of fresh air to work with Treehouse Life. The Rope Bridge is a work of art and everyone admires the structure.",
    accent: "a work of art",
    who: "A client",
    portrait: "/images/clients/bridge.webp",
    illustrative: true,
    what: "Rope bridge",
  },
  {
    id: "home",
    quote: "Our kids LOVE their Treehouse and turned it into a home-from-home almost immediately. I know they will get many happy years playing there.",
    accent: "home-from-home",
    who: "A family",
    portrait: "/images/clients/home.webp",
    illustrative: true,
    what: "Treehouse",
  },
  {
    id: "castle",
    quote: "The Treehouse, Zip Wire, Castle and Drawbridge are all inspired, beautifully installed and great fun for the whole family and friends.",
    accent: "inspired, beautifully installed",
    who: "A client",
    portrait: "/images/clients/castle.webp",
    illustrative: true,
    what: "Treehouse, zip wire, castle and drawbridge",
  },
  {
    id: "environment",
    quote: "We are thrilled with the result. It is very in keeping with the environment, but totally engaging for both children and adults alike.",
    accent: "in keeping with the environment",
    who: "A client",
    portrait: "/images/clients/environment.webp",
    illustrative: true,
  },
  {
    id: "idea",
    quote: "It is safe to say the Treehouse is a hit. I could not be happier. Treehouse Life did an incredible job helping me bring my idea to life.",
    accent: "bring my idea to life",
    who: "A client",
    portrait: "/images/clients/idea.webp",
    illustrative: true,
    what: "Treehouse",
  },
  {
    id: "detail",
    quote: "I can't thank you enough. I will certainly be recommending Treehouse Life to my friends. Extremely good skills and an eye for detail.",
    accent: "an eye for detail",
    who: "A client",
    portrait: "/images/clients/detail.webp",
    illustrative: true,
  },
];

// The questions people ask before they start. Every answer uses only what the owner brief says (one team designs and
// builds, every design is bespoke, the four things built, the kinds of client, 250+ projects on 5 continents, the real
// places). None of them promises a price, a timeline, a material or a safety claim.
// TODO(owner): approve this copy, and add real answers on price and timing if you want them on the page.
export const FAQ = [
  {
    id: "build",
    q: "What do you build?",
    a: "Treehouses, rope bridges, treetop walkways and nest swings, for family gardens, private estates, resorts and schools.",
  },
  {
    id: "bespoke",
    q: "Is every treehouse bespoke?",
    a: "Yes. Every design is drawn for your tree, your family and the way you want to use it. We start by walking your garden, before a line is drawn.",
  },
  {
    id: "team",
    q: "Do you design it and build it?",
    a: "Both, with one team. The people who design your treehouse are the people who build it, so nothing gets lost between the drawing and the garden.",
  },
  {
    id: "where",
    q: "Where do you build?",
    a: "Across the UK and beyond: more than 250 projects on 5 continents, from Surrey and Lake Como to Quebec and the Seychelles.",
  },
  {
    id: "cost",
    q: "What will it cost, and how long will it take?",
    a: "That depends on the tree, the design and the site, so the honest answer comes after we have walked the garden. Start a project and we will talk it through.",
  },
];
