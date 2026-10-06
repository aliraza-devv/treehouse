import { AWARDS } from "@/lib/site";
import { LEAF_PATH } from "./canopy";

// Award badges: a gold laurel (the brand's own leaf shape, laid along two arcs) around the year, with the award
// title and the awarding body under it as plain type. The laurel is the only drawing; no awarding body's logo is
// used. Server rendered markup: positions are formatted to one decimal, so server and client agree.
//
// Geometry: a 120 x 120 box, leaves along an arc of radius 44 centred at (60, 60), from the bottom (100 degrees)
// round the left side to the top (250 degrees). The right branch is the same branch mirrored. Each leaf points
// along the branch (tangent = angle + 90) and alternates 38 degrees to either side of it.
const COUNT = 12;
const LEAVES = Array.from({ length: COUNT }, (_, i) => {
  const t = i / (COUNT - 1);
  const angle = 100 + t * 150;
  const rad = (angle * Math.PI) / 180;
  const size = 0.62 + 0.3 * Math.sin(t * Math.PI); // fullest in the middle of the branch
  return {
    x: (60 + 44 * Math.cos(rad)).toFixed(1),
    y: (60 + 44 * Math.sin(rad)).toFixed(1),
    rotate: (angle + 90 + (i % 2 ? 38 : -38)).toFixed(1),
    scale: size.toFixed(2),
    tone: i % 3 === 0 ? "fill-brand-warm/70" : "fill-brand-warm",
  };
});

function Branch() {
  return LEAVES.map((leaf, i) => (
    <g key={i} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotate}) scale(${leaf.scale})`}>
      <path data-leaf d={LEAF_PATH} className={`${leaf.tone} [transform-box:fill-box] origin-left`} />
    </g>
  ));
}

export default function Awards({ className = "grid gap-x-8 gap-y-10 sm:grid-cols-2" }) {
  return (
    <ul role="list" aria-label="Awards" className={className}>
      {AWARDS.map((award) => (
        <li key={award.id} data-award className="flex flex-col items-start gap-5">
          <div className="relative size-40 shrink-0">
            <svg aria-hidden="true" viewBox="0 0 120 120" className="absolute inset-0 h-full w-full overflow-visible">
              <Branch />
              <g transform="translate(120 0) scale(-1 1)">
                <Branch />
              </g>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
              <span className="font-display text-[1.45rem] leading-none text-brand-cream lining-nums">{award.year}</span>
              <span className="mt-2 text-[8.5px] font-medium tracking-[0.2em] text-brand-warm uppercase">Winner</span>
            </div>
          </div>
          <div>
            <p className="font-display text-[1.35rem] leading-snug text-balance text-brand-cream">{award.title}</p>
            <p className="mt-1.5 text-[13px] leading-snug text-brand-cream/65">{award.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
