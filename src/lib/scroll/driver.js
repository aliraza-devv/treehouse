// ===========================================================================================
// SCROLL DRIVER LOGIC (pure functions, no DOM except readTarget)
//
// ScrollDriver.jsx calls stepScroll() once per frame from the gsap ticker. Nothing here listens to
// scroll events: the page scroll is read by polling window.scrollY each frame (Lenis moves it
// every frame, and with reduced motion the browser scrolls natively; both are read the same way).
// ===========================================================================================

// Smoothing. `progress` is a CRITICALLY DAMPED spring chasing `target` (the raw scroll fraction):
//   x'' = -w^2 (x - target) - 2 w x'      with w = 2 / tau
// critically damped means the fastest approach with no overshoot, and the velocity carries on from where
// it is (no kink when the visitor starts or stops scrolling). The closed form in stepScroll is exact for
// any dt, so the result does not depend on the frame rate. From rest the remaining gap is (1 + w t) e^(-w t):
// 41 percent after t = tau, 37 percent (the 63 percent point, a "time constant") after 1.07 tau, 5 percent
// after 2.4 tau. So tau = 0.25 s gives a time constant of about 0.27 s. Lenis already smooths the wheel,
// so this is a gentle second layer that keeps the camera glide continuous.
export const SMOOTH_TAU = 0.25; // seconds
// With reduced motion Lenis is off and the page scrolls natively: keep the damping short so the scene
// follows the visitor's own scrolling closely instead of gliding after it.
export const SMOOTH_TAU_REDUCED = 0.08;
// dt is clamped: a background tab can hand us seconds at once, and a zero dt must not divide.
export const MAX_DT = 0.1;
export const MIN_DT = 1 / 480;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Raw scroll fraction of the runway: 0 at the top, 1 at the bottom.
export function readTarget(scrollY, maxScroll) {
  return maxScroll > 0 ? clamp01(scrollY / maxScroll) : 0;
}

// Maximum scroll distance in px (document height minus the viewport), at least 0.
export function readMaxScroll() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - window.innerHeight);
}

// The spring's own velocity (progress units per second) lives here, not in the shared store: the store
// only publishes the observed `velocity`.
export function createMotion() {
  return { v: 0 };
}

// One critically damped step. Writes store.target, store.progress and store.velocity.
// `first` snaps progress to the target (page load with a restored scroll position must not glide in
// from zero).
export function stepScroll(store, motion, rawTarget, dtSeconds, tau = SMOOTH_TAU, first = false) {
  const dt = Math.min(MAX_DT, Math.max(MIN_DT, dtSeconds));
  store.target = rawTarget;

  if (store.override !== null) {
    // Dev scrubber: pinned, no damping. Velocity is zero so the footstep bob is off while scrubbing.
    store.progress = clamp01(store.override);
    store.velocity = 0;
    motion.v = 0;
    return;
  }
  if (first) {
    store.progress = rawTarget;
    store.velocity = 0;
    motion.v = 0;
    return;
  }

  const omega = 2 / tau;
  const x = store.progress;
  const delta = x - rawTarget;
  const v = motion.v;
  const decay = Math.exp(-omega * dt);
  const temp = v + omega * delta;
  let next = rawTarget + (delta + temp * dt) * decay;
  let nextV = (v - omega * temp * dt) * decay;
  // Settle exactly: no endless micro motion once the gap and the speed are negligible.
  if (Math.abs(next - rawTarget) < 1e-6 && Math.abs(nextV) < 1e-5) {
    next = rawTarget;
    nextV = 0;
  }
  next = clamp01(next);
  store.progress = next;
  motion.v = nextV;
  store.velocity = (next - x) / dt; // observed rate of change, progress units per second
}

// Local progress of every section and the active section id, from a global progress.
// An anchor (length 0) owns progress exactly at its start (and local becomes 1 once passed); a normal
// section owns (start, end]. At progress 0 the hero (the first entry) is active.
const EDGE = 1e-6;
export function updateSections(store, timeline, progress) {
  let active = timeline.entries[0]?.id ?? "hero";
  for (const entry of timeline.entries) {
    const span = entry.end - entry.start;
    if (entry.length > 0) {
      store.sections[entry.id] = clamp01((progress - entry.start) / Math.max(EDGE, span));
    } else {
      store.sections[entry.id] = progress > entry.start + EDGE ? 1 : 0;
    }
  }
  for (const entry of timeline.entries) {
    if (entry.length <= 0) {
      if (progress <= entry.start + EDGE) {
        active = entry.id;
        break;
      }
      continue;
    }
    if (progress > entry.start + EDGE && progress <= entry.end + EDGE) {
      active = entry.id;
      break;
    }
    active = entry.id; // past this section: the last one passed stays active until the next claims it
  }
  store.activeId = active;
}

// Global progress for a section-local progress (the dev helper window.__sectionToGlobal).
export function sectionToGlobal(timeline, id, local) {
  const entry = timeline.byId[id];
  if (!entry) return null;
  return entry.start + clamp01(local) * (entry.end - entry.start);
}
