"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scrollState } from "@/lib/scroll/scrollStore";

// ===========================================================================================
// REVEAL: why it exists
//
// The hero frame at progress 0 is approved and must not change. Section 2 adds a woodland (path,
// trunks, ferns...) that would otherwise pop into that frame. So every Section 2 object lives
// inside <RevealGroup>, which is INVISIBLE at progress 0 and dissolves in (dithered, no alpha
// sorting) over the first REVEAL_END of global progress. Shadows switch on once the dissolve is
// mostly complete so no shadow pops either. Movement begins at progress 0 and the dissolve is
// finished by about 4.5 percent of scroll, so it reads as the forest thickening around the walker.
//
// PREWARM (new): the world is mounted about 90 frames after the hero starts rendering, while it is
// still invisible. A hidden object costs nothing, but it also means the GPU programs and textures are
// not created until the object is first drawn, which would be the first scroll tick: a visible hitch
// of 100 ms or more exactly when the walk starts. So after the world has finished mounting, the group
// is made "visible" in small batches for ONE frame each while REVEAL_UNIFORM is 0, so every fragment
// is discarded by the dither test and nothing reaches the screen. The renderer still compiles each
// program (in the real render pipeline: same render target, tone mapping, fog, light counts and
// shadow flags as the later draws, so the programs are cache hits afterwards) and uploads each
// texture, one batch per frame, so no single frame carries the whole cost.
//
// Why this is sound (and what it does not cover):
//   * Main pass: the dither test runs at the top of main(), before any shading, and with
//     uReveal = 0 the interleaved gradient noise is greater than 0 for every pixel, so all fragments
//     are discarded. No colour is written. No depth is written either, so depth of field and the
//     ambient occlusion pass (n8ao renders the beauty pass itself and reads that depth) see nothing.
//   * Frustum culling would skip anything outside the hero camera's view (most of the path is below the
//     hero frustum), and a skipped object never compiles. So frustumCulled is switched off for the
//     batch being warmed and restored straight after.
//   * Shadow pass: casters are NOT warmed. The sun's shadow map is shared with the hero receivers
//     (ground, trunk, cabin), and the shadow depth material is not discarded by the reveal dither, so a
//     warm frame would print the new casters' shadows onto the hero for a frame. castShadow therefore
//     stays false on every mesh until the dissolve is mostly in (reveal >= 0.6), exactly as before.
//     The only programs that remain to compile at that moment are the small depth variants (opaque,
//     instanced, alpha cut). To keep even that from landing in one frame, shadows are switched on in
//     batches of SHADOW_BATCH meshes per frame.
//   * Frames: the group is only warmed while progress is exactly 0 (reveal 0). If the visitor scrolls
//     away mid-warm, the warm up is aborted and every flag is restored in the same frame.
//
// The warm up waits until the world has stopped growing (staged components mount their parts over
// several frames), and runs again if more parts arrive later.
// ===========================================================================================

export const REVEAL_END = 0.045;

// Shared by every patched material (one uniform object, one writer).
export const REVEAL_UNIFORM = { value: 0 };

export function revealAmount(progress) {
  return THREE.MathUtils.smoothstep(progress, 0, REVEAL_END);
}

// Patch a material so it dissolves with a screen space ordered-dither threshold driven by
// REVEAL_UNIFORM. Safe to call on any three material, including ones that already use
// onBeforeCompile (foliage materials): the existing hook runs first. Call it ONCE per material,
// right after creating it. Returns the material for chaining.
export function makeRevealable(material) {
  if (material.userData.revealable) return material;
  material.userData.revealable = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous.call(material, shader, renderer);
    shader.uniforms.uReveal = REVEAL_UNIFORM;
    // Interleaved gradient noise (Jimenez): cheap, stable, evenly distributed 0..1 per pixel.
    const dither =
      "uniform float uReveal;\n" +
      "float revealNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n";
    shader.fragmentShader = dither + shader.fragmentShader.replace(
      /void main\(\)\s*\{/,
      "void main() {\n  if (uReveal < 0.999 && revealNoise(gl_FragCoord.xy) > uReveal) discard;\n",
    );
  };
  // The program cache must know a revealable variant differs from an identical plain material.
  material.customProgramCacheKey = () => (previousKey ? previousKey.call(material) : "") + "|reveal";
  return material;
}

// ----- tuning ---------------------------------------------------------------------------------------
const SHADOWS_ON_AT = 0.6; // reveal amount at which casters start to cast
const SHADOW_BATCH = 8; // meshes switched to casting per frame
const SCAN_EVERY = 4; // frames between scans of the group while it is still settling
const SCAN_EVERY_SETTLED = 30; // and once it has been warmed
const STABLE_SCANS = 3; // identical mesh counts in a row (SCAN_EVERY frames apart) = "finished mounting"
const WARM_BATCH_MESHES = 6; // top level objects are grouped until a batch holds about this many meshes

function countMeshes(object) {
  let n = 0;
  object.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) n += 1;
  });
  return n;
}

// Wrap EVERY Section 2 world object in this (the scene host already does for the approach scene).
// Invisible and costless at progress 0, dissolves in after, gates shadow casting until mostly in.
// `prewarm` (default true) turns the warm up off for groups that do not need it.
export function RevealGroup({ children, prewarm = true }) {
  const group = useRef(null);
  const st = useRef(null);
  if (st.current === null) {
    st.current = {
      frame: 0,
      meshCount: -1, // meshes seen at the last scan
      stableScans: 0, // consecutive scans with the same count
      warmedCount: -1, // mesh count the last completed warm up covered
      phase: "wait", // "wait" | "warm"
      batches: [], // arrays of top level objects, warmed one array per frame
      batchIndex: 0,
      saved: [], // [object, visible] for every top level object while warming
      cullSaved: [], // [mesh, frustumCulled] for the batch being warmed
      shadowsWanted: false,
      shadowQueue: [], // meshes still to switch on (authoredCastShadow true)
    };
  }

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const S = st.current;
    S.frame += 1;
    const reveal = revealAmount(scrollState.progress);
    REVEAL_UNIFORM.value = reveal;

    // ----- scan: record authored shadow flags, hold casters off, track mounting progress -------------------
    const settled =
      S.phase === "wait" && S.stableScans >= STABLE_SCANS && (!prewarm || reveal > 0 || S.warmedCount === S.meshCount);
    const scanEvery = settled ? SCAN_EVERY_SETTLED : SCAN_EVERY;
    if (S.frame % scanEvery === 1) {
      let count = 0;
      g.traverse((object) => {
        if (!object.isMesh) return;
        count += 1;
        if (object.userData.authoredCastShadow === undefined) {
          object.userData.authoredCastShadow = object.castShadow;
          // New mesh (a staged part just mounted): hold its shadow until the dissolve is mostly in.
          object.castShadow = false;
          if (S.shadowsWanted && object.userData.authoredCastShadow) S.shadowQueue.push(object);
        }
      });
      if (count === S.meshCount) S.stableScans += 1;
      else {
        S.meshCount = count;
        S.stableScans = 0;
      }
    }

    // ----- prewarm ----------------------------------------------------------------------------------------------
    if (
      S.phase === "wait" &&
      prewarm &&
      reveal === 0 &&
      S.meshCount > 0 &&
      S.stableScans >= STABLE_SCANS &&
      S.warmedCount !== S.meshCount
    ) {
      // The world has stopped growing and has not been warmed at this size: start. Group the top level
      // objects into batches of about WARM_BATCH_MESHES meshes (one batch is drawn per frame).
      S.phase = "warm";
      S.batchIndex = 0;
      S.saved = g.children.map((object) => [object, object.visible]);
      S.batches = [];
      let current = [];
      let meshes = 0;
      for (const object of g.children) {
        current.push(object);
        meshes += countMeshes(object);
        if (meshes >= WARM_BATCH_MESHES) {
          S.batches.push(current);
          current = [];
          meshes = 0;
        }
      }
      if (current.length > 0) S.batches.push(current);
    }
    if (S.phase === "warm") {
      // Undo the previous batch's temporary state first (culling), then either finish or set up the next.
      for (const [mesh, culled] of S.cullSaved) mesh.frustumCulled = culled;
      S.cullSaved.length = 0;
      if (reveal > 0 || S.batchIndex >= S.batches.length) {
        // Finished (or the visitor scrolled away): restore every flag in this same frame.
        for (const [object, visible] of S.saved) object.visible = visible;
        S.saved.length = 0;
        S.phase = "wait";
        S.warmedCount = reveal > 0 ? -1 : S.meshCount;
        S.batches = [];
      } else {
        const batch = S.batches[S.batchIndex++];
        // Only this batch's top level objects are drawn this frame; everything else is hidden.
        for (const [object] of S.saved) object.visible = batch.includes(object);
        for (const object of batch) {
          object.traverse((o) => {
            if (o.isMesh || o.isPoints || o.isLine) {
              S.cullSaved.push([o, o.frustumCulled]);
              o.frustumCulled = false; // compile even what the hero camera cannot see
            }
          });
        }
      }
    }

    // ----- visibility -----------------------------------------------------------------------------------------------
    // While warming the group is visible with REVEAL_UNIFORM at 0 (everything discarded). Otherwise it is
    // visible only once the dissolve has started.
    g.visible = S.phase === "warm" ? true : reveal > 0.0005;

    // ----- shadows ----------------------------------------------------------------------------------------------------
    const wantShadows = reveal >= SHADOWS_ON_AT && S.phase !== "warm";
    if (wantShadows !== S.shadowsWanted && g.visible) {
      S.shadowsWanted = wantShadows;
      S.shadowQueue.length = 0;
      g.traverse((object) => {
        if (!object.isMesh) return;
        if (object.userData.authoredCastShadow === undefined) object.userData.authoredCastShadow = object.castShadow;
        if (wantShadows) {
          if (object.userData.authoredCastShadow) S.shadowQueue.push(object); // enabled in batches below
        } else {
          object.castShadow = false;
        }
      });
    }
    if (S.shadowsWanted && S.shadowQueue.length > 0) {
      // Batched so the depth program variants compile over a few frames, not in one.
      const n = Math.min(SHADOW_BATCH, S.shadowQueue.length);
      for (let i = 0; i < n; i++) S.shadowQueue.pop().castShadow = true;
    }
  });

  return (
    <group ref={group} visible={false} name="approach:world">
      {children}
    </group>
  );
}
