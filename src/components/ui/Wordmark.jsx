import { LEAF_PATH } from "@/components/ui/journey/canopy";

// The logo as lettering, not just a font: the name is "Treehouse", and a leaf sprouts off the top of the stem of the h (the same
// leaf shape as the vine, the laurels and the canopy; its base sits on the stem and it leans up and right). The leaf is sized and
// placed in em, from the text baseline (a zero-size anchor sits on the baseline, so it does not matter what line height the logo
// is set in), so it follows the type size. The stem's position (0.22em across, top at 0.745em up) was read off the Fraunces glyph.
// Screen readers get the plain name.
export default function Wordmark() {
  return (
    <>
      <span className="sr-only">Treehouse</span>
      <span aria-hidden="true">
        Tree
        <span className="relative inline-block">
          <span className="relative inline-block h-0 w-0 align-baseline">
            <svg viewBox="0 0 26 12" className="absolute bottom-[0.66em] left-[0.22em] h-[0.17em] w-[0.36em] origin-left -rotate-[52deg] fill-brand-green-light">
              <path d={LEAF_PATH} />
            </svg>
          </span>
          h
        </span>
        ouse
      </span>
    </>
  );
}
