"use client";

import { useEffect, useRef } from "react";
import useReducedMotion from "@/hooks/useReducedMotion";
import { scrollState } from "@/lib/scroll/scrollStore";
import { LAYERS } from "@/lib/layers";

// ---- Tuning ----------------------------------------------------------------------------------
const DEFAULT_DRIFT_PX = 22; // vertical drift of a beat entering (rises from below) and leaving (rises away)
const EXIT_DRIFT_SCALE = 0.6; // leaving drift is shorter than the entering drift: a settle, not a throw
const GATE_IN_TAU = 0.15; // seconds, time constant for the overlay re-appearing when its section is active
const GATE_OUT_TAU = 0.35; // seconds, time constant for fading out once the next section owns the camera
const EPS = 0.002; // minimum change worth a DOM write

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Hermite smoothstep: zero slope at both ends, so fades start and finish without a visible kink
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// Opacity and the two eased phases of one beat at section-local progress p.
//   inn = 0 -> 1 across enter..peakStart, out = 0 -> 1 across peakEnd..exit (never when exit is null)
function evalBeat(b, p) {
  const inn = b.peakStart > b.enter ? smooth((p - b.enter) / (b.peakStart - b.enter)) : p >= b.enter ? 1 : 0;
  const out = b.exit != null && b.exit > b.peakEnd ? smooth((p - b.peakEnd) / (b.exit - b.peakEnd)) : 0;
  return { inn, out, opacity: inn * (1 - out) };
}

// Generic, config driven beat renderer. It owns no layout opinion beyond grouping.
//
// Props
//   beats            array of beats (see approach/beats.js): { id, text | lines[], role, group?, side?,
//                    enter, peakStart, peakEnd, exit, drift?, scrim? }
//   sectionId        key into scrollState.sections (local 0..1 progress of the owning section)
//   roleClassNames   { heading, subline, proof, ... } Tailwind classes per role
//   groupClassNames  { [group]: classes } positioning of each group container
//   sideClassNames   { left, right } extra classes on a group container by the side of its first beat
//   scrim            optional { className, style } soft scrim behind the copy; its opacity follows the
//                    strongest visible beat (weighted by beat.scrim) so it breathes with the words
//
// How it stays in step with the camera: ONE requestAnimationFrame loop reads scrollState every frame
// and writes opacity, transform and visibility straight onto the nodes. There are no scroll
// listeners and no React state per frame, so a re-render can never lag behind the camera.
//
// Accessibility (one approach, deliberately): the text is always in the DOM, in reading order, and a
// beat is `visibility: hidden` whenever its opacity is 0. visibility:hidden removes it from the
// accessibility tree and the tab order, so assistive tech reads each line once, only while it is on
// screen, and never reads invisible text. There is no aria-hidden and no duplicated sr-only copy.
// Pointer events are off for the whole overlay.
//
// Reduced motion: no drift and no smoothing tricks, just a plain cross-fade driven by progress.
export default function ScrollOverlay({
  beats,
  sectionId,
  roleClassNames = {},
  groupClassNames = {},
  sideClassNames = {},
  scrim,
}) {
  const reduced = useReducedMotion();
  const reducedRef = useRef(false);
  const beatEls = useRef(new Map());
  const scrimEl = useRef(null);

  // Hold the live value in a ref so the frame loop never needs restarting
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let gate = 0; // smoothed 0..1: 1 while this section owns the camera
    const cache = new Map(); // id -> last written { o, y }
    let scrimLast = -1;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const p = scrollState.sections[sectionId] ?? 0;
      const active = scrollState.activeId === sectionId;
      // Once a later section takes over, local progress sits at 1 forever. Without the gate a beat
      // that holds to the end (the proof line) would stay on screen for the rest of the page, so it
      // is faded out over a few tenths of a second after the camera moves on.
      const tau = active ? GATE_IN_TAU : GATE_OUT_TAU;
      gate += ((active ? 1 : 0) - gate) * (1 - Math.exp(-dt / tau));
      if (gate < 0.001) gate = 0;
      if (gate > 0.999) gate = 1;

      const noMotion = reducedRef.current;
      let scrimOpacity = 0;

      for (const b of beats) {
        const el = beatEls.current.get(b.id);
        if (!el) continue;
        const { inn, out, opacity } = evalBeat(b, p);
        const o = opacity * gate;
        const drift = noMotion ? 0 : (b.drift ?? DEFAULT_DRIFT_PX);
        // Rises into place from below on entry, keeps rising (less) on exit, like the hero copy leaving
        const y = (1 - inn) * drift - out * drift * EXIT_DRIFT_SCALE;
        scrimOpacity = Math.max(scrimOpacity, o * (b.scrim ?? 1));

        const prev = cache.get(b.id);
        if (prev && Math.abs(prev.o - o) < EPS && Math.abs(prev.y - y) < 0.05 && (o > 0) === (prev.o > 0)) continue;
        cache.set(b.id, { o, y });
        if (o <= 0) {
          el.style.visibility = "hidden";
          el.style.opacity = "0";
        } else {
          el.style.visibility = "visible";
          el.style.opacity = o.toFixed(3);
        }
        el.style.transform = y === 0 ? "none" : `translate3d(0, ${y.toFixed(2)}px, 0)`;
      }

      const s = scrimEl.current;
      if (s && Math.abs(scrimOpacity - scrimLast) >= EPS) {
        scrimLast = scrimOpacity;
        s.style.opacity = scrimOpacity.toFixed(3);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [beats, sectionId]);

  // Group beats by slot, keeping the config order (that is also the DOM and reading order)
  const groups = [];
  for (const b of beats) {
    const key = b.group ?? "default";
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, side: b.side ?? "left", beats: [] }));
    g.beats.push(b);
  }

  return (
    <>
      {scrim && (
        <div
          ref={scrimEl}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 ${scrim.className ?? ""}`}
          style={{ opacity: 0, zIndex: LAYERS.content, ...scrim.style }}
        />
      )}
      {groups.map((g) => (
        <div
          key={g.key}
          className={`pointer-events-none ${groupClassNames[g.key] ?? ""} ${sideClassNames[g.side] ?? ""}`}
          style={{ zIndex: LAYERS.content }}
        >
          {g.beats.map((b) => {
            const Tag = b.role === "heading" ? "h2" : "p";
            return (
              <Tag
                key={b.id}
                ref={(node) => {
                  if (node) beatEls.current.set(b.id, node);
                  else beatEls.current.delete(b.id);
                }}
                data-beat={b.id}
                className={`pointer-events-none ${roleClassNames[b.role] ?? ""}`}
                // Hidden until the frame loop says otherwise, so nothing flashes before hydration
                style={{ opacity: 0, visibility: "hidden" }}
              >
                {b.lines ? b.lines.map((line) => <span key={line} className="block">{line}</span>) : b.text}
              </Tag>
            );
          })}
        </div>
      ))}
    </>
  );
}
