"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import useReducedMotion from "@/hooks/useReducedMotion";
import useStaged from "@/hooks/useStaged";
import { makeLeafAtlas } from "./ForestEnvironment";

// Two autumn leaves drifting down through the right half of the frame, one at a time per slot,
// looping forever. Each is a single textured quad (2 triangles) cut from the same fallen-leaf atlas
// the forest floor uses, so a leaf that lands looks like the ones already lying there.
//
// Motion per leaf (all closed form in time, no per-frame allocation):
//   fall    constant 0.12 to 0.2 u/s (a leaf is slow: it is mostly drag), wrapped from TOP to BOTTOM
//   sway    x and z swing sinusoidally, amplitude about 0.6, period 3 to 5 s (flutter side to side)
//   tumble  pitch and roll rock back and forth, yaw turns slowly, so the card rolls over in the air
//
// The slots sit 6 to 12 units in front of the lens, where depth of field turns a small leaf into a
// soft shape rather than a crisp sticker, and to the right of the trunk (the open, sun side).
const SLOTS = [
  // x, z: world position of the fall line; top, bottom: y range; speed: u/s; cell: atlas leaf
  { x: 5.6, z: 5.5, top: 12.5, bottom: 1.0, speed: 0.16, swayAmp: 0.6, swayPeriod: 4.2, phase: 0.0, size: 0.42, cell: 0, offset: 0.55 },
  { x: 8.4, z: 2.0, top: 12.5, bottom: 1.0, speed: 0.13, swayAmp: 0.55, swayPeriod: 3.4, phase: 2.4, size: 0.4, cell: 2, offset: 0.1 },
];

// Reduced motion parks each leaf at this fraction of its fall.
const PARKED = 0.5;

export default function FallingLeaves() {
  const reduced = useReducedMotion();
  const ready = useStaged(14); // after the heavy stages, so painting the atlas never adds to a stall
  if (!ready) return null;
  return <Leaves reduced={reduced} />;
}

function Leaves({ reduced }) {
  const refs = useRef([]);

  const resources = useMemo(() => {
    const atlas = makeLeafAtlas();
    const material = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
    });
    // one quad per atlas cell (row 0 of the canvas is the top, texture v = 1 at the top)
    const geometries = SLOTS.map((slot) => {
      const g = new THREE.PlaneGeometry(1, 1);
      const u0 = (slot.cell % 2) * 0.5;
      const v0 = 0.5 - Math.floor(slot.cell / 2) * 0.5;
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
      return g;
    });
    return { atlas, material, geometries };
  }, []);

  useEffect(
    () => () => {
      resources.atlas.dispose();
      resources.material.dispose();
      resources.geometries.forEach((g) => g.dispose());
    },
    [resources],
  );

  useFrame((state) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    for (let i = 0; i < SLOTS.length; i++) {
      const o = refs.current[i];
      if (!o) continue;
      const s = SLOTS[i];
      const span = s.top - s.bottom;
      // fraction of the fall completed, wrapped to [0, 1): the leaf reappears at the top
      const f = reduced ? PARKED : (((s.offset + (t * s.speed) / span) % 1) + 1) % 1;
      const w = (Math.PI * 2) / s.swayPeriod;
      o.position.set(
        s.x + s.swayAmp * Math.sin(w * t + s.phase),
        s.top - f * span,
        s.z + s.swayAmp * 0.6 * Math.cos(w * 0.8 * t + s.phase),
      );
      // The card lies roughly flat (plane normal up) and rocks about both horizontal axes as it
      // swings out and back: it is steepest when it changes direction.
      o.rotation.set(
        -Math.PI / 2 + 0.9 * Math.sin(w * t + s.phase + 1.2),
        0.5 * t * (i % 2 === 0 ? 1 : -1) + s.phase,
        0.7 * Math.cos(w * t + s.phase),
        "YXZ",
      );
    }
  });

  return (
    <group name="falling-leaves">
      {SLOTS.map((s, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          geometry={resources.geometries[i]}
          material={resources.material}
          scale={s.size}
        />
      ))}
    </group>
  );
}
