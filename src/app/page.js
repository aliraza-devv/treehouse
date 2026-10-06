import SceneLoader from "@/components/canvas/SceneLoader";
import CanvasBoundary from "@/components/ui/CanvasBoundary";
import HeroContent from "@/components/ui/HeroContent";
import HeroFade from "@/components/ui/HeroFade";
import Journey from "@/components/ui/journey/Journey";
import Navbar from "@/components/ui/Navbar";
import ScrollDriver, { ScrollRunway, SectionOverlays } from "@/components/ui/ScrollDriver";
import SmoothScroll from "@/components/ui/SmoothScroll";
import { LAYERS } from "@/lib/layers";

export default function Home() {
  return (
    <>
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

          {/* Required credit for the CC-BY-4.0 child model (public/models/child/LICENSE.txt). Repeated in the
              footer of Section 3, because this one is covered once the page scrolls over the stage. */}
          <p
            className="pointer-events-auto absolute right-3 bottom-2 max-w-[18rem] text-[10px] leading-snug text-brand-cream/60"
            style={{ zIndex: LAYERS.content }}
          >
            Based on{" "}
            <a
              href="https://sketchfab.com/3d-models/fhc-crying-child-b60b17251195459e95c60d8992139a0c"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              FHC: Crying Child
            </a>{" "}
            by Speed F1, licensed under{" "}
            <a href="http://creativecommons.org/licenses/by/4.0/" className="underline" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            .
          </p>
        </div>

        <ScrollRunway />

        {/* Section 3: ordinary page content that scrolls over the fixed stage once the camera journey ends */}
        <Journey />
      </main>

      <ScrollDriver />
    </>
  );
}
