import { createRng, range } from "@/lib/random";

// The backgrounds of Section 3. After the photographs read as stock, every one of them is now the page's own forest green
// with a fine texture, and the three closing sections (questions, invitation, footer) each add one minimal drawn device
// that belongs to their idea. Everything is a brand token or a line: no image files. All of it is decoration (aria-hidden,
// no pointer events), and every number is rounded to 0.1 so the server and the browser agree.

// ---------------------------------------------------------------------------------------------------------------
// GRAIN: a fine, even noise over the green (an inline SVG tile, no file), so the flat colour has a surface, like paint on
// board. Very faint on purpose.
// ---------------------------------------------------------------------------------------------------------------
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function Grain({ className = "opacity-[0.07]" }) {
  return <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`} style={{ backgroundImage: GRAIN, backgroundSize: "220px 220px" }} />;
}

// ---------------------------------------------------------------------------------------------------------------
// PAINTED BOARDS: the green as vertical board cladding, the way the treehouse itself is clad: a seam every 88px with a
// light edge beside it, every other board a touch lighter, and one board in five a touch darker, so it never reads as a
// repeating pattern. Very low contrast: it is a surface, not a picture.
// ---------------------------------------------------------------------------------------------------------------
const BOARDS = [
  "repeating-linear-gradient(90deg, transparent 0 86px, color-mix(in srgb, var(--color-brand-forest) 62%, black) 86px 87px, color-mix(in srgb, var(--color-brand-cream) 2.6%, transparent) 87px 88px)",
  "repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-brand-cream) 1.3%, transparent) 0 88px, transparent 88px 176px)",
  "repeating-linear-gradient(90deg, transparent 0 352px, color-mix(in srgb, black 8%, transparent) 352px 440px)",
].join(", ");

function Boards({ className = "" }) {
  return <div aria-hidden="true" className={`absolute inset-0 ${className}`} style={{ backgroundImage: BOARDS }} />;
}

// Behind the process section: solid green boards with grain. The top and the bottom fade out, so the joins to the sections
// above and below have no edge (both sides are the same flat green).
export function BoardsBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_9%,black_91%,transparent)]">
      <Boards />
      <Grain />
    </div>
  );
}

// Behind the walkway: the same green boards, but they are the wall the walkway runs along: while the page pans they slide
// at a fraction of the pan (data-layer; the owner, Audience.jsx, writes the movement), far slower than the signs, which is
// what gives the walk depth. While pinned the layer is 175 percent of the section wide so it never runs out.
export function BoardsWall() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)]">
      <div data-layer="0.28" className="absolute inset-y-0 left-0 w-full will-change-transform pinned:w-[175%]">
        <Boards />
      </div>
      <Grain />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// THE SLICE (the questions): a tree cut across, very large and very faint, behind the heading, so the signpost stands in
// front of the thing every project starts from. One slice, growth rings only (some seasons thick, some thin), fading out
// toward its edge. data-slice is what the section drifts a little as the page scrolls.
// ---------------------------------------------------------------------------------------------------------------
function ringPath(cx, cy, radius, rng, wobble, points = 36) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 1 + (rng() - 0.5) * 2 * wobble;
    pts.push([cx + Math.cos(a) * radius * k, cy + Math.sin(a) * radius * k]);
  }
  const f = (v) => Math.round(v * 10) / 10;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const RINGS = (() => {
  const rng = createRng(17);
  const rings = [];
  let radius = 8;
  for (let i = 0; i < 36; i++) {
    radius += range(rng, 9, 17);
    rings.push({ d: ringPath(500, 500, radius, rng, 0.008 + i * 0.0014), width: i % 7 === 6 ? 2.2 : 1.1 });
  }
  return rings;
})();

export function TreeSlice() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div data-slice className="absolute top-[58%] -left-[24%] aspect-square h-[128%] -translate-y-1/2 [mask-image:radial-gradient(closest-side,black_55%,transparent)]">
        <svg viewBox="0 0 1000 1000" fill="none" stroke="currentColor" strokeLinecap="round" className="h-full w-full text-brand-cream/[0.1]">
          {RINGS.map((ring, i) => (
            <path key={i} d={ring.d} strokeWidth={ring.width} vectorEffect="non-scaling-stroke" />
          ))}
          <circle cx="500" cy="500" r="3" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <Grain />
    </div>
  );
}
