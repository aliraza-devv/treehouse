// Bottom-centre cue: a label above a line with a light that travels down it.
export default function ScrollIndicator() {
  return (
    <div
      data-intro="scroll"
      className="invisible absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3"
      aria-hidden="true"
    >
      <span className="text-[0.65rem] uppercase tracking-[0.35em] text-[#F4F1E8]/75">Scroll</span>
      <span className="relative block h-14 w-px overflow-hidden bg-[#F4F1E8]/25">
        <span className="scroll-cue absolute left-0 top-0 block h-5 w-px bg-[#D8B26A]" />
      </span>
    </div>
  );
}
