import { LAYERS } from "@/lib/layers";

// Bottom-centre cue. Decorative (the hero does not scroll yet), so it is hidden from assistive tech.
// Fade-in and dot loop are pure CSS keyframes (see globals.css), so no JS is needed.
export default function ScrollIndicator() {
  return (
    <div
      aria-hidden="true"
      className="scroll-cue pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center"
      style={{ zIndex: LAYERS.content }}
    >
      {/* 1px by 40px line with a small warm dot travelling down it */}
      <span className="relative block h-10 w-px bg-brand-cream/40">
        <span className="scroll-cue-dot absolute -left-[1.5px] top-0 block size-1 rounded-full bg-brand-warm" />
      </span>
      <span className="mt-3 text-[11px] uppercase tracking-[2px] text-brand-cream/35">Scroll to explore</span>
    </div>
  );
}
