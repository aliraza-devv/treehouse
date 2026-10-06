"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { textureTimings } from "@/lib/proceduralTextures";
import { TRIANGLE_BUDGET } from "@/lib/sceneConfig";

// Development only (Scene.jsx imports this behind a NODE_ENV check). The r3f-perf panel is NOT
// loaded: importing it makes Turbopack's dev server crash while writing source maps (Next 16.3.8),
// so scene cost is read from window.__heroStats instead.
const SAMPLE_SECONDS = 2;

// ---------------------------------------------------------------------------------------------
// visibleTriangles / visibleDrawCalls: what is actually inside the camera frustum right now, as
// opposed to `triangles` / `drawCalls` above (every object with .visible === true, whether or not
// the camera can see it). The gap between the two numbers is exactly what distance/frustum culling
// of the content would recover.
//
// Three's own per-frame frustum culling already skips an ordinary Mesh whose bounding sphere falls
// outside the frustum, but it tests an InstancedMesh ONCE, against the bounding sphere of the whole
// instance set (computeBoundingSphere wraps every instance). A corridor-wide InstancedMesh (ferns,
// mid trunk ivy, the far tree line...) is almost always "in frustum" by that test even when the
// camera is only looking at a handful of its instances, so three keeps submitting every instance.
// This walk tests each instance's OWN bounding sphere, which is what the budget in CLAUDE.md
// actually means by "triangles drawn at once". It is an estimate for content budgeting (run every
// SAMPLE_SECONDS, not a live render optimisation): a real draw-call reduction would need the big
// InstancedMeshes chunked by region so three's own per-object culling can skip whole chunks, or a
// rewritten instance buffer each frame; see README notes on the approach budget controller.
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _box = new THREE.Box3();
const _instMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _center = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _sphere = new THREE.Sphere();

// Does an ordinary mesh's world space bounding box intersect the frustum?
function meshInFrustum(object, geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  _box.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
  return _frustum.intersectsBox(_box);
}

// Triangles of one InstancedMesh actually inside the frustum: each instance's OWN bounding sphere
// (the geometry's bounding sphere, carried through that instance's matrix, not the mesh-wide one
// InstancedMesh.computeBoundingSphere wraps around every instance together). See the header comment.
function instancedVisible(object, geometry, perInstance) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const base = geometry.boundingSphere;
  let visible = 0;
  for (let i = 0; i < object.count; i++) {
    object.getMatrixAt(i, _instMatrix);
    _worldMatrix.multiplyMatrices(object.matrixWorld, _instMatrix);
    _center.copy(base.center).applyMatrix4(_worldMatrix);
    _scale.setFromMatrixScale(_worldMatrix);
    _sphere.set(_center, base.radius * Math.max(_scale.x, _scale.y, _scale.z));
    if (_frustum.intersectsSphere(_sphere)) visible += 1;
  }
  return visible * perInstance;
}

// Walks the visible scene graph and returns the numbers the scene budget is checked against.
// Triangles per mesh = (index ? index.count / 3 : position.count / 3) * (instanced ? count : 1).
// Points are counted separately and never as triangles. Draw calls here are scene draw calls
// (one per visible mesh, line or points object, one per material group when a mesh has several
// materials), because gl.info.render.calls only reports the last composer pass.
//
// visibleTriangles / visibleDrawCalls additionally require the object to actually fall inside the
// camera frustum right now (see the header comment above): ordinary meshes by their world space
// bounding box, InstancedMesh per instance bounding sphere. This is the number CLAUDE.md's 50k
// triangle budget means; `triangles` above counts the whole dissolved-in scene regardless of where
// the camera is looking, so it is always the more pessimistic (bigger or equal) of the two.
function collectStats(scene, gl, camera) {
  let triangles = 0;
  let drawCalls = 0;
  let instancedMeshes = 0;
  let points = 0;
  let visibleTriangles = 0;
  let visibleDrawCalls = 0;
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);
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
    const calls = Array.isArray(object.material) ? Math.max(1, geometry.groups.length) : 1;
    if (object.isInstancedMesh) {
      instancedMeshes += 1;
      triangles += perInstance * object.count;
      const vis = instancedVisible(object, geometry, perInstance);
      visibleTriangles += vis;
      if (vis > 0) visibleDrawCalls += calls;
    } else {
      triangles += perInstance;
      drawCalls += calls;
      if (meshInFrustum(object, geometry)) {
        visibleTriangles += perInstance;
        visibleDrawCalls += calls;
      }
      return;
    }
    drawCalls += calls;
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
    visibleTriangles: Math.round(visibleTriangles),
    visibleDrawCalls,
    textures: gl.info.memory.textures,
    geometries: gl.info.memory.geometries,
  };
}

// Writes window.__heroStats every 2 seconds, always. Read it from the browser console or a
// test script: window.__heroStats.visibleTriangles must stay under TRIANGLE_BUDGET (50000).
export default function DevTools() {
  const lastSample = useRef(-Infinity);

  useFrame((state) => {
    if (window.__firstFrameMs === undefined) window.__firstFrameMs = performance.now();
    const now = state.clock.elapsedTime;
    if (now - lastSample.current < SAMPLE_SECONDS) return;
    lastSample.current = now;
    window.__heroStats = collectStats(state.scene, state.gl, state.camera);
    // Enforce the CLAUDE.md budget instead of remembering it. Counts the main pass only; the
    // shadow pass re-submits the casters on top. Checked against visibleTriangles (what the
    // camera frustum actually holds right now), not the raw `triangles` total: a dissolved-in
    // scene section carries content the camera is not looking at (behind it, off to the side),
    // and `triangles` counts that too. `triangles` stays in the stats for debugging ("how big is
    // everything that has mounted"), but it is not the number CLAUDE.md's budget means.
    if (window.__heroStats.visibleTriangles > TRIANGLE_BUDGET) {
      console.error(`Scene is over its triangle budget: ${window.__heroStats.visibleTriangles} visible > ${TRIANGLE_BUDGET}`);
    }
  });

  return null;
}
