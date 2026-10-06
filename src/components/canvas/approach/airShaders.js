// GLSL for the light shafts and the dust. Plain strings, no three.js import, so they can be read and tuned
// in one place. Both materials are ShaderMaterials made revealable by makeRevealable (reveal.js adds the
// dither discard at the top of main(), so keep the literal text `void main() {` in each fragment shader).
//
// Shared conventions: additive blending, depthWrite false, depth TEST on (trunks and ground hide them),
// fog:false but faded by the same exp(-(density * distance)^2) the scene fog uses, driven by uFogDensity.
// NOTE: pow(x, 2.0) is undefined for negative x in GLSL, so squares are written x * x.

// ===========================================================================================
// LIGHT SHAFTS
// ===========================================================================================
export const SHAFT_VERT = /* glsl */ `
  uniform vec3 uAxis;       // unit vector toward the sun: the long axis of every shaft
  uniform float uUnder;     // metres the quad reaches below the landing point (the ground hides it)
  attribute vec2 aCorner;   // x: -1 / +1 across, y: 0 at the ground end, 1 at the sky end
  attribute vec4 aBase;     // xyz landing point, w beam length
  attribute vec4 aShapeA;   // width, taper, seed, phase
  attribute vec4 aShapeB;   // period, gain, tint, streak frequency
  varying float vX;         // -1..1 across the beam
  varying float vAlong;     // distance along the beam over its length (0 at the landing point, 1 at the sky end)
  varying vec3 vWorld;
  varying vec4 vA;
  varying vec4 vB;

  void main() {
    float len = aBase.w;
    // Where on the axis this vertex sits: from uUnder below the ground to the full length.
    float d = mix(-uUnder, len, aCorner.y);
    vec3 axisPoint = aBase.xyz + uAxis * d;
    // Cylindrical billboard: the side vector is perpendicular to both the axis and the line of sight, so the
    // quad's normal (axis x side) is the camera direction with its axis component removed.
    vec3 toCam = cameraPosition - axisPoint;
    vec3 side = cross(uAxis, toCam);
    float sl = length(side);
    side = sl > 1e-3 ? side / sl : normalize(cross(uAxis, vec3(0.0, 0.0, 1.0)));
    float t = clamp(d / len, 0.0, 1.0);
    float halfWidth = 0.5 * aShapeA.x * mix(1.0, aShapeA.y, t);
    vec3 wp = axisPoint + side * (aCorner.x * halfWidth);
    vX = aCorner.x;
    vAlong = d / len;
    vWorld = wp;
    vA = aShapeA;
    vB = aShapeB;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

export const SHAFT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;   // overall amount, already scaled by haze and the sun's climb
  uniform float uFogDensity;
  uniform float uBreath;
  uniform vec2 uNear;        // camera distance (metres) where a shaft starts to appear and is fully there
  uniform vec3 uCream;
  uniform vec3 uWarm;
  varying float vX;
  varying float vAlong;
  varying vec3 vWorld;
  varying vec4 vA;
  varying vec4 vB;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec2(7.1, 3.7);
      a *= 0.5;
    }
    return s; // about 0.1 .. 0.9, mean 0.47
  }

  void main() {
    float seed = vA.z;
    float period = vB.x;
    float gain = vB.y;
    float tint = vB.z;
    float streakF = vB.w;
    float v = clamp(vAlong, 0.0, 1.0);

    // Ragged edges: the beam wanders sideways a little along its length and over time, so its sides are
    // never two straight lines.
    float wob = fbm(vec2(vAlong * 2.2 + seed * 9.0, uTime * 0.03 + seed * 4.0)) - 0.47;
    float across = 1.0 - abs(vX + wob * 0.55);
    // Soft profile: smoothly 0 at the edges, a broad core, no visible edge line.
    float prof = smoothstep(0.0, 0.8, clamp(across, 0.0, 1.0));
    prof *= prof;

    // Density streaks: stretched along the beam (high frequency across, low along), sliding up slowly, as if
    // light were cut into rods by the leaves and broke up in the mist. A second finer layer moves the other way.
    float n = fbm(vec2(vX * streakF + seed * 17.0, v * 2.0 - uTime * 0.018));
    float n2 = vnoise(vec2(vX * streakF * 2.7 - seed * 5.0 + uTime * 0.02, v * 3.4 + uTime * 0.04));
    // A slower patchiness along the length: the beam is cut into lit and dim stretches by the leaves above.
    float stretch = 0.55 + 0.9 * vnoise(vec2(vX * 0.9 + seed * 3.0, v * 2.6 - uTime * 0.02));
    float streak = smoothstep(0.28, 0.7, n) * (0.55 + 0.9 * n2) * stretch;

    // Brighter where it meets the ground, faint where it enters the canopy. The top edge is ragged (the
    // canopy gap is not a clean cut) and the foot dissolves into the floor.
    float topFade = 1.0 - smoothstep(0.38 + 0.25 * n, 1.0, v);
    float groundGain = mix(1.5, 0.45, smoothstep(0.0, 0.9, v));
    float foot = smoothstep(-0.02, 0.05, vAlong);

    // Slow waves travelling up the beam (dust drifting through the light) and a canopy flicker.
    float wave = 0.82 + 0.18 * sin(v * 9.0 - uTime * 0.45 + seed * 20.0);
    float flick = 0.78 + 0.22 * vnoise(vec2(uTime * 0.35 + seed * 31.0, v * 2.0));
    float breath = 1.0 + uBreath * sin(6.2831853 * uTime / period + vA.w);

    // Distance: dissolve when the lens is close (never a wall in the face) and fade into the mist far away.
    float dist = distance(vWorld, cameraPosition);
    float nearF = smoothstep(uNear.x, uNear.y, dist);
    float fd = dist * uFogDensity;
    float farF = exp(-fd * fd);

    float a = prof * streak * topFade * groundGain * foot * wave * flick * breath * gain * nearF * farF * uStrength;
    gl_FragColor = vec4(mix(uCream, uWarm, tint), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ===========================================================================================
// DUST, POLLEN, MIDGES AND SEEDS (one Points object, see airDust.js for the four kinds)
// ===========================================================================================
export function dustVert(shaftCount) {
  return /* glsl */ `
  uniform float uTime;
  uniform float uViewPx;        // drawing buffer height in pixels
  uniform float uDpr;
  uniform float uMinPx;
  uniform float uFogDensity;
  uniform float uHaze;          // overall visibility (thinner fog and a higher sun make motes fainter)
  uniform float uBreath;
  uniform float uFreeBright;
  uniform float uBeamBright;
  uniform vec3 uCenter;         // centre of the wrap volume (follows the walker)
  uniform vec3 uBoxSize;
  uniform vec3 uAxis;           // unit vector toward the sun
  uniform vec4 uShaftBase[${shaftCount}];   // xyz landing point, w length
  uniform vec4 uShaftDim[${shaftCount}];    // width, taper
  uniform vec4 uShaftAnim[${shaftCount}];   // period, phase, gain
  attribute vec4 aKind;         // x kind, y shaft, z start along the beam, w radial fraction / swarm radius
  attribute vec4 aSeed;         // x phase, y speed multiplier, z world size, w twinkle rate
  varying float vBright;
  varying float vAlpha;
  varying float vSoft;

  // How much of a shaft's light the point p sits in (0 outside every shaft, up to the shaft's gain at its core).
  float beamAt(vec3 p) {
    float best = 0.0;
    for (int i = 0; i < ${shaftCount}; i++) {
      vec3 rel = p - uShaftBase[i].xyz;
      float al = dot(rel, uAxis);
      float t01 = al / uShaftBase[i].w;
      float perp = length(rel - al * uAxis);
      float hw = 0.5 * uShaftDim[i].x * mix(1.0, uShaftDim[i].y, clamp(t01, 0.0, 1.0));
      float inside = (1.0 - smoothstep(0.35, 1.0, perp / hw)) * smoothstep(-0.04, 0.08, t01) * (1.0 - smoothstep(0.55, 1.0, t01));
      float breath = 1.0 + uBreath * sin(6.2831853 * uTime / uShaftAnim[i].x + uShaftAnim[i].y);
      best = max(best, inside * breath * uShaftAnim[i].z);
    }
    return best;
  }

  void main() {
    float kind = aKind.x;
    float ph = aSeed.x;
    float size = aSeed.z;
    vec3 p;
    float beam = 0.0;
    float edge = 1.0;
    float baseB = uFreeBright;
    float flicker = 1.0;
    vSoft = 0.0;

    if (kind < 0.5 || kind > 2.5) {
      // FREE DUST (kind 0) and SEEDS (kind 3): world fixed motes that wrap around the walker. The wrap is a
      // mod into a box centred on uCenter, so as the camera walks, motes leaving the back reappear at the front
      // (faded at every face, so the wrap is never seen).
      vec3 vel;
      float wobAmp = 0.35;
      if (kind < 0.5) {
        vel = vec3(0.035 + 0.05 * sin(ph * 3.1), 0.045 + 0.05 * (0.5 + 0.5 * sin(ph * 1.7)), 0.05 * cos(ph * 2.3)) * aSeed.y;
      } else {
        // A seed: a slow fall with a wide lazy spiral.
        vel = vec3(0.03 * sin(ph * 2.0), -0.045 - 0.03 * aSeed.y, 0.03 * cos(ph * 2.7));
        wobAmp = 0.7;
        baseB = 0.9;
        vSoft = 1.0;
      }
      vec3 hb = uBoxSize * 0.5;
      vec3 rel = mod(position + vel * uTime - uCenter + hb, uBoxSize) - hb;
      vec3 wob = vec3(sin(uTime * 0.31 + ph), 0.5 * sin(uTime * 0.23 + ph * 1.7), cos(uTime * 0.27 + ph * 1.3)) * wobAmp;
      p = uCenter + rel + wob;
      vec3 l = (rel + hb) / uBoxSize;
      vec3 e = smoothstep(vec3(0.0), vec3(0.07), l) * (1.0 - smoothstep(vec3(0.93), vec3(1.0), l));
      edge = e.x * e.y * e.z;
      if (kind < 0.5) beam = beamAt(p);
    } else if (kind < 1.5) {
      // BEAM MOTE: bound to shaft k, drifting up its length and swirling slowly around its axis, so a shaft
      // always holds a column of glinting motes (denser where the shaft is fatter and longer).
      int k = int(aKind.y + 0.5);
      vec4 sb = uShaftBase[k];
      vec4 sd = uShaftDim[k];
      vec4 sa = uShaftAnim[k];
      float u = fract(aKind.z + uTime * (0.007 + 0.009 * aSeed.y));
      float hw = 0.5 * sd.x * mix(1.0, sd.y, u);
      float ang = ph + uTime * 0.12 * (aSeed.y - 0.9);
      vec3 e1 = normalize(cross(uAxis, vec3(0.0, 1.0, 0.0)));
      vec3 e2 = cross(uAxis, e1);
      vec3 off = (e1 * cos(ang) + e2 * sin(ang)) * aKind.w * hw;
      vec3 wob = vec3(sin(uTime * 0.4 + ph), sin(uTime * 0.33 + ph * 1.9), cos(uTime * 0.37 + ph * 1.3)) * 0.1;
      p = sb.xyz + uAxis * (u * sb.w) + off + wob;
      float breath = 1.0 + uBreath * sin(6.2831853 * uTime / sa.x + sa.y);
      // Brightest on the axis, fading toward the sides, in at the foot and out toward the sky end.
      beam = (1.0 - smoothstep(0.45, 1.0, aKind.w)) * smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.55, 1.0, u)) * breath * sa.z;
    } else {
      // MIDGE: a tiny insect circling its anchor (position) in a quick, tight Lissajous, flashing as it turns.
      float r = 0.25 + 0.4 * aKind.w;
      float sp = 1.0 + aSeed.y;
      p = position + vec3(sin(uTime * 1.3 * sp + ph), 0.5 * sin(uTime * 1.9 * sp + ph * 1.7), cos(uTime * 1.1 * sp + ph * 2.3)) * r;
      flicker = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * (22.0 + aSeed.w * 14.0) + ph * 3.0));
      baseB = 0.75;
    }

    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;

    // World size to pixels: pixels = size * (H / 2) / (tan(fov / 2) * dist), and projectionMatrix[1][1] = 1 / tan(fov / 2).
    float px = size * uViewPx * projectionMatrix[1][1] * 0.5 / max(dist, 0.1);
    float minPx = uMinPx * uDpr;
    gl_PointSize = max(px, minPx);
    // A sprite clamped up to the minimum size is dimmed by the coverage it does not really have.
    float coverage = clamp(px / minPx, 0.3, 1.0);

    float tw = 0.65 + 0.35 * sin(uTime * aSeed.w + ph * 5.0);
    vBright = (baseB + uBeamBright * beam) * tw * flicker;

    float fd = dist * uFogDensity;
    float farFade = exp(-fd * fd);
    float nearFade = smoothstep(0.5, 1.5, dist) * (0.4 + 0.6 * smoothstep(0.8, 4.0, dist));
    vAlpha = edge * coverage * farFade * nearFade * uHaze;
  }
`;
}

export const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vBright;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    // Soft round sprite: a bright core inside a quick falloff (seeds are softer and wider).
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), mix(2.0, 1.4, vSoft));
    gl_FragColor = vec4(uColor * vBright, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
