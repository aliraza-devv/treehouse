import * as THREE from "three";
import { CAMERA } from "@/lib/sceneConfig";
import { getRigPose } from "@/hooks/useIdle";

// ===========================================================================================
// THE GLOBAL CAMERA PATH
//
// Every section contributes a list of KEYFRAMES { position, lookAt, roll, fov } (see
// src/lib/sections/README.md). This file joins them into ONE curve for the whole page:
//
//   position : THREE.CatmullRomCurve3 (centripetal) through every keyframe position
//   lookAt   : a second CatmullRomCurve3 through every keyframe look-at target
//   roll,fov : smooth C1 scalar splines (uniform Catmull-Rom) through the keyframe values
//
// All four share ONE parameter, the keyframe index space x in [0, n - 1] (keyframe i sits at
// x = i). Because it is a single curve, tangents are continuous across section boundaries (no
// linear jump, no kink where one section hands over to the next).
//
// Section ranges: a section owns the index range [i0, i1] of the joined keyframe list. A section
// whose first keyframe equals the previous section's last SHARES that keyframe (i0 = previous
// i1), which is exactly what the END_POSE style continuity rule guarantees.
//
// PACE: a section's `camera.pace(local)` maps its local scroll progress 0..1 to q in 0..1, the
// fraction of the section's index range [i0, i1] already walked. So the camera is at index
//   x = i0 + q * (i1 - i0)
// Keyframes should therefore be spaced evenly in WALKED DISTANCE (the approach section places one
// every 0.02 of the path, about 0.28 m), then q is simply "fraction of the walk done" and a pace
// function is a plain speed profile. See makePace() for the helper that turns a speed profile
// into a pace function.
//
// PORTRAIT: keyframe fov values are LANDSCAPE values (what you would use at 16:9). The path adds
// the hero's portrait widening (up to +12 degrees at aspect 0.45, see getRigPose) to EVERY
// keyframe, so the view stays usable on phones along the whole journey and the first keyframe
// still equals the hero base pose for any viewport.
// ===========================================================================================

const EPS = 1e-6;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// Hermite smoothstep of x between edges a and b (a may be greater than b for a falling edge).
export function smooth(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// How much wider the vertical FOV is than the landscape value for this viewport aspect.
export function portraitFovDelta(aspect) {
  return getRigPose(aspect).fov - CAMERA.fov;
}

// Turn a SPEED PROFILE into a pace function.
//   speedAt(q): relative walking speed (> 0) at fraction q of the walk, 1 = nominal.
// Time to reach q is the integral of 1 / speed, so slow stretches take more scroll. The returned
// pace(local) inverts that: scroll fraction -> walk fraction. It is monotonic, pace(0) = 0 and
// pace(1) = 1 exactly. pace.rate(local) gives dq/dlocal (how many "walks" per full scroll), used
// by the numeric checks; pace.speedAt is the profile itself.
export function makePace(speedAt, samples = 800) {
  const time = new Float64Array(samples + 1);
  for (let i = 1; i <= samples; i++) {
    time[i] = time[i - 1] + 1 / samples / Math.max(1e-3, speedAt((i - 0.5) / samples));
  }
  const total = time[samples];
  const pace = (local) => {
    const target = clamp01(local) * total;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (time[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = time[hi] - time[lo] || 1;
    return clamp01((lo + (target - time[lo]) / span) / samples);
  };
  pace.speedAt = speedAt;
  pace.rate = (local) => total * speedAt(pace(local)); // dq / dlocal
  return pace;
}

// ----- keyframes ---------------------------------------------------------------------------------

const toVec = (v) => (v.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));

function normalizeKeyframe(k) {
  return { position: toVec(k.position), lookAt: toVec(k.lookAt), roll: k.roll ?? 0, fov: k.fov ?? CAMERA.fov };
}

function sameKeyframe(a, b) {
  return (
    a.position.distanceTo(b.position) < 1e-4 &&
    a.lookAt.distanceTo(b.lookAt) < 1e-4 &&
    Math.abs(a.roll - b.roll) < 1e-4 &&
    Math.abs(a.fov - b.fov) < 1e-4
  );
}

// Resolve a section's keyframes for a viewport aspect (they may be a function of it: the approach
// section's first keyframe is the hero pose, which depends on the aspect).
export function resolveKeyframes(section, aspect) {
  const source = section.camera?.keyframes;
  const list = typeof source === "function" ? source(aspect) : source;
  return (list ?? []).map(normalizeKeyframe);
}

// Uniform Catmull-Rom through scalar values; x is in index space. Ends reflect the neighbour so
// the first and last segments are well behaved.
function makeScalarSpline(values) {
  const n = values.length;
  const at = (i) => {
    if (i < 0) return 2 * values[0] - values[Math.min(1, n - 1)];
    if (i > n - 1) return 2 * values[n - 1] - values[Math.max(0, n - 2)];
    return values[i];
  };
  return (x) => {
    if (n === 1) return values[0];
    const xc = Math.min(Math.max(x, 0), n - 1);
    let i = Math.floor(xc);
    if (i >= n - 1) i = n - 2;
    const f = xc - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    return (
      0.5 *
      (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
    );
  };
}

// ----- the path ----------------------------------------------------------------------------------

export function createPose() {
  return {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    roll: 0, // degrees, positive = lean right
    fov: CAMERA.fov,
    x: 0, // keyframe index space
    distance: 0, // metres walked along the camera curve since keyframe 0
    entry: null, // the timeline entry that owns this progress (null when there is none)
    local: 0, // that entry's local progress
  };
}

const DIST_SUBDIV = 8; // distance table samples per keyframe segment

// Build the joined path for a list of timeline entries (see index.js buildTimeline) and a viewport
// aspect. Cheap (a few ms at most), so it is simply rebuilt when the aspect changes.
export function buildCameraPath(entries, aspect) {
  const delta = portraitFovDelta(aspect);
  const frames = [];
  const ranges = {};
  const warnings = [];

  for (const entry of entries) {
    const keyframes = resolveKeyframes(entry, aspect);
    if (keyframes.length === 0) continue;
    let i0;
    if (frames.length > 0 && sameKeyframe(frames[frames.length - 1], keyframes[0])) {
      i0 = frames.length - 1; // shared keyframe: continuity by construction
      for (let k = 1; k < keyframes.length; k++) frames.push(keyframes[k]);
    } else {
      if (frames.length > 0) warnings.push(entry.id);
      i0 = frames.length;
      for (const k of keyframes) frames.push(k);
    }
    ranges[entry.id] = [i0, frames.length - 1];
  }

  const n = frames.length;
  const posCurve = n > 1 ? new THREE.CatmullRomCurve3(frames.map((f) => f.position), false, "centripetal") : null;
  const lookCurve = n > 1 ? new THREE.CatmullRomCurve3(frames.map((f) => f.lookAt), false, "centripetal") : null;
  const rollSpline = makeScalarSpline(frames.map((f) => f.roll));
  const fovSpline = makeScalarSpline(frames.map((f) => f.fov + delta));

  // Cumulative metres along the camera curve, for the footstep phase and the speed checks.
  const segments = Math.max(1, n - 1) * DIST_SUBDIV;
  const cumulative = new Float64Array(segments + 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  if (posCurve) {
    posCurve.getPoint(0, a);
    for (let i = 1; i <= segments; i++) {
      posCurve.getPoint(i / segments, b);
      cumulative[i] = cumulative[i - 1] + a.distanceTo(b);
      a.copy(b);
    }
  }
  const distanceAt = (x) => {
    if (!posCurve) return 0;
    const f = (Math.min(Math.max(x, 0), n - 1) / (n - 1)) * segments;
    const i = Math.min(segments - 1, Math.floor(f));
    return cumulative[i] + (cumulative[i + 1] - cumulative[i]) * (f - i);
  };

  // Which entry owns a global progress, and its local progress. Only sections that really move
  // (length > 0 and at least two keyframes) own the camera; anchors just contribute their pose.
  const moving = entries.filter((e) => e.length > 0 && ranges[e.id] && ranges[e.id][1] > ranges[e.id][0]);
  const evaluate = (progress, out) => {
    let entry = null;
    let local = 0;
    for (let i = 0; i < moving.length; i++) {
      const e = moving[i];
      if (progress <= e.end + EPS || i === moving.length - 1) {
        entry = e;
        local = clamp01((progress - e.start) / Math.max(EPS, e.end - e.start));
        break;
      }
    }
    let x = 0;
    if (entry) {
      const [i0, i1] = ranges[entry.id];
      const q = entry.camera?.pace ? clamp01(entry.camera.pace(local)) : local;
      x = i0 + q * (i1 - i0);
    }
    if (posCurve) {
      const t = x / (n - 1);
      posCurve.getPoint(t, out.position);
      lookCurve.getPoint(t, out.target);
    } else {
      out.position.copy(frames[0].position);
      out.target.copy(frames[0].lookAt);
    }
    out.roll = rollSpline(x);
    out.fov = fovSpline(x);
    out.x = x;
    out.distance = distanceAt(x);
    out.entry = entry;
    out.local = local;
    return out;
  };

  return { n, frames, ranges, delta, warnings, evaluate, distanceAt, entries };
}

// One cached path per (timeline, aspect): rebuilt only when the viewport aspect changes.
const cache = new WeakMap();
export function getCameraPath(timeline, aspect) {
  const hit = cache.get(timeline);
  if (hit && hit.aspect === aspect) return hit.path;
  const path = buildCameraPath(timeline.entries, aspect);
  cache.set(timeline, { aspect, path });
  return path;
}

// Development assertion: each section's first keyframe must equal the previous section's last
// (the END_POSE rule). Warns once per offending section; production never calls this.
export function checkKeyframeContinuity(entries, aspects = [0.6, 1.78]) {
  for (const aspect of aspects) {
    const path = buildCameraPath(entries, aspect);
    for (const id of path.warnings) {
      console.warn(
        `[sections] "${id}": the first camera keyframe does not equal the previous section's last keyframe ` +
          `(aspect ${aspect}). The camera path would jump there. Start the section from the previous END pose.`,
      );
    }
  }
}
