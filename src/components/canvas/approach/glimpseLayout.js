import { TREE, groundHeight, trunkRadiusAt } from "@/lib/sceneConfig";
import { CLOSE_TRUNKS, EYE_HEIGHT, EYE_HEIGHT_END, GLIMPSES, MID_TRUNKS, TREEHOUSE_CENTER, atPath } from "@/lib/sections/world";
import { growPlant, plantPrimitives } from "./glimpsePlants";
import { buildSilhouetteSamples, bundleTau, heroCrownTau, HERO_CROWN, visibleFraction } from "./glimpseVisibility";

// ===========================================================================================
// TREEHOUSE GLIMPSE: where the plants stand, and how to measure what they hide.
//
// PLAN is the baked result of an offline optimisation (a simulated annealing run in node against
// the evaluator in glimpseVisibility.js, over the real leaf clusters that glimpsePlants.js grows).
// It is plain data, so the layout is identical on every load and nothing is script placed at runtime.
// Re-run the optimiser if the path, the sign positions, the cabin or the rig's weave change: the
// evaluateGlimpse() helper below (also handy from the browser console in dev) reports how the plan
// scores against GLIMPSES.
//
// The walker. approach.js (the rig) imports this scene lazily, so importing it here would be circular:
// the weave and the eye height are mirrored below. If the rig's WEAVE_*, S_END or eyeHeight change,
// change them here and re-solve.
// ===========================================================================================

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const WALK = {
  weaveAmplitude: 0.4,
  weaveWavelength: 0.42,
  weaveStartRamp: 0.04,
  weaveFadeFrom: 0.76,
  sEnd: 0.94,
  riseEndS: 0.14,
  heroEye: 0.9, // CAMERA.position[1]
};

export function weaveLateral(s) {
  const envelope = smooth(0, WALK.weaveStartRamp, s) * (1 - smooth(WALK.weaveFadeFrom, WALK.sEnd, s));
  return WALK.weaveAmplitude * Math.sin((TAU * s) / WALK.weaveWavelength) * envelope;
}

function eyeHeight(s) {
  const walking = WALK.heroEye + (EYE_HEIGHT - WALK.heroEye) * smooth(0, WALK.riseEndS, s);
  return walking + (EYE_HEIGHT_END - EYE_HEIGHT) * smooth(0.45, WALK.sEnd, s);
}

// Eye position [x, y, z] at path fraction s. `extra` is an additional sideways offset in metres (the
// real camera follows weaveLateral exactly; extra is for robustness tests).
export function eyeAt(s, extra = 0) {
  const p = atPath(s, weaveLateral(s) + extra);
  return [p.x, p.y + eyeHeight(s), p.z];
}

// ----- occluders the glimpse layer does not draw ---------------------------------------------------------
// The close and mid trunks (their real shape is built by Trunks.jsx; here they are leaning tapered
// capsules, close enough for a ray test) and the hero trunk. They are fixed: the optimiser solves around
// them.
function trunkCapsules(out) {
  const add = (x, z, r, lean, h) => {
    const y0 = groundHeight(x, z);
    const seg = 4;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * h;
      const b = ((i + 1) / seg) * h;
      const ra = r * (1.04 - (0.26 * a) / 22);
      const rb = r * (1.04 - (0.26 * b) / 22);
      out.push(x + lean[0] * a, y0 + a, z + lean[1] * a, x + lean[0] * b, y0 + b, z + lean[1] * b, 0.5 * (ra + rb));
    }
  };
  for (const c of CLOSE_TRUNKS) {
    const p = atPath(c.s, c.lateral);
    add(p.x, p.z, c.r, c.lean, 16);
  }
  for (const t of MID_TRUNKS) add(t.x, t.z, t.r, t.lean, 16);
  // hero trunk: radius from trunkRadiusAt, nearly vertical
  for (let i = 0; i < 6; i++) {
    const a = i * 3;
    const b = a + 3;
    out.push(TREE.x, a, TREE.z, TREE.x, b, TREE.z, trunkRadiusAt((a + b) / 2));
  }
  return out;
}
export const FIXED_CAPSULES = Float64Array.from(trunkCapsules([]));
export const CROWN = { centre: [TREE.x, 14.5, TREE.z], radius: HERO_CROWN.radius, rho: HERO_CROWN.rho };

// ----- the plan ---------------------------------------------------------------------------------------------
// Specs for growPlant (see glimpsePlants.js). `top` is the crown top or stem tip in world metres,
// `offset` the horizontal vector from the base to it (the lean). Filled in by the offline solver.
export const PLAN = [
  { id: "hazel0", kind: "hazel", seed: 51562, top: [0.112, 5.998, 4.229], offset: [0.65, 0.81], sway: 0, spread: 0.669, stems: 4, perStem: 3, size: [1.161, 1.508] },
  { id: "hazel1", kind: "hazel", seed: 31391, top: [1.431, 6.33, 10.647], offset: [-0.853, 0.234], sway: 0, spread: 4.125, stems: 4, perStem: 3, size: [1.166, 1.137] },
  { id: "hazel2", kind: "hazel", seed: 1100, top: [2.593, 5.003, 2.797], offset: [-1.284, -0.201], sway: 1, spread: 0.378, stems: 4, perStem: 3, size: [1.334, 0.562] },
  { id: "sapling3", kind: "sapling", seed: 13076, top: [2.451, 5.76, 7.998], offset: [-0.549, -0.74], sway: 1, species: "beech", r0: 0.041, branches: 4, size: [1.012, 2.09] },
  { id: "sapling4", kind: "sapling", seed: 45222, top: [1.504, 5.694, 6.727], offset: [-0.191, -1.949], sway: 1, species: "oak", r0: 0.067, branches: 4, size: [0.69, 1.33] },
  { id: "sapling5", kind: "sapling", seed: 62576, top: [3.429, 5.54, 5.623], offset: [-0.596, 0.544], sway: 0, species: "beech", r0: 0.071, branches: 4, size: [0.693, 1.178] },
  { id: "sapling6", kind: "sapling", seed: 20262, top: [4.07, 6.296, 4.487], offset: [-1.324, -1.499], sway: 0, species: "beech", r0: 0.061, branches: 4, size: [1.377, 1.602] },
  { id: "holly7", kind: "holly", seed: 5073, top: [1.432, 3.467, 11.243], offset: [-0.527, 1.187], sway: 1, spread: 0.796, layers: 4, size: [0.396, 1.638] },
  { id: "snag8", kind: "snag", seed: 17143, top: [0.634, 5.554, 5.085], offset: [0.677, 1.672], sway: 0, r0: 0.119, stubs: 3, vine: "bramble", turns: 2.2, drapes: 2, size: [0.189, 1.018] },
  { id: "snag9", kind: "snag", seed: 84391, top: [-1.544, 6.211, 4.137], offset: [-0.497, 0.632], sway: 0, r0: 0.024, stubs: 3, vine: "honey", turns: 2.2, drapes: 2, size: [0.579, 0.326] },
];

// ----- measuring ----------------------------------------------------------------------------------------------
// Grows the plan (or any list of specs) once. Returns the plants.
export function growPlan(specs = PLAN) {
  return specs.map(growPlant);
}

export function planPrimitives(plants) {
  const spheres = [];
  const capsules = [];
  for (const p of plants) plantPrimitives(p, spheres, capsules);
  return { spheres: Float64Array.from(spheres), capsules: Float64Array.from(capsules) };
}

// Visible fraction of the cabin silhouette at path fraction s.
//   plants  grown plan; extra  sideways offset from the real weave; crown  include the hero crown guess
export function visibilityAt(s, prims, { extra = 0, crown = true, fixed = true } = {}) {
  const eye = eyeAt(s, extra);
  const samples = buildSilhouetteSamples(eye, [TREEHOUSE_CENTER.x, TREEHOUSE_CENTER.y, TREEHOUSE_CENTER.z]);
  const tau = bundleTau(eye, samples, prims.spheres, prims.capsules);
  const fixedTau = fixed ? bundleTau(eye, samples, null, FIXED_CAPSULES) : null;
  const crownTau = crown ? heroCrownTau(eye, samples, CROWN) : null;
  const extraTau = new Float64Array(tau.length);
  for (let i = 0; i < tau.length; i++) extraTau[i] = (fixedTau ? fixedTau[i] : 0) + (crownTau ? crownTau[i] : 0);
  return visibleFraction(tau, extraTau);
}

// Target vs achieved at the five GLIMPSES (the mean over the +-0.012 hold the rig keeps the gaze up for).
export function evaluateGlimpse(plants = growPlan(), opts = {}) {
  const prims = planPrimitives(plants);
  return GLIMPSES.map((g) => {
    let sum = 0;
    let n = 0;
    for (let s = g.s - 0.012; s <= g.s + 0.0121; s += 0.002) {
      sum += visibilityAt(Math.min(0.94, s), prims, opts);
      n++;
    }
    return { s: g.s, target: g.visible, achieved: sum / n };
  });
}
