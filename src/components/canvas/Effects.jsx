"use client";

import {
  Bloom,
  DepthOfField,
  EffectComposer,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

// Postprocessing stack applied to every scene: depth of field, soft bloom,
// filmic tone mapping, vignette and film grain.
export default function Effects() {
  return (
    // multisampling is off because SMAA handles edges; the composer needs a depth buffer for DoF.
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {/* Focus on the treehouse (~18 units from camera). Foreground leaves and far trees go soft. */}
      <DepthOfField
        worldFocusDistance={18}
        worldFocusRange={9}
        bokehScale={3.2}
        resolutionScale={0.5}
      />
      <Bloom
        mipmapBlur
        intensity={0.55}
        luminanceThreshold={0.78}
        luminanceSmoothing={0.25}
        radius={0.7}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette eskil={false} offset={0.22} darkness={0.5} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.3} />
      <SMAA />
    </EffectComposer>
  );
}
