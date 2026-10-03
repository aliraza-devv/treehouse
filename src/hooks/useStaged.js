"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

// Returns false until `frames` rendered frames have passed, then true. Heavy scene parts (runtime
// texture painting, geometry building) mount in different frames this way, so no single frame
// blocks the main thread for long and the page stays responsive while the scene assembles.
export default function useStaged(frames) {
  const [ready, setReady] = useState(frames <= 0);
  const count = useRef(0);
  useFrame(() => {
    if (ready) return;
    count.current += 1;
    if (count.current >= frames) setReady(true);
  });
  return ready;
}
