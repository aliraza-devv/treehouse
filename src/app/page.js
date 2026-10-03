import SceneLoader from "@/components/canvas/SceneLoader";
import CanvasBoundary from "@/components/ui/CanvasBoundary";
import HeroContent from "@/components/ui/HeroContent";
import HeroFade from "@/components/ui/HeroFade";
import Navbar from "@/components/ui/Navbar";
import ScrollDriver, { ScrollRunway, SectionOverlays } from "@/components/ui/ScrollDriver";
import ScrollIndicator from "@/components/ui/ScrollIndicator";
import SmoothScroll from "@/components/ui/SmoothScroll";
import { LAYERS } from "@/lib/layers";

export default function Home() {
  return (
    <>
      {/* Outside <main> so the header keeps its banner landmark */}
      <Navbar />

      {/* The page is a FIXED full-viewport stage (canvas, scrims, hero copy, section overlays) over a
          scroll RUNWAY: an empty tall block that only provides the scroll distance. ScrollDriver turns that
          scroll into one global progress value that drives the camera and every overlay. The stage fills one
          dynamic viewport exactly like the old hero did (copy at the bottom, flex column, justify-end). */}
      <main id="main" tabIndex={-1} className="relative bg-brand-forest outline-none">
        <SmoothScroll />

        <div
          className="fixed inset-x-0 top-0 flex h-[100dvh] flex-col justify-end overflow-hidden"
          style={{ zIndex: LAYERS.scene }}
        >
          <div aria-hidden="true" className="absolute inset-0" style={{ zIndex: LAYERS.scene }}>
            <CanvasBoundary>
              <SceneLoader />
            </CanvasBoundary>
          </div>

          {/* Scrim under the text block: keeps cream copy legible over bright mist */}
          <div
            aria-hidden="true"
            className="bg-scrim-hero pointer-events-none absolute inset-0"
            style={{ zIndex: LAYERS.scrim }}
          />
          {/* Scrim: light bottom band behind the scroll cue */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-brand-forest/30 to-transparent"
            style={{ zIndex: LAYERS.scrim }}
          />

          {/* Hero copy fades and drifts up over the first 10 percent of scroll */}
          <HeroFade>
            <HeroContent />
            <ScrollIndicator />
          </HeroFade>

          {/* The HTML copy of every registered section (the approach overlay today), driven by the same progress */}
          <SectionOverlays />
        </div>

        <ScrollRunway />
      </main>

      <ScrollDriver />
    </>
  );
}
