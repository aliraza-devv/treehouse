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

// Wrap EVERY Section 2 world object in this (the scene host already does for the approach scene).
// Invisible and costless at progress 0, dissolves in after, gates shadow casting until mostly in.
export function RevealGroup({ children }) {
  const group = useRef(null);
  const shadowsOn = useRef(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const reveal = revealAmount(scrollState.progress);
    REVEAL_UNIFORM.value = reveal;
    g.visible = reveal > 0.0005;
    const wantShadows = reveal >= 0.6;
    if (wantShadows !== shadowsOn.current && g.visible) {
      shadowsOn.current = wantShadows;
      g.traverse((object) => {
        if (!object.isMesh) return;
        if (object.userData.authoredCastShadow === undefined) object.userData.authoredCastShadow = object.castShadow;
        object.castShadow = wantShadows && object.userData.authoredCastShadow;
      });
    }
  });
  return (
    <group ref={group} visible={false} name="approach:world">
      {children}
    </group>
  );
}
