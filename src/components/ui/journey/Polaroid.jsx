import { LEAF_PATH } from "./canopy";
import Photo from "./Photo";

// A photo pinned into the build journal: cream paper, a strip of tape, a handwritten caption, a leaf sticker.
// The paper is a physical object, so it has its own small corner (4px); every real photograph frame on the
// page uses the 28px radius. `tilt` is how far it hangs off straight (degrees); hovering straightens it.
export default function Polaroid({ photo, caption, tilt, aspect = "aspect-square", flip = false }) {
  return (
    <figure
      data-polaroid
      style={{ "--tilt": `${tilt}deg` }}
      className="relative w-[min(100%,25rem)] rotate-(--tilt) rounded-[4px] bg-brand-cream p-3 pb-16 shadow-[0_26px_50px_-22px_color-mix(in_srgb,var(--color-brand-forest)_55%,black)] transition-[rotate,scale] duration-700 ease-expo-out hover:scale-[1.03] hover:rotate-0"
    >
      <div className={`relative overflow-hidden bg-brand-forest ${aspect}`}>
        <Photo name={photo} sizes="(min-width: 768px) 25rem, 80vw" className="h-full w-full object-cover" />
        {/* The photo "develops" by this paper-coloured layer fading away (ProcessTrail). Invisible without JavaScript. */}
        <div aria-hidden="true" data-develop className="pointer-events-none absolute inset-0 bg-brand-cream opacity-0" />
      </div>
      <figcaption className="absolute inset-x-3 bottom-4 text-center font-hand text-[1.7rem] leading-none text-brand-forest">{caption}</figcaption>

      {/* tape */}
      <span
        aria-hidden="true"
        className="absolute -top-4 left-1/2 h-8 w-28 -translate-x-1/2 -rotate-3 bg-brand-warm/55 [clip-path:polygon(2%_0,98%_0,100%_50%,98%_100%,2%_100%,0_50%)]"
      />
      {/* leaf sticker on a corner */}
      <svg
        aria-hidden="true"
        viewBox="0 0 26 12"
        className={`absolute -bottom-3 h-7 w-14 fill-brand-green ${flip ? "-left-5 rotate-[200deg]" : "-right-5 rotate-[22deg]"}`}
      >
        <path d={LEAF_PATH} />
        <path d="M2 6 L22 6" stroke="var(--color-brand-green-light)" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      </svg>
    </figure>
  );
}
