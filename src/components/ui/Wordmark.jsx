import { LEAF_PATH } from "@/components/ui/journey/canopy";

// The logo as lettering, not just a font: the dot of the i in "Life" is a leaf, sprouting off the top of the stem
// (the same leaf shape as the vine, the laurels and the canopy; its base is pinned to the stem and it leans up and right). It is set in the dotless i (U+0131), so there is no second dot.
// The leaf is sized and placed in em, so it follows the type size. Screen readers get the plain name.
export default function Wordmark() {
  return (
    <>
      <span className="sr-only">Treehouse Life</span>
      <span aria-hidden="true">
        Treehouse L
        <span className="relative inline-block">
          {"\u0131"}
          <svg
            viewBox="0 0 26 12"
            className="absolute top-[0.2em] left-1/2 h-[0.17em] w-[0.36em] origin-left -rotate-[52deg] fill-brand-green-light"
          >
            <path d={LEAF_PATH} />
          </svg>
        </span>
        fe
      </span>
    </>
  );
}
