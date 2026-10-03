"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { textureTimings } from "@/lib/proceduralTextures";
import { TRIANGLE_BUDGET } from "@/lib/sceneConfig";

// Development only (Scene.jsx imports this behind a NODE_ENV check). The r3f-perf panel is NOT
// loaded: importing it makes Turbopack's dev server crash while writing source maps (Next 16.3.8),
// so scene cost is read from window.__heroStats instead.
const SAMPLE_SECONDS = 2;

// Walks the visible scene graph and returns the numbers the scene budget is checked against.
// Triangles per mesh = (index ? index.count / 3 : position.count / 3) * (instanced ? count : 1).
// Points are counted separately and never as triangles. Draw calls here are scene draw calls
// (one per visible mesh, line or points object, one per material group when a mesh has several
// materials), because gl.info.render.calls only reports the last composer pass.
function collectStats(scene, gl) {
  let triangles = 0;
  let drawCalls = 0;
  let instancedMeshes = 0;
  let points = 0;
  scene.traverseVisible((object) => {
    if (object.isPoints) {
      const position = object.geometry?.attributes?.position;
      if (position) points += position.count;
      drawCalls += 1;
      return;
    }
    if (object.isLine) {
      drawCalls += 1;
      return;
    }
    if (!object.isMesh) return;
    const geometry = object.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return;
    const perInstance = geometry.index ? geometry.index.count / 3 : position.count / 3;
    if (object.isInstancedMesh) {
      instancedMeshes += 1;
      triangles += perInstance * object.count;
    } else {
      triangles += perInstance;
    }
    drawCalls += Array.isArray(object.material) ? Math.max(1, geometry.groups.length) : 1;
  });
  // Biggest triangle consumers, for budgeting (name path, triangles).
  const parts = [];
  scene.traverseVisible((object) => {
    if (!object.isMesh || object.isPoints) return;
    const g = object.geometry;
    const pos = g?.attributes?.position;
    if (!pos) return;
    const per = g.index ? g.index.count / 3 : pos.count / 3;
    const tri = Math.round(per * (object.isInstancedMesh ? object.count : 1));
    let path = object.name || object.type;
    for (let p = object.parent; p && p !== scene; p = p.parent) path = (p.name || p.type) + "/" + path;
    parts.push([path, tri]);
  });
  parts.sort((a, b) => b[1] - a[1]);
  return {
    top: parts.slice(0, 24),
    textureMs: Math.round(Object.values(textureTimings).reduce((a, b) => a + b, 0)),
    textureList: Object.entries(textureTimings).map(([k, v]) => [k.slice(0, 40), Math.round(v)]),
    textureCount: Object.keys(textureTimings).length,
    firstFrameMs: Math.round(window.__firstFrameMs ?? -1),
    triangles: Math.round(triangles),
    drawCalls,
    instancedMeshes,
    points,
    textures: gl.info.memory.textures,
    geometries: gl.info.memory.geometries,
  };
}

// Writes window.__heroStats every 2 seconds, always. Read it from the browser console or a
// test script: window.__heroStats.triangles must stay under TRIANGLE_BUDGET (50000).
export default function DevTools() {
  const lastSample = useRef(-Infinity);

  useFrame((state) => {
    if (window.__firstFrameMs === undefined) window.__firstFrameMs = performance.now();
    const now = state.clock.elapsedTime;
    if (now - lastSample.current < SAMPLE_SECONDS) return;
    lastSample.current = now;
    window.__heroStats = collectStats(state.scene, state.gl);
    // Enforce the CLAUDE.md budget instead of remembering it. Counts the main pass only; the
    // shadow pass re-submits the casters on top.
    if (window.__heroStats.triangles > TRIANGLE_BUDGET) {
      console.error(`Hero scene is over its triangle budget: ${window.__heroStats.triangles} > ${TRIANGLE_BUDGET}`);
    }
  });

  return null;
}
