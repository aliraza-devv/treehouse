"use client";

import { Suspense, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { TIMELINE } from "@/lib/sections";
import { RevealGroup } from "@/lib/sections/reveal";
import { scrollState } from "@/lib/scroll/scrollStore";

// ---------------------------------------------------------------------------
// SectionsHost: mounts each registered section's 3D scene while the page is near it.
//
// A section's scene mounts when global progress is within MOUNT_MARGIN of its range and unmounts when
// it is more than UNMOUNT_MARGIN outside it (the gap is hysteresis, so scrolling back and forth around
// the edge never mounts and unmounts repeatedly: mounting repaints textures, which is expensive).
// React state changes ONLY when a section crosses one of those thresholds, never per frame.
//
// PRE-MOUNT: a section with `mountDelayFrames` (the approach: 90) is mounted that many rendered frames
// after the host starts, even though the visitor is still at progress 0. Its world sits inside
// <RevealGroup>, invisible, and RevealGroup then prewarms its shaders and textures in small batches
// (see src/lib/sections/reveal.js), so the first scroll tick finds everything compiled. If the visitor
// scrolls before the delay has passed the section mounts immediately.
//
// Per section it mounts (all inside the R3F Canvas, via HeroScene):
//   Controllers  non visual drivers (light ramp, fog): always outside the RevealGroup, because they
//                are identical to the hero at progress 0 and must run whether or not the world shows
//   Scene        the world: wrapped in <RevealGroup> when the entry says reveal: true
// Each is inside <Suspense> because section scenes are lazy chunks (loaded after the hero is up).
// ---------------------------------------------------------------------------

const MOUNT_MARGIN = 0.06; // global progress units before a section's start / after its end
const UNMOUNT_MARGIN = 0.14;
const HAS_SCENE = (entry) => Boolean(entry.Scene || entry.Controllers);

function SectionMount({ entry }) {
  const { Scene, Controllers, reveal } = entry;
  return (
    <>
      {Controllers ? (
        <Suspense fallback={null}>
          <Controllers />
        </Suspense>
      ) : null}
      {Scene ? (
        reveal ? (
          <RevealGroup>
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </RevealGroup>
        ) : (
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        )
      ) : null}
    </>
  );
}

export default function SectionsHost() {
  const [mountedIds, setMountedIds] = useState([]);
  const mounted = useRef(new Set());
  const frames = useRef(0);

  useFrame(() => {
    frames.current += 1;
    const progress = scrollState.progress;
    let changed = false;
    for (const entry of TIMELINE.entries) {
      if (!HAS_SCENE(entry)) continue;
      const isMounted = mounted.current.has(entry.id);
      const near = progress >= entry.start - MOUNT_MARGIN && progress <= entry.end + MOUNT_MARGIN;
      const far = progress < entry.start - UNMOUNT_MARGIN || progress > entry.end + UNMOUNT_MARGIN;
      // The delay only holds back the idle pre-mount; any real scrolling mounts straight away.
      const ready = frames.current >= (entry.mountDelayFrames ?? 0) || progress > 0.0005;
      if (!isMounted && near && ready) {
        mounted.current.add(entry.id);
        changed = true;
      } else if (isMounted && far) {
        mounted.current.delete(entry.id);
        changed = true;
      }
    }
    if (changed) setMountedIds([...mounted.current]);
  });

  return (
    <>
      {TIMELINE.entries
        .filter((entry) => mountedIds.includes(entry.id))
        .map((entry) => (
          <SectionMount key={entry.id} entry={entry} />
        ))}
    </>
  );
}
