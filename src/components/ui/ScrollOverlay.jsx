"use client";

import { useEffect, useRef } from "react";
import useReducedMotion from "@/hooks/useReducedMotion";
import { scrollState } from "@/lib/scroll/scrollStore";
import { LAYERS } from "@/lib/layers";

// ---- Tuning ----------------------------------------------------------------------------------
const GATE_IN_TAU = 0.15; // seconds, time constant for the overlay re-appearing when its section is active
const GATE_OUT_TAU = 0.35; // seconds, time constant for fading out once the next section owns the camera
const LINE_STAGGER = 0.22; // each line trails the one above it by this fraction of the beat's in (and out) phase
const RISE_PERCENT = 108; // how far a hidden line sits below (or above) its mask, in percent of its own height
const EPS = 0.002; // minimum change worth a DOM write

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Hermite smoothstep: zero slope at both ends, so moves start and finish without a visible kink
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// The two eased phases of one beat at section-local progress p.
//   inn = 0 -> 1 across enter..peakStart, out = 0 -> 1 across peakEnd..exit (never when exit is null)
function evalBeat(b, p) {
  const inn = b.peakStart > b.enter ? smooth((p - b.enter) / (b.peakStart - b.enter)) : p >= b.enter ? 1 : 0;
  const out = b.exit != null && b.exit > b.peakEnd ? smooth((p - b.peakEnd) / (b.exit - b.peakEnd)) : 0;
  return { inn, out, opacity: inn * (1 - out) };
}

// A beat may name one word or phrase (`accent`) to be set in the warm brand colour.
function accented(text, accent) {
  const at = accent ? text.indexOf(accent) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="text-brand-warm">{accent}</span>
      {text.slice(at + accent.length)}
    </>
  );
}

// Generic, config driven beat renderer. It owns no layout opinion beyond grouping.
//
// Props
//   beats            array of beats (see climb/climbBeats.js): { id, text | lines[], role, group?, side?,
//                    enter, peakStart, peakEnd, exit, scrim? }
//   sectionId        key into scrollState.sections (local 0..1 progress of the owning section)
//   roleClassNames   { heading, subline, ... } Tailwind classes per role
//   groupClassNames  { [group]: classes } positioning of each group container
//   sideClassNames   { left, right } extra classes on a group container by the side of its first beat
//   scrim            optional { className, style } soft scrim behind the copy; its opacity follows the
//                    strongest visible beat (weighted by beat.scrim) so it breathes with the words
//
// How the words arrive: NOT by fading. A fade passes through grey, half see-through text over a dark scene, which
// reads as a veil over the words. Instead every line sits in a mask (overflow hidden) and rises into place at full
// colour, one line after the next, and rises away out of the top again on the way out: the same move the hero
// heading makes on load. The text is therefore either fully readable or not on screen, never in between.
//
// How it stays in step with the camera: ONE requestAnimationFrame loop reads scrollState every frame
// and writes transforms and visibility straight onto the nodes. There are no scroll listeners and no React
// state per frame, so a re-render can never lag behind the camera.
//
// Accessibility (one approach, deliberately): the text is always in the DOM, in reading order, and a
// beat is `visibility: hidden` whenever it is off screen. visibility:hidden removes it from the
// accessibility tree and the tab order, so assistive tech reads each line once, only while it is on
// screen, and never reads invisible text. There is no aria-hidden and no duplicated sr-only copy.
// Pointer events are off for the whole overlay.
//
// Reduced motion: no rising, just a plain cross-fade driven by progress.
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
    const cache = new Map(); // id -> signature of the last written state
    const lineEls = new Map(); // id -> the inner line nodes that rise
    beatEls.current.forEach((el, id) => lineEls.set(id, Array.from(el.querySelectorAll("[data-line]"))));
    let scrimLast = -1;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const p = scrollState.sections[sectionId] ?? 0;
      const active = scrollState.activeId === sectionId;
      // Once a later section takes over, local progress sits at 1 forever. Without the gate a beat
      // that holds to the end would stay on screen for the rest of the page, so it is taken away over a few
      // tenths of a second after the camera moves on.
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
        const shown = opacity * gate;
        scrimOpacity = Math.max(scrimOpacity, shown * (b.scrim ?? 1));

        const signature = `${(inn * 500) | 0}/${(out * 500) | 0}/${(gate * 500) | 0}/${noMotion ? 1 : 0}`;
        if (cache.get(b.id) === signature) continue;
        cache.set(b.id, signature);

        const lines = lineEls.get(b.id) ?? [];
        el.style.visibility = shown > 0.001 ? "visible" : "hidden";
        if (noMotion) {
          el.style.opacity = shown.toFixed(3);
          for (const line of lines) line.style.transform = "none";
        } else {
          el.style.opacity = "1";
          const spread = 1 + LINE_STAGGER * (lines.length - 1);
          lines.forEach((line, i) => {
            const rise = clamp01(Math.min(inn, gate) * spread - LINE_STAGGER * i); // 0 below the mask -> 1 in place
            const leave = clamp01(out * spread - LINE_STAGGER * i); // 0 in place -> 1 above the mask
            const y = (1 - rise) * RISE_PERCENT - leave * RISE_PERCENT;
            line.style.transform = Math.abs(y) < 0.01 ? "none" : `translate3d(0, ${y.toFixed(2)}%, 0)`;
          });
        }
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
            const Tag = b.role.startsWith("heading") ? "h2" : "p";
            const lines = b.lines ?? [b.text];
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
                {lines.map((line) => (
                  // The mask. The padding and the matching negative margin keep descenders inside it without
                  // changing the line spacing.
                  <span key={line} className="block overflow-hidden px-[0.25em] pb-[0.14em] -mx-[0.25em] -mb-[0.14em]">
                    <span data-line className="block will-change-transform">
                      {accented(line, b.accent)}
                    </span>
                  </span>
                ))}
              </Tag>
            );
          })}
        </div>
      ))}
    </>
  );
}
