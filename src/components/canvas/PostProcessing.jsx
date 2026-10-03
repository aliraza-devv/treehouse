"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Uniform, Vector2, Vector3 } from "three";
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
  wrapEffect,
} from "@react-three/postprocessing";
import { BlendFunction, Effect, ToneMappingMode } from "postprocessing";
import { PALETTE, TREE } from "@/lib/sceneConfig";

// ---------------------------------------------------------------------------
// Photographic post stack. Order matters, and each stage is placed where it happens in a lens
// and sensor, so the image reads as photographed rather than rendered:
//
//   0. N8AO ambient occlusion  scene-referred contact shadow under the deck, at the trunk base
//                              and inside foliage. Runs first because AO is a property of the
//                              light in the scene, before any lens effect touches the image.
//   1. Depth of field          the wide aperture. Focus sits on the treehouse, so foreground
//                              leaves and the far tree line melt into bokeh.
//   2. Bloom (mipmap blur)     halation and sun glow. High threshold: only the sun shafts,
//                              lantern glass and bright motes bleed.
//   3. Chromatic aberration    very faint lateral colour fringing, strongest at the corners
//                              (radial), the signature of real glass. Still linear HDR.
//   4. Tone mapping (AgX)      HDR scene to a display range with a filmic shoulder. AgX keeps
//                              saturated sunlit greens from clipping to neon, unlike ACES.
//   5. Colour grade (custom)   split toning, a touch of lift, slight desaturation.
//   6. Vignette                lens falloff.
//   7. Film grain              AFTER tone mapping, because grain lives on the sensor/film and
//                              must not be compressed by the tone curve.
//   8. SMAA                    last, so it also smooths edges created by earlier effects.
//
// multisampling is 0 everywhere: hardware MSAA cannot be combined with a depth texture, and DoF
// and AO both need the scene depth. SMAA replaces it. The composer's depth buffer is the one
// the scene render writes, and alpha tested foliage (discard in the fragment shader) leaves no
// depth where the leaf card is cut away, so the DoF circle of confusion follows the real leaf
// silhouettes, not the card rectangles.
// ---------------------------------------------------------------------------

// Exposure is a renderer property (three's tonemapping chunk multiplies by toneMappingExposure
// before the AgX curve). Scene.jsx passes it to the renderer. Raise it if renders look dim.
export const EXPOSURE = 0.92;

// Set false to drop the AO pass entirely if it ever misbehaves on a device.
const ENABLE_AO = true;

// ---------------------------------------------------------------------------
// Custom grade effect: split toning (warm highlights, cool shadows), lifted blacks, mild
// saturation. It runs after tone mapping, on the display-referred (still linear) image.
//
// The weights are computed from perceptual luma, pow(luma, 1 / 2.2), because linear luma crams
// almost everything we perceive as "shadow" into a tiny range near zero. Tints are multipliers
// around 1.0 that mostly preserve luminance (the channel gains average to about 1), so the grade
// shifts hue without changing exposure.
// ---------------------------------------------------------------------------
const GRADE_FRAGMENT = /* glsl */ `
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uStrength;
  uniform float uLift;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uSunBias;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;

    // Contrast: an S-curve about a perceptual mid pivot (0.42), applied in gamma space so the
    // pivot is a visual mid grey. This is what separates the cabin and trunks from the haze;
    // AgX alone leaves a flat, milky frame.
    vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
    g = clamp(0.42 + (g - 0.42) * uContrast, 0.0, 1.0);
    c = pow(g, vec3(2.2));

    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));

    // Perceptual luma in [0,1] drives the two tone zones.
    float perceptual = pow(max(luma, 0.0), 1.0 / 2.2);
    float shadowWeight = 1.0 - smoothstep(0.0, 0.5, perceptual);
    float highlightWeight = smoothstep(0.35, 0.95, perceptual);

    // Saturation around the pixel's own luma. Above 1 recovers the brand greens and timbers
    // that the fog and tone curve wash toward grey.
    c = mix(vec3(luma), c, uSaturation);

    // Lifted blacks, tinted cool: raises the floor only where the image is dark.
    c += uLift * (1.0 - c) * uShadowTint;

    // Split toning.
    c = mix(c, c * uShadowTint, shadowWeight * uStrength);
    c = mix(c, c * uHighlightTint, highlightWeight * uStrength);

    // Screen-space light direction: the sun is upper right and behind the tree, so the mist
    // glows warm toward the upper right and stays cool teal toward the lower left. This puts a
    // visible light source into a frame that otherwise has none. Weighted to mid and high tones
    // so shadows are not tinted orange.
    vec2 toSun = uv - vec2(0.78, 0.9);
    float sunSide = exp(-dot(toSun, toSun) * 2.6);
    float coolSide = smoothstep(0.55, 0.0, uv.x * 0.6 + uv.y * 0.4);
    float bias = (0.35 + 0.65 * smoothstep(0.2, 0.7, perceptual)) * uSunBias;
    c *= mix(vec3(1.0), vec3(1.10, 1.015, 0.82), sunSide * bias);
    c *= mix(vec3(1.0), vec3(0.95, 1.0, 1.05), coolSide * uSunBias);

    outputColor = vec4(max(c, 0.0), inputColor.a);
  }
`;

class ColorGradeEffect extends Effect {
  constructor({
    blendFunction = BlendFunction.NORMAL,
    // Teal-leaning shadows: red down, green and blue up. Gains average about 1.0.
    shadowTint = [0.95, 1.005, 1.05],
    // Orange-leaning highlights: red up, blue down.
    highlightTint = [1.14, 1.0, 0.86],
    strength = 0.9, // overall amount of the split tone, 0 to 1
    lift = 0.0, // no black lift: the fog already lifts the frame, more lift reads milky
    saturation = 1.12, // 1 = unchanged, above 1 restores the brand greens and timbers
    contrast = 1.15, // S-curve slope about the 0.42 perceptual pivot
    sunBias = 0.8, // strength of the screen-space warm (sun side) and cool (far side) bias
  } = {}) {
    super("ColorGradeEffect", GRADE_FRAGMENT, {
      blendFunction,
      uniforms: new Map([
        ["uShadowTint", new Uniform(new Vector3(...shadowTint))],
        ["uHighlightTint", new Uniform(new Vector3(...highlightTint))],
        ["uStrength", new Uniform(strength)],
        ["uLift", new Uniform(lift)],
        ["uSaturation", new Uniform(saturation)],
        ["uContrast", new Uniform(contrast)],
        ["uSunBias", new Uniform(sunBias)],
      ]),
    });
  }
}

const ColorGrade = wrapEffect(ColorGradeEffect);

// Radial chromatic aberration offset: about 0.4 px at 1080p corners. With radialModulation the
// centre of the frame stays perfectly clean.
const CA_OFFSET = new Vector2(0.0005, 0.0006);

// Bokeh radius in DoF texels at full circle of confusion, for a 1440 px wide buffer.
const BOKEH_SCALE = 6.5;

// Centre of the cabin (TREE.x + CAB.cx, platform height + about 1.3, deck z). The DoF focus
// distance is the distance to this point from the live camera (the CoC shader uses radial distance), so the treehouse is the
// sharp plane in every pose (landscape about 16.6, portrait about 19.9 after the dolly back).
const CABIN_CENTER = new Vector3(TREE.x + 2.5, TREE.platformY + 1.3, 0.7);
const _toCabin = new Vector3();

export default function PostProcessing() {
  const dof = useRef(null);
  const ao = useRef(null);

  // N8AO auto-detects transparent materials (mist, beams, motes, glass) and then re-renders all
  // of them into two extra full-resolution targets every frame. Our soft sheets must not occlude
  // anything, so switch that off. Both flags are needed: the proxy only flips autoDetect when
  // the configuration value actually changes.
  useLayoutEffect(() => {
    if (ao.current) {
      ao.current.autoDetectTransparency = false;
      ao.current.configuration.transparencyAware = false;
    }
  }, []);

  // Keep focus on the cabin through the portrait dolly and the idle sway, and scale the blur with
  // the drawing buffer. The bokeh radius is in pixels, so a fixed 6.5 that is a gentle 0.5 percent
  // of the width on a 1440 px desktop would be 2 percent of a 390 px phone and turn the whole
  // frame to mush. Scaling by buffer width keeps the same look on every screen.
  const lastScale = useRef(-1);
  useFrame((state) => {
    const effect = dof.current;
    if (!effect) return;
    const bufferW = state.size.width * state.gl.getPixelRatio();
    const scale = Math.min(BOKEH_SCALE, Math.max(2, (BOKEH_SCALE * bufferW) / 1440));
    if (Math.abs(scale - lastScale.current) > 0.05) {
      effect.bokehScale = scale;
      lastScale.current = scale;
    }
    const cam = state.camera;
    _toCabin.copy(CABIN_CENTER).sub(cam.position);
    effect.circleOfConfusionMaterial.focusDistance = Math.max(4, _toCabin.length());
  });

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {/* 0. Ambient occlusion. World radius 1.6 m catches deck undersides, branch joins and the
          trunk flare. Half resolution with depth aware upsampling keeps it cheap. gammaCorrection
          is applied only on the last pass (n8ao decides from renderToScreen), so it stays linear
          here. The AO colour is the deep forest floor tone, so occluded areas go cool and dark
          rather than dirty black. */}
      {ENABLE_AO && (
        <N8AO
          ref={ao}
          quality="medium"
          halfRes
          aoRadius={1.6}
          distanceFalloff={1}
          intensity={2.2}
          color={PALETTE.floorDark}
        />
      )}

      {/* 1. Depth of field. The CoC shader measures RADIAL distance from the camera in world
          units, and the focus distance is re-aimed at the cabin every frame (see above), so the
          treehouse is sharp in landscape and in the portrait pose. The initial 16.4 is only
          the first-frame value. Range 9 keeps cabin and trunk crisp (a 2 m depth error is only 12 percent
          of the blur, about 1 px), while foreground leaves (3 to 5 m) and
          everything past about 25 m fall to the full circle of confusion. The blur radius is
          bokehScale TEXELS of the DoF target at full CoC (the shader steps texelSize * CoC *
          scale), so 6.5 at 0.75 resolution is about an 8 px radius at 1080p: a real wide-aperture
          blur. The earlier 2.2 was a 3 px radius, which left foreground leaves almost sharp. The
          fill pass (max filter) closes the gaps a 64 tap kernel leaves at this radius, and the
          fern fronds are painted with overlapping, shallowly notched pinnae so the larger discs
          have no see-through gaps to turn into bright dots. */}
      <DepthOfField
        ref={dof}
        worldFocusDistance={16.4}
        worldFocusRange={9}
        bokehScale={BOKEH_SCALE}
        resolutionScale={0.75}
      />

      {/* 2. Bloom. Threshold 0.85 on linear HDR, so only values that exceed display white (sun
          shafts, warm lantern light, bright motes) glow. The soft knee (smoothing 0.3) avoids a
          hard cutoff. Intensity 0.2 is a halation veil, not a glow filter. */}
      <Bloom
        mipmapBlur
        luminanceThreshold={0.85}
        luminanceSmoothing={0.3}
        intensity={0.32}
        radius={0.8}
      />

      {/* 3. Chromatic aberration, radial and tiny. */}
      <ChromaticAberration
        offset={CA_OFFSET}
        radialModulation
        modulationOffset={0.35}
        blendFunction={BlendFunction.NORMAL}
      />

      {/* 4. Filmic tone mapping. AgX with renderer exposure (see EXPOSURE). */}
      <ToneMapping mode={ToneMappingMode.AGX} />

      {/* 5. Split tone grade, applied right after tone mapping, before vignette and grain so
          those two sit on top of the finished colour like a lens and film would. */}
      <ColorGrade />

      {/* 6. Vignette: offset 0.3 starts the falloff at 30 percent from centre, darkness 0.6. */}
      <Vignette eskil={false} offset={0.3} darkness={0.6} />

      {/* 7. Film grain after tone mapping. OVERLAY at 0.07 (not premultiplied) keeps a
          measurable amplitude of about 2 to 3 levels on flat mist, which is what visible grain
          needs. Soft light with premultiply left under one level, so the mist read as clean CG. */}
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.07} />

      {/* 8. Anti-aliasing last. */}
      <SMAA />
    </EffectComposer>
  );
}
