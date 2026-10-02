import SceneLoader from "@/components/canvas/SceneLoader";
import CanvasBoundary from "@/components/ui/CanvasBoundary";
import HeroContent from "@/components/ui/HeroContent";
import Navbar from "@/components/ui/Navbar";
import ScrollIndicator from "@/components/ui/ScrollIndicator";
import SmoothScroll from "@/components/ui/SmoothScroll";
import { LAYERS } from "@/lib/layers";

export default function Home() {
  return (
    // The hero is exactly one locked viewport. Lenis and ScrollTrigger are wired but idle for now.
    <main id="top" className="relative min-h-[100dvh] overflow-hidden bg-brand-forest">
      <SmoothScroll />

      <div aria-hidden="true" className="absolute inset-0" style={{ zIndex: LAYERS.scene }}>
        <CanvasBoundary>
          <SceneLoader />
        </CanvasBoundary>
      </div>

      {/* Scrim: deep forest at about 55% in the lower-left corner, gone by 60% of the width,
          so the heading stays legible over bright mist without dulling the scene. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_75%_at_0%_100%,color-mix(in_srgb,var(--color-brand-forest)_55%,transparent),transparent)]"
        style={{ zIndex: LAYERS.scrim }}
      />
      {/* Scrim: very light bottom band behind the scroll cue */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-brand-forest/30 to-transparent"
        style={{ zIndex: LAYERS.scrim }}
      />

      <Navbar />
      <HeroContent />
      <ScrollIndicator />
    </main>
  );
}
