"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { ScrollTrigger } from "@/lib/gsap";
import { CAMERA, FOG } from "@/lib/sceneConfig";
import HeroScene from "./HeroScene";
import PostProcessing, { EXPOSURE } from "./PostProcessing";

// Development tooling is only referenced behind a build-time constant, so the bundler drops the
// whole import in production and r3f-perf (a dev dependency) never ships.
const DevTools = process.env.NODE_ENV === "development" ? lazy(() => import("./DevTools")) : null;

// Starts the fade-in once the scene has really drawn several frames (the staged parts are in by then). Texture painting and
// shader compilation can block the main thread for a moment, and a CSS transition that begins
// before that block would be eaten by it and look like a pop.
function FadeInTrigger({ onVisible }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 10) onVisible(); // after the staged parts have mounted
  });
  return null;
}

// Quality tiers. The scene is heavy (ambient occlusion, depth of field, bloom, SMAA), and on a weaker GPU a dropped
// frame makes smooth scrolling look glitchy, so the scene watches its own frame rate and steps down when it cannot
// hold about 45 fps: 2 = full (pixel ratio up to 1.5, AO on), 1 = medium (pixel ratio 1, AO off), 0 = low (pixel ratio
// 0.8, AO off, cheaper depth of field). It steps back up only if the machine proves it can run well above 58 fps.
const TIER_DPR = { 2: [1, 1.5], 1: 1, 0: 0.8 };

// Starts measuring only after the startup work (texture painting, shader compiles, staged mounting) is over, so that
// a slow first second is not mistaken for a slow machine.
function QualityGovernor({ onDecline, onIncline, onFallback }) {
  const [armed, setArmed] = useState(false);
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 240) setArmed(true);
  });
  if (!armed) return null;
  return (
    <PerformanceMonitor
      ms={300}
      iterations={6}
      threshold={0.7}
      flipflops={3}
      bounds={(hz) => (hz > 90 ? [60, 100] : [42, 58])}
      onDecline={onDecline}
      onIncline={onIncline}
      onFallback={onFallback}
    />
  );
}

// Full-screen R3F canvas. Everything 3D for the hero mounts inside here.
export default function Scene() {
  const [visible, setVisible] = useState(false);
  // Section 3 scrolls over this fixed canvas. Once its solid body reaches the top of the viewport the canvas
  // is completely covered, so stop rendering it: the page below then has the whole GPU (the 3D scene with
  // depth of field is heavy). It resumes the moment the visitor scrolls back up.
  const [covered, setCovered] = useState(false);
  const [tier, setTier] = useState(2);

  useEffect(() => {
    const body = document.querySelector("[data-journey-body]");
    if (!body) return undefined;
    const trigger = ScrollTrigger.create({
      trigger: body,
      start: "top top",
      end: "max",
      onToggle: (self) => setCovered(self.isActive),
      onRefresh: (self) => setCovered(self.isActive),
    });
    return () => trigger.kill();
  }, []);

  return (
    // The deep forest page colour sits behind the canvas, so the fade-in never reveals white.
    <div
      className={`pointer-events-none fixed inset-0 z-0 bg-brand-forest transition-opacity duration-[1400ms] ease-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <Canvas
        frameloop={covered ? "never" : "always"}
        // The soft filter in this three.js version is PCFShadowMap (PCFSoftShadowMap was
        // removed); its softness is set per light with shadow.radius (see HeroScene).
        // autoUpdate is off: HeroScene's ShadowScheduler refreshes the map about 10 times a second.
        shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
        dpr={TIER_DPR[tier]}
        // Rotation is owned by the camera rig (useIdle), which also adapts FOV to the viewport.
        camera={{ position: CAMERA.position, fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far }}
        gl={{
          // Edges are handled by SMAA in the post stack (MSAA cannot coexist with the depth
          // texture used by DoF and AO), and tone mapping happens in the post stack too.
          antialias: false,
          stencil: false,
          powerPreference: "high-performance",
          toneMapping: THREE.NoToneMapping,
          toneMappingExposure: EXPOSURE,
        }}
      >
        <color attach="background" args={[FOG.color]} />
        <HeroScene />
        <PostProcessing tier={tier} />
        <QualityGovernor
          onDecline={() => setTier((t) => Math.max(0, t - 1))}
          onIncline={() => setTier((t) => Math.min(2, t + 1))}
          onFallback={() => setTier(0)}
        />
        <FadeInTrigger onVisible={() => setVisible(true)} />
        {DevTools && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
      </Canvas>
    </div>
  );
}
