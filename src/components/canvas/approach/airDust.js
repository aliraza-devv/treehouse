import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { atPath } from "@/lib/sections/world";
import { DUST } from "./airTuning";

// Dust, pollen, midges and seeds: the plan and the GEOMETRY of one Points object (pure three.js, no React). The
// motion is all in the vertex shader (airShaders.js), so the CPU never touches the points after this.
//
// Four kinds share one geometry and one draw call, told apart by aKind.x:
//   0  free dust    wraps around the walker, drifts lazily, nearly invisible until it crosses a shaft
//   1  beam mote    bound to one shaft: lives in its volume, drifts slowly up it, glints where the beam is
//   2  midge        a tiny insect hovering in a small swarm near the path, flickers as it turns in the light
//   3  seed         a pale, slightly larger drifting seed that falls slowly (wraps around the walker too)
//
// Attributes: position (home position, or the swarm anchor for midges), aKind (x kind, y shaft index,
// z start along the beam 0..1, w radial fraction 0..1 for beam motes or swarm radius for midges),
// aSeed (x phase, y speed multiplier, z world size in metres, w twinkle rate).
export function buildDustGeometry(shaftPlan) {
  const rng = createRng(DUST.seed);
  const pos = [];
  const kind = [];
  const seed = [];
  const push = (p, k, size) => {
    pos.push(p[0], p[1], p[2]);
    kind.push(...k);
    seed.push(rng() * Math.PI * 2, range(rng, 0.6, 1.5), size, range(rng, 0.6, 1.8));
  };
  const size = () => range(rng, DUST.size[0], DUST.size[1]);

  // Beam motes: shared out by shaft volume (width x length), so a fat long shaft holds more than a thin short one.
  const volume = shaftPlan.map(({ def }) => def.width * def.length);
  const totalVolume = volume.reduce((a, b) => a + b, 0);
  let assigned = 0;
  shaftPlan.forEach(({ landing }, i) => {
    const n = i === shaftPlan.length - 1 ? DUST.inBeam - assigned : Math.round((DUST.inBeam * volume[i]) / totalVolume);
    assigned += n;
    for (let k = 0; k < n; k++) {
      // sqrt of a uniform number spreads the motes evenly over the cross section disc.
      push(landing, [1, i, rng(), Math.sqrt(rng()) * 0.95], size());
    }
  });

  // Free dust: anywhere over the corridor (the wrap volume moves it into view around the walker).
  for (let k = 0; k < DUST.free; k++) {
    push([range(rng, -9, 11), range(rng, DUST.boxY0, DUST.boxY0 + DUST.box[1]), range(rng, 0, 18)], [0, 0, 0, 0], size());
  }

  // Midges: three small swarms hovering over the path at head height, each insect circling its own anchor.
  const swarms = [
    { s: 0.28, lateral: -1.2 },
    { s: 0.52, lateral: 1.5 },
    { s: 0.7, lateral: -1.8 },
  ];
  for (let k = 0; k < DUST.midges; k++) {
    const sw = swarms[k % swarms.length];
    const c = atPath(sw.s + range(rng, -0.01, 0.01), sw.lateral + range(rng, -0.25, 0.25));
    push([c.x, c.y + range(rng, 1.1, 2.3), c.z], [2, 0, 0, range(rng, 0.2, 0.9)], range(rng, 0.014, 0.024));
  }

  // Seeds: pale, larger, falling slowly.
  for (let k = 0; k < DUST.seeds; k++) {
    push([range(rng, -9, 11), range(rng, DUST.boxY0, DUST.boxY0 + DUST.box[1]), range(rng, 0, 18)], [3, 0, 0, 0], range(rng, DUST.seedSize[0], DUST.seedSize[1]));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 4));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 4));
  return g;
}
