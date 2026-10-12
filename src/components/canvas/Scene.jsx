"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ScrollTrigger } from "@/lib/gsap";
import { gpuName } from "@/lib/hasWebGL";
import { markPart } from "@/lib/loadState";
import { CAMERA, FOG } from "@/lib/sceneConfig";
import HeroScene from "./HeroScene";
import Precompile from "./Precompile";
import PostProcessing, { EXPOSURE, TIERS } from "./PostProcessing";

// Development tooling is only referenced behind a build-time constant, so the bundler drops the
// whole import in production and r3f-perf (a dev dependency) never ships.
const DevTools = process.env.NODE_ENV === "development" ? lazy(() => import("./DevTools")) : null;

// The props <Canvas> is given are constants, so it sees the very same objects every time this component renders. React Three
// Fiber re-applies its whole configuration when a prop changes identity, and that resizes the drawing surface and every
// post-processing buffer: it cost 250 to 500 ms, and it happened each time this component re-rendered (for example when the scene
// was covered by the page), as a stall in the middle of the scroll. Nothing here re-renders the canvas any more except a change of
// quality tier, and the loop is switched on and off through the store (see LoopGate), not through a prop.
const CANVAS_CAMERA = { position: CAMERA.position, fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far };
// The soft filter in this three.js version is PCFShadowMap (PCFSoftShadowMap was removed); its softness is set per light with
// shadow.radius (see HeroScene). autoUpdate is off: HeroScene's ShadowScheduler decides when the map is refreshed.
const CANVAS_SHADOWS = { type: THREE.PCFShadowMap, autoUpdate: false };
const CANVAS_GL = {
  // Edges are handled by SMAA in the post stack (MSAA cannot coexist with the depth
  // texture used by DoF and AO), and tone mapping happens in the post stack too.
  antialias: false,
  stencil: false,
  powerPreference: "high-performance",
  toneMapping: THREE.NoToneMapping,
  toneMappingExposure: EXPOSURE,
};
const BACKGROUND = [FOG.color];
// How the canvas measures its container. The default is getBoundingClientRect, which INCLUDES CSS transforms, and the canopy
// transition scales the whole stage from 1 to 1.12 as the page scrolls (CanopyCurtain.jsx): so the canvas saw a new size on almost
// every step and rebuilt the drawing surface and every post-processing buffer each time (about 17 times across the transition, each
// a stall of 100 to 300 ms: this was the glitch at the hand-over to the third section). offsetSize measures the layout size, which
// the scale does not change, so the canvas stays its size and the stage is simply scaled on screen. The stage is fixed, so there is
// no position to follow either (scroll: false).
const CANVAS_RESIZE = { offsetSize: true, scroll: false };

// The render loop runs only when (1) every shader is compiled (Precompile.jsx says so) and (2) the scene is not covered. Section 3
// scrolls over this fixed canvas; once its solid body reaches the top of the viewport the canvas is completely covered, so it
// stops rendering and the page below has the whole GPU. It resumes the moment the visitor scrolls back up. Both are switched through
// the store, so nothing re-renders; and only a real change is passed on (setFrameloop restarts the clock). The state lives in the
// effect; the parent gets a function (through register) that says "compiled".
function LoopGate({ register }) {
  const setFrameloop = useThree((state) => state.setFrameloop);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const g = { compiled: false, covered: false, mode: "never" };
    const apply = () => {
      const next = g.compiled && !g.covered ? "always" : "never";
      if (next === g.mode) return;
      g.mode = next;
      setFrameloop(next);
      invalidate();
    };
    register(() => {
      g.compiled = true;
      apply();
    });
    const body = document.querySelector("[data-journey-body]");
    const trigger = body
      ? ScrollTrigger.create({
          trigger: body,
          start: "top top",
          end: "max",
          onToggle: (self) => {
            g.covered = self.isActive;
            apply();
          },
          onRefresh: (self) => {
            g.covered = self.isActive;
            apply();
          },
        })
      : null;
    return () => {
      trigger?.kill();
      register(null);
    };
  }, [register, setFrameloop, invalidate]);
  return null;
}

// Starts the fade-in once the scene has really drawn a few frames. The shaders are compiled and the textures uploaded before the first
// frame (see Precompile.jsx), so what is left to settle is small; a CSS transition that began before that would be eaten by it and
// look like a pop. The fade is set on the element directly (a class would need a state change, and so a re-render).
function FadeInTrigger({ onVisible }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 4) onVisible();
  });
  return null;
}

// THE QUALITY GOVERNOR. The scene is heavy (ambient occlusion, depth of field, bloom, SMAA, a big shadow map), and on a weaker GPU
// a slow frame makes the scroll look stuck, so the scene watches its own frame time and moves to a lighter tier (see TIERS in
// PostProcessing.jsx) when it cannot keep about 35 fps. It used to wait for 240 frames before it began, which on a slow GPU is about
// half a minute. Now it skips the first few frames (the startup work is not a measurement), takes the median of the next window, and
// goes STRAIGHT to the tier that should be fast enough, using what each tier costs relative to the full one (measured: a tier costs
// about COST of the one above), instead of stepping down one at a time: every change rebuilds the buffers (about 200 ms), so fewer
// changes is smoother. The next window checks it, and can step down again. It goes back up only on a display that could show well
// above 60 fps (a 60 Hz display never reports frames faster than 16.7 ms), and stops trying if going up turned out to be a mistake.
const SKIP_FRAMES = 8; // after the loop starts, and after every change (the buffers are being rebuilt)
const WINDOW_FRAMES = 10;
const TARGET_MS = 26; // what a tier should cost to be accepted
const SLOW_MS = 30; // a median above this means: go lighter
const FAST_MS = 11;
const COST = { 3: 1, 2: 0.55, 1: 0.35, 0: 0.18 };
function QualityGovernor({ tier, onChange }) {
  const g = useRef({ skip: SKIP_FRAMES, frames: [], calm: 0, lastUp: -1e9, noMoreUp: false });
  useFrame((state, delta) => {
    if (delta > 0.5 || document.hidden) return;
    const s = g.current;
    if (s.skip > 0) {
      s.skip -= 1;
      return;
    }
    s.frames.push(delta * 1000);
    if (s.frames.length < WINDOW_FRAMES) return;
    const sorted = [...s.frames].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    s.frames.length = 0;

    let next = tier;
    if (median > SLOW_MS && tier > 0) {
      // what the full scene would cost here, then the heaviest lighter tier that should come in under the target
      const full = median / COST[tier];
      next = 0;
      for (let t = tier - 1; t > 0; t -= 1) {
        if (full * COST[t] <= TARGET_MS) {
          next = t;
          break;
        }
      }
      s.calm = 0;
      if (performance.now() - s.lastUp < 8000) s.noMoreUp = true; // going up was a mistake: stay down
    } else if (median < FAST_MS && tier < 3 && !s.noMoreUp) {
      s.calm += 1;
      if (s.calm >= 6) {
        next = tier + 1;
        s.calm = 0;
        s.lastUp = performance.now();
      }
    } else {
      s.calm = 0;
    }
    if (next !== tier) {
      s.skip = SKIP_FRAMES;
      onChange(next);
    }
  });
  return null;
}

// Where to start. An integrated Intel GPU of the UHD or HD Graphics generation was measured at about 8 fps on the full tier and about
// 40 on the lightest, so it starts on the lightest instead of finding that out while the visitor scrolls (every change of tier rebuilds
// the buffers: a stall of 200 to 600 ms). Everything else starts on the full tier, and the governor takes it from there.
const startTier = () => (/Intel.*(UHD|HD Graphics)/i.test(gpuName()) ? 0 : 3);

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene() {
  const veil = useRef(null);
  const composerRef = useRef(null);
  // The function LoopGate registers: Precompile calls it when every shader is compiled (see LoopGate).
  const compiled = useRef(null);
  const register = useCallback((fn) => {
    compiled.current = fn;
  }, []);
  const [tier, setTier] = useState(startTier);
  // One element for the whole hero, so a change of tier (which re-renders this component) never re-renders the scene tree.
  const hero = useMemo(() => <HeroScene />, []);

  return (
    // The deep forest page colour sits behind the canvas, so the fade-in never reveals white.
    <div ref={veil} className="pointer-events-none fixed inset-0 z-0 bg-brand-forest opacity-0 transition-opacity duration-[1000ms] ease-out">
      <Canvas
        frameloop="never"
        resize={CANVAS_RESIZE}
        shadows={CANVAS_SHADOWS}
        dpr={TIERS[tier].dpr}
        // Rotation is owned by the camera rig (useIdle), which also adapts FOV to the viewport.
        camera={CANVAS_CAMERA}
        gl={CANVAS_GL}
      >
        <color attach="background" args={BACKGROUND} />
        {hero}
        <PostProcessing tier={tier} composerRef={composerRef} />
        <Precompile
          composer={composerRef}
          onDone={() => compiled.current?.()}
        />
        <LoopGate register={register} />
        <QualityGovernor tier={tier} onChange={setTier} />
        <FadeInTrigger
          onVisible={() => {
            if (veil.current) veil.current.style.opacity = "1";
            markPart("scene"); // the loader waits for this
          }}
        />
        {DevTools && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
      </Canvas>
    </div>
  );
}
