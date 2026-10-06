import SceneLoader from "@/components/canvas/SceneLoader";
import CanvasBoundary from "@/components/ui/CanvasBoundary";
import HeroContent from "@/components/ui/HeroContent";
import HeroFade from "@/components/ui/HeroFade";
import HeroScrims from "@/components/ui/HeroScrims";
import Journey from "@/components/ui/journey/Journey";
import Navbar from "@/components/ui/Navbar";
import Preloader from "@/components/ui/Preloader";
import ScrollDriver, { ScrollRunway, SectionOverlays } from "@/components/ui/ScrollDriver";
import SmoothScroll from "@/components/ui/SmoothScroll";
import { LAYERS } from "@/lib/layers";

export default function Home() {
  return (
    <>
      {/* The loader covers the page from the first paint until the stage, the scroll runway and the fonts are ready */}
      <Preloader />

      {/* The logo links to #top: Lenis glides there (an element must exist for it to find) */}
      <div id="top" aria-hidden="true" className="absolute top-0 left-0 h-px w-px" />

      {/* Outside <main> so the header keeps its banner landmark */}
      <Navbar />

      {/* The page is a FIXED full-viewport stage (canvas, scrims, hero copy, section overlays) over a
          scroll RUNWAY: an empty tall block that only provides the scroll distance. ScrollDriver turns that
          scroll into one global progress value that drives the camera and every overlay. The stage fills one
          dynamic viewport exactly like the old hero did (copy at the bottom, flex column, justify-end). */}
      <main id="main" tabIndex={-1} className="relative bg-brand-forest outline-none">
        <SmoothScroll />

        <div
          data-stage
          className="fixed inset-x-0 top-0 flex h-[100dvh] flex-col justify-end overflow-hidden"
          style={{ zIndex: LAYERS.scene }}
        >
          <div aria-hidden="true" className="absolute inset-0" style={{ zIndex: LAYERS.scene }}>
            <CanvasBoundary>
              <SceneLoader />
            </CanvasBoundary>
          </div>

          {/* The hero's two scrims (they keep cream copy legible over bright mist) leave with the hero copy */}
          <HeroScrims />

          {/* Hero copy fades and drifts up over the first 10 percent of scroll */}
          <HeroFade>
            <HeroContent />
          </HeroFade>

          {/* The HTML copy of every registered section (the approach overlay today), driven by the same progress */}
          <SectionOverlays />

          {/* Section 3's canopy transition fades the whole stage to the forest colour behind the rising
              canopy (CanopyCurtain.jsx drives this opacity). Above the copy, below the navbar. */}
          <div
            aria-hidden="true"
            data-stage-dim
            className="pointer-events-none absolute inset-0 bg-brand-forest opacity-0"
            style={{ zIndex: LAYERS.dim }}
          />
        </div>

        <ScrollRunway />

        {/* Section 3: ordinary page content that scrolls over the fixed stage once the camera journey ends */}
        <Journey />
      </main>

      <ScrollDriver />
    </>
  );
}
