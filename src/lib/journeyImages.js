// Photography for Section 3. These are free-licence stock photos (Pexels licence: free for commercial use,
// no attribution required) standing in for real Treehouse Life project photography: swap the files in
// public/images/journey (keep the names and the 800 / 1600 px widths) and nothing else needs to change.
// Sources and photo ids: public/images/journey/CREDITS.txt. Files are webp, 1600 and 800 px wide.
//
// `pos` is the object-position used when a frame crops the photo (where the subject is).
const BASE = "/images/journey";

const list = [
  { name: "statement-kids", w: 1600, h: 1067, pos: "46% 55%", alt: "Two girls leaning out of a wooden treehouse window, looking up and laughing." },
  { name: "statement-cabin", w: 1600, h: 1067, pos: "50% 60%", alt: "A small timber cabin glowing warm at night among leaves and string lights." },
  { name: "statement-lit", w: 1600, h: 2400, pos: "50% 55%", alt: "A woodland treehouse with a lit window, reached by a narrow footbridge." },
  { name: "statement-mist", w: 1600, h: 1067, pos: "50% 50%", alt: "" },
  { name: "step-walk", w: 1600, h: 2400, pos: "50% 62%", alt: "Three surveyors in high-visibility vests standing in a forest, studying a plan and looking up into the trees." },
  { name: "step-draw", w: 1600, h: 864, pos: "50% 50%", alt: "A pencil sketch of a timber cabin on paper, with drafting tools beside it." },
  { name: "step-build", w: 1600, h: 1067, pos: "50% 50%", alt: "Two builders working on a timber frame among pine trees." },
  { name: "step-climb", w: 1600, h: 2416, pos: "50% 45%", alt: "A wooden treehouse with a railed deck and warm lit windows, glowing among dark trees." },
  { name: "audience-family", w: 1600, h: 1067, pos: "50% 50%", alt: "A cottage-style wooden treehouse built around a large trunk, with a railed deck." },
  { name: "audience-estate", w: 1600, h: 1067, pos: "50% 45%", alt: "A timber footbridge between tall trees, hung with warm lights." },
  { name: "audience-resort", w: 1600, h: 1067, pos: "50% 50%", alt: "Contemporary timber and steel lodges raised on stilts in a forest clearing." },
  { name: "audience-school", w: 1600, h: 1200, pos: "50% 50%", alt: "Three children smiling through the ropes of a rope bridge, in black and white." },
  { name: "proof-dusk", w: 1600, h: 1065, pos: "50% 60%", alt: "A turreted timber treehouse with lit windows at sunset, with a deck and red berries in the foreground." },
];

export const JOURNEY_IMAGES = Object.fromEntries(list.map((item) => [item.name, { ...item, base: `${BASE}/${item.name}` }]));
