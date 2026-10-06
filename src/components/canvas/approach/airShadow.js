import * as THREE from "three";
import { TREE } from "@/lib/sceneConfig";
import { PATH_LENGTH, pathAt } from "@/lib/sections/world";
import { HERO_SHADOW, WALKER_SHADOW } from "./airTuning";

// Shadow camera fitting for the walk. Pure maths plus a few three.js objects, no React.
//
// HeroScene fits the sun's orthographic shadow camera to a box around the hero tree. The walker moves from
// z = 15 to z = 3, so while the approach is active we re-fit the same light to a box that travels with the
// camera. fitShadowCamera is a COPY of HeroScene's fit (same method, same pad) so that at progress 0 the
// result is bit identical to what HeroScene computed.

const _corner = new THREE.Vector3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
const _lightPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

// The hero region as a Box3 (copy of HeroScene's SHADOW_REGION).
export function heroShadowBox(out = new THREE.Box3()) {
  out.min.set(TREE.x - HERO_SHADOW.halfWidth, HERO_SHADOW.yMin, HERO_SHADOW.zMin);
  out.max.set(TREE.x + HERO_SHADOW.halfWidth, HERO_SHADOW.yMax, HERO_SHADOW.zMax);
  return out;
}

// The walker's box for a centre on the ground (x, z): 22 m wide, 20 m deep, y from -0.5 to 20.
export function walkerShadowBox(cx, cz, out = new THREE.Box3()) {
  out.min.set(cx - WALKER_SHADOW.halfWidth, WALKER_SHADOW.yMin, cz - WALKER_SHADOW.halfDepth);
  out.max.set(cx + WALKER_SHADOW.halfWidth, WALKER_SHADOW.yMax, cz + WALKER_SHADOW.halfDepth);
  return out;
}

export function lerpBox(a, b, w, out = new THREE.Box3()) {
  out.min.lerpVectors(a.min, b.min, w);
  out.max.lerpVectors(a.max, b.max, w);
  return out;
}

// Fit light.shadow.camera to a world space box exactly as HeroScene does: point the shadow camera as three
// will at render time (from the light position at its target), push the 8 corners through its view matrix
// and take the min and max in view space as the ortho extents. In view space the camera looks down -Z, so
//   near = -maxZ, far = -minZ.
// The light sits inside the box, so near may be negative (an orthographic slab extends behind the light).
//
// `snap` (the walking fit only): the left and bottom edges are rounded to whole shadow map texels and the
// width and height are rounded up to whole texels. As the box slides with the walker the texel grid then
// stays put in light space, so dapple edges do not swim from one shadow refresh to the next. The hero fit
// passes false so progress 0 stays bit identical to HeroScene.
// Returns the world size of one texel (metres) for scaling the normal bias.
export function fitShadowCamera(light, box, { pad = HERO_SHADOW.pad, snap = false, nearExtra = 0 } = {}) {
  const cam = light.shadow.camera;
  // Same transform three's LightShadow.updateMatrices applies at render time.
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  _lightPos.setFromMatrixPosition(light.matrixWorld);
  _lookAt.setFromMatrixPosition(light.target.matrixWorld);
  cam.position.copy(_lightPos);
  cam.lookAt(_lookAt);
  cam.updateMatrixWorld(true);
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    _corner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .applyMatrix4(cam.matrixWorldInverse);
    _min.min(_corner);
    _max.max(_corner);
  }
  let left = _min.x - pad;
  let right = _max.x + pad;
  let bottom = _min.y - pad;
  let top = _max.y + pad;
  const mapSize = light.shadow.mapSize.x || 2048;
  if (snap) {
    // The map spans exactly mapSize texels across the extent, so one texel is extent / mapSize. Only the
    // origin moves (to a whole texel); the width is unchanged, so while the walker box keeps its size the
    // texel grid is the same on every refresh.
    const texelX = (right - left) / mapSize;
    const texelY = (top - bottom) / mapSize;
    const width = right - left;
    const height = top - bottom;
    left = Math.floor(left / texelX) * texelX;
    bottom = Math.floor(bottom / texelY) * texelY;
    right = left + width;
    top = bottom + height;
  }
  cam.left = left;
  cam.right = right;
  cam.bottom = bottom;
  cam.top = top;
  // nearExtra pulls the near plane toward the light: casters high above the box (the canopy, 15 m up the sun ray
  // from a landing point at the sunward edge) are otherwise clipped by it. Hero: 0.
  cam.near = -_max.z - pad - nearExtra;
  cam.far = -_min.z + pad;
  cam.updateProjectionMatrix();
  return (right - left) / mapSize;
}

// The hero normal bias for a map size (copy of HeroScene's rule).
export function heroNormalBias(mapSize) {
  return mapSize >= 4096 ? HERO_SHADOW.normalBias4096 : HERO_SHADOW.normalBias2048;
}

// ----- The walker track --------------------------------------------------------------------------------------
// A dense lookup of the path centreline so a camera position can be projected onto it every frame without
// calling the Catmull-Rom curve (pathAt is far too slow to run per frame, 160 samples per call). Built once.
const TRACK_N = 160;
let _track = null;
function getTrack() {
  if (_track) return _track;
  const x = new Float32Array(TRACK_N + 1);
  const z = new Float32Array(TRACK_N + 1);
  for (let i = 0; i <= TRACK_N; i++) {
    const p = pathAt(i / TRACK_N);
    x[i] = p.x;
    z[i] = p.z;
  }
  _track = { x, z };
  return _track;
}

// Continuous path fraction s of the point on the centreline nearest to (px, pz): nearest sample, then a
// projection onto the neighbouring segment so the result does not step when the camera weaves.
export function projectOnPath(px, pz) {
  const { x, z } = getTrack();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= TRACK_N; i++) {
    const d = (px - x[i]) * (px - x[i]) + (pz - z[i]) * (pz - z[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Fractional position along the segment toward whichever neighbour is closer to the point.
  let frac = 0;
  for (const j of [best - 1, best + 1]) {
    if (j < 0 || j > TRACK_N) continue;
    const sx = x[j] - x[best];
    const sz = z[j] - z[best];
    const l2 = sx * sx + sz * sz;
    if (l2 < 1e-9) continue;
    const f = ((px - x[best]) * sx + (pz - z[best]) * sz) / l2;
    if (f > 0 && f <= 1) frac = j > best ? f : -f;
  }
  return THREE.MathUtils.clamp((best + frac) / TRACK_N, 0, 1);
}

// Point on the centreline at fraction s (linear between track samples), written into out {x, z}.
export function trackPoint(s, out) {
  const { x, z } = getTrack();
  const f = THREE.MathUtils.clamp(s, 0, 1) * TRACK_N;
  const i = Math.min(TRACK_N - 1, Math.floor(f));
  const k = f - i;
  out.x = x[i] + (x[i + 1] - x[i]) * k;
  out.z = z[i] + (z[i + 1] - z[i]) * k;
  return out;
}

// Where the walker box is centred for a camera at (cx, cz): `ahead` metres further along the path.
// Beyond the end of the path (s = 1) the centre stays at the trunk base.
export function walkerCentre(cx, cz, out = { x: 0, z: 0 }) {
  const s = projectOnPath(cx, cz);
  return trackPoint(s + WALKER_SHADOW.ahead / PATH_LENGTH, out);
}
