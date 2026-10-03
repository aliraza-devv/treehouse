"use client";

// Everything that is not the hero tree, the cabin or the lights:
//
//   Ground           displaced plane (graded grid, finest near the camera), leaf-litter PBR
//                    textures, macro colour variation baked into vertex colours so the tile never
//                    reads as a pattern
//   Ground cover     instanced alpha cards: fern clumps, ivy sprigs, sedge tufts, painted fallen
//                    leaves; plus noise-displaced mossy rocks and moss cushions, two fallen logs
//                    with bracket fungi
//   Background trees seven detailed trees at 11 to 38 units: curved tapered trunks with buttress
//                    flutes, lower limbs and a leaf-card crown, cooler and darker with distance
//   Far tree line    thirty instanced slim trunks at 40 to 85 units, nearly fogged out
//   Foreground       <ForegroundLeaves /> (large leaves and fronds close to the lens)
//
// Frame budget: textures are built one stage per frame (see STAGES) so the first frames do not
// freeze for a second. All stages finish within a handful of frames, before the loader lifts.
//
// Camera geometry used for placement (base camera at (0, 0.9, 15), looking -Z, pitched up 20 degrees,
// FOV 50, 16:9): the horizontal half extent at depth d is about 0.829 * d, so ndc x = x / (0.829 d)
// where d = CAM_Z - z. The ground is only visible in the bottom 18 percent of the frame (rays below
// ndc y = -0.63), 6 to 30 units ahead, so ground cover density is spent there and in the foot of
// the hero tree.
//
// Triangle estimate (this file, plus about 2k in ForegroundLeaves): see TRIANGLES at the bottom
// of the file, printed on the root group as userData.triangles.

import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, PALETTE, TREE, groundHeight } from "@/lib/sceneConfig";
import { createRng, range } from "@/lib/random";
import { onPath } from "@/lib/sections/world";
import { clamp, createNoise, mix, smoothstep } from "@/lib/noise";
import {
  createBarkTextures,
  createFernFrondTexture,
  createGroundTextures,
  createLeafCardTexture,
  createMossTexture,
  withRepeat,
} from "@/lib/proceduralTextures";
import {
  buildLeafClusterGeometry,
  makeFoliageMaterial,
} from "@/lib/foliageMaterial";
import ForegroundLeaves, { addTube, createMesher, meshToGeometry } from "./ForegroundLeaves";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Texture sizes (toolkit default is 512, bark 768). Lower them to cut start-up time.
const TEX = { ground: 384, fern: 512, leaf: 512, moss: 256 };
// World size of one ground texture tile. The toolkit paints a tile as about 2 m of floor; 3.2 m
// keeps leaves a believable 10 to 13 cm while repeating less often (about 62 tiles over 200 units).
const GROUND_TILE = 3.2;

// Camera depth is measured from the real camera plane (CAMERA.position[2]), so a trunk placed at
// "depth d" lands at the intended screen x whatever the camera is tuned to.
const CAM_Z = CAMERA.position[2];

// Horizontal half extent of the view per unit of depth for the base camera at 16:9:
// tan(26 deg) * 16 / 9. Used to turn "screen x and depth" into world positions by hand.
const HALF_W = Math.tan((CAMERA.fov / 2) * DEG) * (16 / 9);
const viewX = (ndcX, depth) => ndcX * HALF_W * depth;

const LEAF_GLOW = new THREE.Color(PALETTE.leafHighlight).lerp(new THREE.Color(PALETTE.warmLight), 0.3);
const col = (hex) => new THREE.Color(hex);
// CSS hex of a brand colour blended toward another (for canvas painting).
const hexOf = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

// ------------------------------------------------------------------------------------------------
// Scene layout
// ------------------------------------------------------------------------------------------------
// Seven detailed background trees. Positions come from (screen x, depth from camera) so the
// trunks frame the hero tree instead of hiding it. depth = CAM_Z - z. "ndc" is the horizontal screen
// position of the trunk. Nothing sits between ndc -0.1 and 0.62 at a depth under 28, which is
// where the hero tree and cabin are.
const BG_TREES = [
  // left edge, near: frames the frame, half out of shot
  { x: viewX(-0.92, 15), z: CAM_Z - 15, h: 27, r: 0.95, seed: 1, lean: [-0.9, -0.5] },
  // just left of the hero trunk, mid distance, partly fogged (kept out of the hero text column)
  { x: viewX(-0.22, 24), z: CAM_Z - 24, h: 31, r: 1.0, seed: 2, lean: [0.8, -0.6] },
  // far left behind the text, deep in the mist
  { x: viewX(-0.6, 38), z: CAM_Z - 38, h: 33, r: 1.05, seed: 3, lean: [-0.4, 0.5] },
  // right of the cabin, far
  { x: viewX(0.75, 30), z: CAM_Z - 30, h: 28, r: 0.95, seed: 4, lean: [0.9, -0.3] },
  // right edge, near, runs out of frame
  { x: viewX(0.95, 16), z: CAM_Z - 16, h: 26, r: 0.9, seed: 5, lean: [0.6, -0.8] },
  // deep behind the cabin: almost only a pale shadow in the mist
  { x: viewX(0.32, 45), z: CAM_Z - 45, h: 34, r: 1.1, seed: 6, lean: [0.2, 0.3] },
  // far left edge
  { x: viewX(-0.97, 42), z: CAM_Z - 42, h: 30, r: 1.0, seed: 7, lean: [-0.6, 0.4] },
];

// Rocks (mossy boulders) and fallen logs. All keep clear of the camera pocket and the hero roots.
const ROCKS = [
  { x: 4.9, z: 2.6, s: 0.5, seed: 1 },
  { x: 7.6, z: -0.6, s: 0.95, seed: 2 },
  { x: -6.3, z: -1.6, s: 0.62, seed: 3 },
  { x: -12.5, z: -7.0, s: 1.0, seed: 4 },
  { x: 3.2, z: -6.6, s: 0.7, seed: 5 },
];
const LOGS = [
  { from: [5.6, 4.4], to: [11.2, 1.4], r: 0.42, seed: 3 }, // mid right, lies across the view
  { from: [13.5, -6.2], to: [8.2, -9.8], r: 0.34, seed: 4 }, // behind the hero tree on the right, fogged
];

// ------------------------------------------------------------------------------------------------
// Placement helpers
// ------------------------------------------------------------------------------------------------
// True where ground cover must not go: the pocket in front of the lens, the hero trunk and roots,
// and the feet of the background trees.
// `low` cover (flat leaves, ivy) may come much closer to the lens than tall cover (ferns, sedge),
// which would clip the camera or fill the bottom of the frame. The wide pocket also left the
// portrait pose (camera dollied back, bottom of frame sees ground 5 to 11 m ahead) with a bare
// plate, so the near field carries low cover.
function blocked(x, z, pad = 0, low = false) {
  const pocket = low ? 3 : 6.5;
  if (Math.hypot(x - CAMERA.position[0], z - CAMERA.position[2]) < pocket + pad) return true;
  if (Math.hypot(x - TREE.x, z - TREE.z) < 2.3 + pad) return true;
  for (const t of BG_TREES) if (Math.hypot(x - t.x, z - t.z) < t.r * 2.6 + pad) return true;
  // Section 2: no hero ground cover (ferns, ivy, sedge, litter) on the worn dirt path, which
  // PathAndGround draws. onPath scans 97 path samples (about 0.15 ms), so a bounding box around the
  // path (x -1.6 to 2.1, z 3.1 to 15, plus the clear half width and a margin) rejects nearly every
  // candidate first. Low cover may touch the verge, tall cover keeps 0.15 m further off.
  if (x > -3 && x < 3.5 && z > 1.8 && z < 16.5 && onPath(x, z, low ? 0 : 0.15)) return true;
  return false;
}

// True on the left of the view, where the hero text sits: keep it low, dark and calm.
function inTextZone(x, z) {
  return x / (HALF_W * Math.max(CAM_Z - z, 1)) < -0.05;
}

const _dummy = new THREE.Object3D();

function createInstances() {
  return { m: [], c: [] };
}

// Appends one instance: translation, yaw then tilt (Euler YXZ), uniform or per-axis scale, colour.
function pushInstance(inst, p, { yaw = 0, tilt = 0, roll = 0, sx = 1, sy = sx, sz = sx }, color) {
  _dummy.position.set(p[0], p[1], p[2]);
  _dummy.rotation.set(tilt, yaw, roll, "YXZ");
  _dummy.scale.set(sx, sy, sz);
  _dummy.updateMatrix();
  for (let i = 0; i < 16; i++) inst.m.push(_dummy.matrix.elements[i]);
  inst.c.push(color.r, color.g, color.b);
}

// InstancedMesh from a built instance list. Colours are per instance (multiplied with the albedo).
function makeInstanced(geometry, material, inst, { cast = false, receive = true, depth = null } = {}) {
  const count = inst.m.length / 16;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.array.set(inst.m);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(inst.c), 3);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (depth) mesh.customDepthMaterial = depth;
  mesh.computeBoundingSphere();
  return mesh;
}

function triangleCount(obj) {
  const g = obj.geometry;
  const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  return obj.isInstancedMesh ? per * obj.count : per;
}

// ------------------------------------------------------------------------------------------------
// Small painted textures (canvas 2D): sedge tuft and fallen leaf atlas
// ------------------------------------------------------------------------------------------------
// Canvas RGBA keeps black in fully transparent pixels, which would darken the mips at the cut-out
// edge. Replace the colour of every transparent pixel with the mean colour of the opaque ones.
function bleedRegion(ctx, x0, y0, w, h) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  if (n === 0) return;
  r /= n;
  g /= n;
  b /= n;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, x0, y0);
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// A tuft of sedge / grass blades: tapered curved blades fanning from the bottom centre, dark at
// the root, lighter and a little yellow at the tip, a few straw-coloured dead blades.
function makeTuftTexture() {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  const rng = createRng(404);
  const blades = 17;
  for (let b = 0; b < blades; b++) {
    const straw = rng() < 0.18;
    const bx = S / 2 + (rng() - 0.5) * S * 0.22;
    const by = S - 2;
    const L = S * range(rng, 0.5, 0.96);
    const lean = (rng() - 0.5) * 0.95; // horizontal drift of the tip as a fraction of the length
    const curve = (rng() - 0.5) * 0.8; // extra bow toward the tip
    const w0 = range(rng, 3.5, 8);
    const left = [];
    const right = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // centre line and its tangent
      const cx = bx + L * (lean * t + curve * t * t);
      const cy = by - L * t * (1 - 0.1 * t);
      const tx = L * (lean + 2 * curve * t);
      const ty = -L * (1 - 0.2 * t);
      const tl = Math.hypot(tx, ty);
      const nx = -ty / tl;
      const ny = tx / tl;
      const w = w0 * Math.pow(1 - t, 0.85) + 0.3;
      left.push([cx + nx * w, cy + ny * w]);
      right.push([cx - nx * w, cy - ny * w]);
    }
    const tipX = bx + L * (lean + curve);
    const tipY = by - L * 0.9;
    const grad = g.createLinearGradient(bx, by, tipX, tipY);
    if (straw) {
      grad.addColorStop(0, hexOf(PALETTE.barkDark, PALETTE.mossTone, 0.25));
      grad.addColorStop(0.5, hexOf(PALETTE.litterWarm, PALETTE.mossTone, 0.35));
      grad.addColorStop(1, hexOf(PALETTE.wood, PALETTE.leafHighlight, 0.3));
    } else {
      grad.addColorStop(0, hexOf(PALETTE.floorDark, PALETTE.leafDark, 0.5));
      grad.addColorStop(0.45, hexOf(PALETTE.leafDark, PALETTE.leafMid, 0.45));
      grad.addColorStop(1, hexOf(PALETTE.leafMid, PALETTE.leafHighlight, 0.55));
    }
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left) g.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
    g.fill();
    // faint darker midrib so a blade is not a flat colour
    g.strokeStyle = "rgba(20,30,12,0.28)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx, by);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      g.lineTo(bx + L * (lean * t + curve * t * t), by - L * t * (1 - 0.1 * t));
    }
    g.stroke();
  }
  bleedRegion(g, 0, 0, S, S);
  return canvasTexture(canvas);
}

// 2 x 2 atlas of single fallen leaves in autumn colours (oak, beech, hazel, sweet chestnut).
// Each leaf: outline from a width profile, a colour gradient base to tip, mottling, midrib and
// side veins, a darker rim and a few insect holes cut out of the alpha.
export function makeLeafAtlas() {
  const S = 512;
  const cell = S / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  const rng = createRng(77);
  // Litter colours are derived from the brand tokens: warm timber-brown leaves carrying more and
  // more moss green, each fading to the deep forest tone at the tip. Moss weighted, not orange.
  const litter = (mossAmount) => {
    const top = new THREE.Color(PALETTE.litterWarm).lerp(new THREE.Color(PALETTE.mossTone), mossAmount);
    const tip = top.clone().lerp(new THREE.Color(PALETTE.floorDark), 0.5);
    return [`#${top.getHexString()}`, `#${tip.getHexString()}`];
  };
  const palettes = [litter(0.1), litter(0.25), litter(0.0), litter(0.45)];
  // half width of the leaf at t (0 base, 1 tip) for each species
  const profile = [
    (t, len) => len * 0.26 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.8) * (0.72 + 0.28 * Math.cos(t * TAU * 3.5 + 0.6)),
    (t, len) => len * 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9),
    (t, len) => len * 0.36 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.75) * (0.93 + 0.07 * Math.cos(t * TAU * 9)),
    (t, len) => len * 0.16 * Math.pow(Math.sin(Math.PI * t), 0.7) * (0.9 + 0.1 * Math.cos(t * TAU * 12)),
  ];
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * cell;
    const oy = Math.floor(k / 2) * cell;
    const cx = ox + cell / 2;
    const base = oy + cell - 14;
    const len = cell * 0.84;
    const bend = (rng() - 0.5) * 0.14 * len;
    const asym = [range(rng, 0.9, 1.1), range(rng, 0.9, 1.1)];
    const steps = 48;
    const outline = () => {
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = cx - profile[k](t, len) * asym[0] + bend * Math.sin(Math.PI * t);
        const y = base - t * len;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        g.lineTo(cx + profile[k](t, len) * asym[1] + bend * Math.sin(Math.PI * t), base - t * len);
      }
      g.closePath();
    };
    g.save();
    outline();
    g.clip();
    const grad = g.createLinearGradient(cx, base, cx, base - len);
    grad.addColorStop(0, palettes[k][0]);
    grad.addColorStop(1, palettes[k][1]);
    g.fillStyle = grad;
    g.fillRect(ox, oy, cell, cell);
    // mottling: damp dark patches and bleached flecks
    for (let i = 0; i < 90; i++) {
      const dark = rng() < 0.6;
      g.fillStyle = dark ? "rgba(30,18,8,0.16)" : "rgba(210,170,100,0.12)";
      g.beginPath();
      g.arc(ox + rng() * cell, oy + rng() * cell, range(rng, 2, 9), 0, TAU);
      g.fill();
    }
    // midrib and side veins
    g.strokeStyle = "rgba(225,190,130,0.4)";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx, base + 4);
    for (let i = 1; i <= 24; i++) {
      const t = (i / 24) * 0.95;
      g.lineTo(cx + bend * Math.sin(Math.PI * t), base - t * len);
    }
    g.stroke();
    g.lineWidth = 1.1;
    g.strokeStyle = "rgba(225,190,130,0.26)";
    for (let i = 1; i <= 7; i++) {
      const t = i / 8.5;
      const mx = cx + bend * Math.sin(Math.PI * t);
      const my = base - t * len;
      for (const side of [-1, 1]) {
        const reach = profile[k](Math.min(t + 0.12, 1), len) * 0.85 * (side < 0 ? asym[0] : asym[1]);
        g.beginPath();
        g.moveTo(mx, my);
        g.quadraticCurveTo(mx + side * reach * 0.5, my - reach * 0.15, mx + side * reach, my - reach * 0.55);
        g.stroke();
      }
    }
    // insect holes
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 3; i++) {
      const t = range(rng, 0.25, 0.8);
      g.beginPath();
      g.ellipse(cx + range(rng, -1, 1) * profile[k](t, len) * 0.5, base - t * len, range(rng, 2, 6), range(rng, 2, 5), rng() * 3, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
    g.restore();
    // darker rim
    g.strokeStyle = "rgba(40,24,10,0.55)";
    g.lineWidth = 1.6;
    outline();
    g.stroke();
    bleedRegion(g, ox, oy, cell, cell);
  }
  return canvasTexture(canvas);
}

// ------------------------------------------------------------------------------------------------
// Blobs: noise-displaced smooth stones and moss cushions
// ------------------------------------------------------------------------------------------------
// Normals of an indexed mesh where vertices that coincide (UV seams, poles) are welded, so the
// shading has no seam. Area weighted face normals accumulated per quantised position.
function weldedNormals(pos, idx) {
  const keyOf = (i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const sums = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let f = 0; f < idx.length; f += 3) {
    a.fromArray(pos, idx[f] * 3);
    b.fromArray(pos, idx[f + 1] * 3);
    c.fromArray(pos, idx[f + 2] * 3);
    n.crossVectors(b.sub(a), c.sub(a));
    for (let k = 0; k < 3; k++) {
      const key = keyOf(idx[f + k]);
      let s = sums.get(key);
      if (!s) {
        s = new THREE.Vector3();
        sums.set(key, s);
      }
      s.add(n);
    }
  }
  const out = new Float32Array(pos.length);
  const t = new THREE.Vector3();
  for (let i = 0; i < pos.length / 3; i++) {
    t.copy(sums.get(keyOf(i))).normalize();
    out[i * 3] = t.x;
    out[i * 3 + 1] = t.y;
    out[i * 3 + 2] = t.z;
  }
  return out;
}

// Appends a displaced blob to the mesher.
//   sx, sy, sz   radii (sy is the height, usually about half of sx for a sitting stone)
//   moss         0 = bare grey-brown stone ... 1 = fully carpeted
//   lumpy        amplitude of the noise displacement
// The surface is a UV sphere pushed by three octaves of simplex noise (large lumps, ridged
// fractures, fine grain) and sunk so its flattened underside is buried in the ground. Vertex
// colours carry the moss mask (up facing, noisy) and darker damp lower flanks; the moss PBR maps
// supply the micro relief.
function addBlob(m, noise, { x, y, z, sx, sy, sz, seed, moss = 0.8, lumpy = 1, segW = 14, segH = 10, yaw = 0 }) {
  const sphere = new THREE.SphereGeometry(1, segW, segH);
  const sp = sphere.attributes.position;
  const su = sphere.attributes.uv;
  const count = sp.count;
  const pos = new Float32Array(count * 3);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const o = seed * 7.13;
  for (let i = 0; i < count; i++) {
    const dx = sp.getX(i);
    const dy = sp.getY(i);
    const dz = sp.getZ(i);
    const lump = noise.simplex3(dx * 1.3 + o, dy * 1.3, dz * 1.3);
    const ridge = 1 - Math.abs(noise.simplex3(dx * 3.1 + o * 2, dy * 3.1 + 5, dz * 3.1)); // fracture creases
    const grain = noise.simplex3(dx * 8, dy * 8 + o, dz * 8);
    const rr = 1 + lumpy * (0.22 * lump + 0.1 * (ridge - 0.5) + 0.03 * grain);
    // flatten the underside so the stone sits in the ground rather than balancing on a point
    const py = Math.max(dy * rr * sy, -0.25 * sy);
    const px = dx * rr * sx;
    const pz = dz * rr * sz;
    pos[i * 3] = px * cs - pz * sn;
    pos[i * 3 + 1] = py;
    pos[i * 3 + 2] = px * sn + pz * cs;
  }
  const idx = sphere.index.array;
  const nor = weldedNormals(pos, idx);
  const base = m.pos.length / 3;
  const stone = [1.25, 0.95, 1.05];
  const mossy = [0.9, 1.02, 0.85];
  for (let i = 0; i < count; i++) {
    const px = pos[i * 3] + x;
    const py = pos[i * 3 + 1] + y;
    const pz = pos[i * 3 + 2] + z;
    m.pos.push(px, py, pz);
    m.nor.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
    m.uv.push(su.getX(i) * 3 + seed * 0.37, su.getY(i) * 2);
    // moss on the up-facing surface, broken by noise, thinner on the steep flanks
    const up = nor[i * 3 + 1];
    const patch = 0.5 + 0.5 * noise.simplex3(px * 2.3, py * 2.3 + o, pz * 2.3);
    const mask = clamp(smoothstep(0.0, 0.65, up + 0.45 * (patch - 0.4)) * (0.35 + 0.65 * moss) + 0.2 * moss);
    const damp = 0.55 + 0.45 * smoothstep(-0.7, 0.3, up);
    const sp2 = 0.9 + 0.2 * noise.simplex3(px * 9, py * 9, pz * 9);
    m.col.push(
      mix(stone[0], mossy[0], mask) * damp * sp2,
      mix(stone[1], mossy[1], mask) * damp * sp2,
      mix(stone[2], mossy[2], mask) * damp * sp2
    );
  }
  for (let i = 0; i < idx.length; i++) m.idx.push(base + idx[i]);
  sphere.dispose();
}

// ------------------------------------------------------------------------------------------------
// GROUND
// ------------------------------------------------------------------------------------------------
// Grid lines along one axis: spacing grows with distance from the focus so the ground the camera
// sees (6 to 30 units ahead) is finest and the invisible far field is coarse.
function axisCoords(focus, minus, plus) {
  const out = [focus];
  let d = 0;
  while (d < plus - 0.01) {
    d = Math.min(plus, d + 2.7 + 0.09 * d);
    out.push(focus + d);
  }
  d = 0;
  while (d < minus - 0.01) {
    d = Math.min(minus, d + 2.7 + 0.09 * d);
    out.unshift(focus - d);
  }
  return out;
}

function buildGround() {
  const tex = createGroundTextures({ seed: 11, size: TEX.ground });
  const xs = axisCoords(1, 100, 100);
  const zs = axisCoords(2, 105, 22);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const colr = new Float32Array(nx * nz * 3);
  const noise = createNoise(31);
  const n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = groundHeight(x, z);
      pos[k * 3 + 2] = z;
      // analytic normal from the height function so the coarse grid still shades smoothly
      const e = 0.6;
      n.set(
        groundHeight(x - e, z) - groundHeight(x + e, z),
        2 * e,
        groundHeight(x, z - e) - groundHeight(x, z + e)
      ).normalize();
      nor[k * 3] = n.x;
      nor[k * 3 + 1] = n.y;
      nor[k * 3 + 2] = n.z;
      uv[k * 2] = x / GROUND_TILE;
      uv[k * 2 + 1] = z / GROUND_TILE;
      // Macro variation at 5 to 60 m: moss patches, dry litter, damp dark hollows. This is what
      // keeps a 3 m texture tile from reading as a repeating pattern.
      const m1 = noise.fbm2(x * 0.04 + 5, z * 0.04 + 9, 3);
      const m2 = noise.fbm2(x * 0.1 + 40, z * 0.1 - 12, 3);
      const m3 = noise.fbm2(x * 0.017 - 7, z * 0.017 + 3, 2);
      const mossAmt = smoothstep(0.0, 0.35, m1);
      const dryAmt = smoothstep(0.0, 0.35, -m1);
      const br = 1 + 0.5 * m2 + 0.3 * m3;
      // soft pool of shade under the hero canopy
      const shade = 1 - 0.3 * (1 - smoothstep(4, 18, Math.hypot(x - TREE.x, z - TREE.z)));
      colr[k * 3] = br * shade * (1 + 0.2 * dryAmt - 0.22 * mossAmt);
      colr[k * 3 + 1] = br * shade * (1 + 0.14 * mossAmt - 0.04 * dryAmt);
      colr[k * 3 + 2] = br * shade * (1 - 0.14 * dryAmt - 0.18 * mossAmt);
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // viewed from above (+Y), (a, c, b) and (b, c, d) are counter clockwise, normal up
      idx.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: tex.roughnessMap,
    aoMap: tex.roughnessMap,
    aoMapIntensity: 1,
    roughness: 0.92, // damp leaf litter: the map's green channel varies it from there
    metalness: 0,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "forest-floor";
  return { objects: [mesh], dispose: () => [geometry, material].forEach((r) => r.dispose()) };
}

// ------------------------------------------------------------------------------------------------
// GROUND COVER (ferns, ivy, sedge, fallen leaves)
// ------------------------------------------------------------------------------------------------
function buildCoverPlacements() {
  const rng = createRng(4242);
  const tint = new THREE.Color();
  const ferns = createInstances();
  const ivy = createInstances();
  const grass = createInstances();
  const leaves = [createInstances(), createInstances(), createInstances(), createInstances()];

  // multiplies the albedo: a near-white green so the painted texture keeps its own colours
  const setTint = (b, hue = 1) => tint.setRGB(b * range(rng, 0.88, 1.04) * hue, b, b * range(rng, 0.75, 0.98));

  // Each fern clump is three cards arching outward at 120 degree steps. A negative tilt leans the
  // top toward the card's back (-Z) so the front face and its normal look up and out, the way the
  // upper side of a frond does (the foliage material shades both faces with the same normal).
  const addFern = (x, z, scale, dark) => {
    if (blocked(x, z)) return false;
    const gh = groundHeight(x, z);
    const yaw0 = rng() * TAU;
    for (let k = 0; k < 3; k++) {
      const yaw = yaw0 + (k / 3) * TAU + range(rng, -0.45, 0.45);
      const s = scale * range(rng, 0.8, 1.2);
      setTint(range(rng, 0.62, 0.98) * (dark ? 0.72 : 1));
      pushInstance(ferns, [x + Math.cos(yaw) * 0.05, gh - 0.03, z + Math.sin(yaw) * 0.05], { yaw, tilt: -range(rng, 0.5, 0.95), sx: s }, tint);
    }
    return true;
  };

  // 1. around the foot of the hero tree (denser, bigger)
  let n = 0;
  for (let tries = 0; tries < 200 && n < 22; tries++) {
    const a = rng() * TAU;
    const r = range(rng, 2.7, 7.5);
    if (addFern(TREE.x + Math.cos(a) * r, TREE.z + Math.sin(a) * r, range(rng, 1.0, 1.5), false)) n++;
  }
  // 2. mid ground to the right of the tree (the open side of the frame)
  n = 0;
  for (let tries = 0; tries < 200 && n < 16; tries++) {
    if (addFern(range(rng, 4.5, 13), range(rng, -7, 5), range(rng, 0.9, 1.4), false)) n++;
  }
  // 3. left: calm. Only far enough away to be soft and misty, and darker
  n = 0;
  for (let tries = 0; tries < 300 && n < 12; tries++) {
    const x = range(rng, -12, -3.5);
    const z = range(rng, -9, 2);
    if (inTextZone(x, z) && CAM_Z - z < 11) continue;
    if (addFern(x, z, range(rng, 0.8, 1.25), true)) n++;
  }
  // 4. far scatter, bigger so it still reads through the mist
  n = 0;
  for (let tries = 0; tries < 200 && n < 12; tries++) {
    if (addFern(range(rng, -26, 26), range(rng, -32, -10), range(rng, 1.4, 2.0), true)) n++;
  }

  // Ivy sprigs lie almost flat: at the tree foot, beside stones and logs, and loose on the ground
  const addIvy = (x, z, scale) => {
    if (blocked(x, z, 0, true)) return;
    const gh = groundHeight(x, z);
    setTint(range(rng, 0.6, 0.95), 0.95);
    pushInstance(ivy, [x, gh + 0.02, z], { yaw: rng() * TAU, tilt: -range(rng, 1.05, 1.4), sx: scale * range(rng, 0.8, 1.3) }, tint);
  };
  for (let i = 0; i < 22; i++) {
    const a = rng() * TAU;
    const r = range(rng, 2.5, 6);
    addIvy(TREE.x + Math.cos(a) * r, TREE.z + Math.sin(a) * r, 1.0);
  }
  for (const rk of ROCKS) {
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU;
      addIvy(rk.x + Math.cos(a) * rk.s * 1.3, rk.z + Math.sin(a) * rk.s * 1.3, 0.9);
    }
  }
  for (let i = 0; i < 14; i++) addIvy(range(rng, -16, 16), range(rng, -14, 4), 1.0);
  // Low ivy sprigs across the near field (bottom of the frame, mostly seen in portrait)
  for (let i = 0; i < 10; i++) addIvy(range(rng, -5, 9), range(rng, 6.5, 12.5), range(rng, 0.7, 1.0));

  // Sedge tufts
  for (let i = 0; i < 70; i++) {
    let x;
    let z;
    if (rng() < 0.4) {
      const a = rng() * TAU;
      const r = range(rng, 3, 9);
      x = TREE.x + Math.cos(a) * r;
      z = TREE.z + Math.sin(a) * r;
    } else {
      x = range(rng, -16, 16);
      z = range(rng, -14, 5);
    }
    if (blocked(x, z)) continue;
    const dark = inTextZone(x, z);
    setTint(range(rng, 0.7, 1.05) * (dark ? 0.75 : 1), 0.96);
    pushInstance(grass, [x, groundHeight(x, z) - 0.02, z], { yaw: rng() * TAU, tilt: range(rng, -0.08, 0.12), sx: range(rng, 0.6, 1.2) }, tint);
  }

  // Fallen leaves: small flat cards. 55 percent near the tree, the rest across the visible band.
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 40; i++) {
      let x;
      let z;
      const pick = rng();
      if (pick < 0.45) {
        const a = rng() * TAU;
        const r = range(rng, 2.4, 9);
        x = TREE.x + Math.cos(a) * r;
        z = TREE.z + Math.sin(a) * r;
      } else if (pick < 0.75) {
        // near field, the ground strip at the bottom of the frame
        x = range(rng, -6, 10);
        z = range(rng, 6.5, 13);
      } else {
        x = range(rng, -14, 14);
        z = range(rng, -10, 6.5);
      }
      if (blocked(x, z, -0.5, true)) continue;
      const b = range(rng, 0.6, 1.05);
      tint.setRGB(b, b * range(rng, 0.9, 1.02), b * range(rng, 0.8, 1));
      const s = range(rng, 0.11, 0.2);
      pushInstance(leaves[k], [x, groundHeight(x, z) + 0.02, z], { yaw: rng() * TAU, tilt: range(rng, -0.1, 0.1), roll: range(rng, -0.1, 0.1), sx: s }, tint);
    }
  }
  return { ferns, ivy, grass, leaves };
}

function buildGroundCover() {
  const fernTex = createFernFrondTexture({ seed: 2, size: TEX.fern });
  const ivyTex = createLeafCardTexture({ kind: "ivy", seed: 6, size: TEX.leaf });
  const tuftMap = makeTuftTexture();
  const leafAtlas = makeLeafAtlas();
  const place = buildCoverPlacements();
  const disposables = [tuftMap, leafAtlas];
  const objects = [];
  const wind = { amplitude: 0.035, speed: 1.2 };

  // Fern frond card: base at the bottom, a gentle arch along its length and a trough across it
  const fernGeo = buildLeafClusterGeometry({ cards: 1, width: 1, height: 1, bend: 0.3, cup: 0, segments: [1, 2], normalBlend: 0.7, pivot: "bottom", seed: 3 });
  const fernMat = makeFoliageMaterial({ map: fernTex.map, normalMap: fernTex.normalMap, translucency: 0.9, roughness: 0.7, normalScale: 0.8, transmissionColor: LEAF_GLOW, wind });
  objects.push(makeInstanced(fernGeo, fernMat, place.ferns, { cast: false, receive: true }));
  disposables.push(fernGeo, fernMat);

  const ivyGeo = buildLeafClusterGeometry({ cards: 1, width: 1, height: 1, bend: 0.2, segments: [1, 2], normalBlend: 0.45, pivot: "bottom", seed: 6 });
  const ivyMat = makeFoliageMaterial({ map: ivyTex.map, normalMap: ivyTex.normalMap, translucency: 0.7, roughness: 0.6, normalScale: 0.8, transmissionColor: LEAF_GLOW, wind });
  objects.push(makeInstanced(ivyGeo, ivyMat, place.ivy, { cast: false, receive: true }));
  disposables.push(ivyGeo, ivyMat);

  const tuftGeo = buildLeafClusterGeometry({ cards: 3, width: 0.8, height: 0.7, bend: 0.25, segments: [1, 1], normalBlend: 0.8, pivot: "bottom", seed: 9 });
  const tuftMat = makeFoliageMaterial({ map: tuftMap, normalMap: null, translucency: 0.6, roughness: 0.75, transmissionColor: LEAF_GLOW, wind: { amplitude: 0.04, speed: 1.6 } });
  objects.push(makeInstanced(tuftGeo, tuftMat, place.grass, { cast: false, receive: true }));
  disposables.push(tuftGeo, tuftMat);

  // Fallen leaves: one flat quad per atlas cell
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafAtlas,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  disposables.push(leafMat);
  for (let k = 0; k < 4; k++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    // remap uv to atlas cell k (canvas row 0 is the top, texture v = 1 at the top)
    const u0 = (k % 2) * 0.5;
    const v0 = 0.5 - Math.floor(k / 2) * 0.5;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
    disposables.push(g);
    objects.push(makeInstanced(g, leafMat, place.leaves[k], { cast: false, receive: true }));
  }
  return {
    objects,
    triangles: objects.reduce((s, o) => s + triangleCount(o), 0),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      objects.forEach((o) => o.dispose());
    },
  };
}

// ------------------------------------------------------------------------------------------------
// ROCKS, MOSS CUSHIONS, LOGS AND FUNGI
// ------------------------------------------------------------------------------------------------
function buildStoneAndWood() {
  const moss = createMossTexture({ seed: 4, size: TEX.moss });
  const bark = createBarkTextures({ seed: 7 });
  const noise = createNoise(77);
  const rng = createRng(909);
  const objects = [];
  const disposables = [];

  // --- rocks and moss cushions: one merged geometry, one draw call
  const stone = createMesher();
  for (const r of ROCKS) {
    addBlob(stone, noise, {
      x: r.x,
      y: groundHeight(r.x, r.z) + r.s * 0.12,
      z: r.z,
      sx: r.s * range(rng, 0.9, 1.25),
      sy: r.s * range(rng, 0.5, 0.7),
      sz: r.s * range(rng, 0.8, 1.1),
      seed: r.seed,
      moss: range(rng, 0.55, 0.9),
      yaw: rng() * TAU,
    });
  }
  // moss cushions: low, wide, fully carpeted lumps near the tree foot and rocks
  const cushions = [
    [4.3, -1.5, 0.7],
    [-2.6, -3.1, 0.55],
    [6.2, 3.4, 0.5],
    [-5.1, -4.6, 0.8],
    [0.4, -5.2, 0.6],
    [9.0, -3.8, 0.7],
  ];
  cushions.forEach(([x, z, s], i) => {
    addBlob(stone, noise, { x, y: groundHeight(x, z) + s * 0.05, z, sx: s, sy: s * 0.32, sz: s * 0.85, seed: 20 + i, moss: 1, lumpy: 0.7, segW: 10, segH: 6, yaw: rng() * TAU });
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    map: moss.map,
    normalMap: moss.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: moss.roughnessMap,
    aoMap: moss.roughnessMap,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const stoneGeo = meshToGeometry(stone);
  const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  objects.push(stoneMesh);
  disposables.push(stoneGeo, stoneMat);

  // --- logs: curved tubes lying in the ground, bark texture, moss and damp on the upper side
  const wood = createMesher();
  const shelves = createInstances();
  const shelfTint = new THREE.Color();
  const logQuat = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const out = new THREE.Vector3();
  for (const L of LOGS) {
    const N = 18;
    const dx = L.to[0] - L.from[0];
    const dz = L.to[1] - L.from[1];
    const len = Math.hypot(dx, dz);
    const px = -dz / len; // horizontal perpendicular to the log axis
    const pz = dx / len;
    const pts = [];
    const radii = [];
    const o = L.seed * 3.7;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const bow = 0.35 * Math.sin(Math.PI * s) + 0.12 * noise.simplex3(s * 3, o, 0);
      const x = L.from[0] + dx * s + px * bow;
      const z = L.from[1] + dz * s + pz * bow;
      // lies half sunk in the ground and follows its slope
      pts.push(new THREE.Vector3(x, groundHeight(x, z) + L.r * 0.62, z));
      radii.push(L.r * (1 - 0.2 * s) * (i === N - 1 ? 0.9 : 1));
    }
    const radiusAt = (i, a) =>
      radii[i] * (1 + 0.07 * noise.simplex3(Math.cos(a) * 1.4 + o, Math.sin(a) * 1.4, i * 0.4) + 0.025 * Math.sin(a * 7 + i * 0.7));
    addTube(wood, pts, {
      radial: 12,
      baseRadius: radii,
      radiusAt,
      uOffset: rng(),
      colorAt: (i, a, x, y, z) => {
        const up = (y - pts[i].y) / radii[i]; // 1 on top, -1 underneath
        const patch = 0.5 + 0.5 * noise.simplex3(x * 1.7 + o, z * 1.7, y * 1.7);
        const mask = smoothstep(0.1, 0.8, up + 0.5 * (patch - 0.45)) * 0.85;
        const damp = 0.6 + 0.4 * smoothstep(-0.8, 0.2, up);
        // bark multiplier (cool, wet) blended toward a moss multiplier on the upper side
        return [mix(0.7, 0.55, mask) * damp, mix(0.64, 1.25, mask) * damp, mix(0.58, 0.5, mask) * damp];
      },
      // sawn / broken ends: paler dry wood
      capStart: [0.95, 0.8, 0.6],
      capEnd: [0.9, 0.74, 0.54],
    });
    // bracket fungi on the side facing the camera
    for (const s of [0.28, 0.5, 0.74]) {
      const i = Math.round(s * (N - 1));
      const sign = pz > 0 ? 1 : -1; // pick the perpendicular that points toward +Z (the camera)
      out.set(px * sign, 0.12, pz * sign).normalize();
      const r = radii[i] * 0.98;
      const sz = range(rng, 0.1, 0.18);
      logQuat.setFromUnitVectors(Z, out);
      shelfTint.setRGB(range(rng, 0.85, 1), range(rng, 0.8, 0.95), range(rng, 0.7, 0.85));
      _dummy.position.set(pts[i].x + out.x * r, pts[i].y + out.y * r, pts[i].z + out.z * r);
      _dummy.quaternion.copy(logQuat);
      _dummy.scale.set(sz * 1.4, sz * 0.28, sz);
      _dummy.updateMatrix();
      for (let e = 0; e < 16; e++) shelves.m.push(_dummy.matrix.elements[e]);
      shelves.c.push(shelfTint.r, shelfTint.g, shelfTint.b);
    }
  }
  const woodMat = new THREE.MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: bark.roughnessMap,
    aoMap: bark.roughnessMap,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const woodGeo = meshToGeometry(wood);
  const woodMesh = new THREE.Mesh(woodGeo, woodMat);
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  objects.push(woodMesh);
  disposables.push(woodGeo, woodMat);

  // --- bracket fungi: thin lenses (a half sphere flattened by the instance matrix) with growth
  // rings in vertex colour, pale rim, darker centre
  const shelfGeo = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI);
  {
    const p = shelfGeo.attributes.position;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const rr = Math.hypot(p.getX(i), p.getZ(i)); // 0 at the log, 1 at the rim
      const ring = 0.5 + 0.5 * Math.sin(rr * 13);
      const t = clamp(0.25 + 0.5 * ring + 0.3 * rr);
      c[i * 3] = mix(0.5, 1, t);
      c[i * 3 + 1] = mix(0.4, 0.95, t);
      c[i * 3 + 2] = mix(0.27, 0.8, t);
    }
    shelfGeo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  }
  const shelfMat = new THREE.MeshStandardMaterial({ color: hexOf(PALETTE.stone, PALETTE.wood, 0.35), roughness: 0.55, metalness: 0, vertexColors: true });
  objects.push(makeInstanced(shelfGeo, shelfMat, shelves, { cast: false, receive: true }));
  disposables.push(shelfGeo, shelfMat);

  return {
    objects,
    triangles: objects.reduce((s, o) => s + triangleCount(o), 0),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      objects.forEach((o) => o.isInstancedMesh && o.dispose());
    },
  };
}

// ------------------------------------------------------------------------------------------------
// BACKGROUND TREES
// ------------------------------------------------------------------------------------------------
function buildBackgroundTrees() {
  const bark = createBarkTextures({ seed: 7 });
  const oakTex = createLeafCardTexture({ kind: "oak", seed: 3, size: TEX.leaf });
  const beechTex = createLeafCardTexture({ kind: "beech", seed: 4, size: TEX.leaf });
  const mesher = createMesher();
  const crowns = [createInstances(), createInstances()]; // oak, beech
  // One dark, leaf coloured ellipsoid inside every crown. The sprig cards are only about 60 percent
  // opaque, so without it the sky shows through every gap and, being brighter than the fog the
  // crown is tinted into, turns the crown into a field of pale polka dots. With it a gap shows
  // the shaded interior of the crown. It sits at 58 percent of the crown radii (82 percent showed as a flat grey umbrella
  // underneath the sparse lower cards), so the cards define the silhouette.
  const massInst = createInstances();
  const camPos = new THREE.Vector3(...CAMERA.position);
  const leafDark = col(PALETTE.leafDark);
  const leafMid = col(PALETTE.leafMid);
  const mist = col(PALETTE.fogDark).multiplyScalar(0.4);
  const tint = new THREE.Color();
  const V = THREE.Vector3;

  BG_TREES.forEach((spec) => {
    const rng = createRng(500 + spec.seed * 13);
    const noise = createNoise(100 + spec.seed);
    const gh = groundHeight(spec.x, spec.z);
    const dist = Math.hypot(spec.x - camPos.x, spec.z - camPos.z);
    // 0 near, 1 far: drives the cool, dark tint that adds to the scene fog
    const haze = clamp((dist - 12) / 34);
    const ph = [rng() * TAU, rng() * TAU, rng() * TAU];

    // Trunk centre line offset at height y: a lean that grows toward the crown plus slow wobble
    const centre = (y) => {
      const u = clamp(y / spec.h);
      const g = Math.min(1, Math.max(y, 0) / 5);
      return [
        spec.x + spec.lean[0] * Math.pow(u, 1.8) + noise.perlin2(y * 0.07 + 11, spec.seed) * 0.5 * g,
        spec.z + spec.lean[1] * Math.pow(u, 1.8) + noise.perlin2(y * 0.07 + 31, spec.seed + 9) * 0.5 * g,
      ];
    };

    // --- trunk: rings denser near the base where the flare curves fastest
    const RINGS = 13;
    const pts = [];
    const radii = [];
    const hts = [];
    for (let i = 0; i < RINGS; i++) {
      const t = i / (RINGS - 1);
      const y = -0.6 + (spec.h + 0.6) * Math.pow(t, 1.25);
      const u = clamp(y / spec.h);
      const [cx, cz] = centre(y);
      pts.push(new V(cx, gh + y, cz));
      hts.push(y);
      // taper to 40 percent at the crown, with a wide flare that dies away over the first 3 m
      radii.push(spec.r * mix(1, 0.4, Math.pow(u, 0.9)) * (1 + 0.85 * Math.exp(-Math.max(y, 0) * 0.65)));
    }
    const radiusAt = (i, a) => {
      const y = hts[i];
      const base = Math.exp(-Math.max(y, 0) * 0.9);
      // low flutes, buttress ridges at the base and a little lumpiness (circle-embedded so it wraps)
      const flute = 0.05 * Math.sin(3 * a + ph[0] + y * 0.07) * (1 + 1.5 * Math.exp(-y * 0.4)) + 0.035 * Math.sin(5 * a + ph[1]);
      const buttress = 0.22 * base * Math.pow(Math.max(0, Math.sin(5 * a + ph[2])), 1.5);
      const lump = 0.05 * noise.simplex3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, y * 0.12 + spec.seed);
      return radii[i] * (1 + flute + buttress + lump);
    };
    const colorAt = (i, a, x, y, z) => {
      const yy = hts[i];
      const n = 0.5 + 0.5 * noise.simplex3(x * 0.4, y * 0.15, z * 0.4);
      // dark, desaturated bark multiplier, kept slightly warm (the fog and IBL supply the cool)
      let r = (0.66 + 0.22 * n);
      let g = 0.6 + 0.2 * n;
      let b = (0.55 + 0.2 * n) * 0.97;
      // moss climbing the lower trunk in patches
      const ms = smoothstep(4.5, 0, yy) * smoothstep(-0.1, 0.6, noise.simplex3(x * 0.7, y * 0.5, z * 0.7)) * 0.7;
      r = mix(r, 0.34, ms);
      g = mix(g, 0.72, ms);
      b = mix(b, 0.3, ms);
      // haze: far trees drift toward a cool grey
      r = mix(r, 0.5, haze * 0.3);
      g = mix(g, 0.58, haze * 0.3);
      b = mix(b, 0.64, haze * 0.3);
      return [r, g, b];
    };
    addTube(mesher, pts, { radial: 9, baseRadius: radii, radiusAt, uOffset: rng(), colorAt, capEnd: [0.3, 0.3, 0.3] });

    // --- lower limbs: three curved tubes between 30 and 58 percent of the height, they carry
    // clusters of leaves that frame the crown
    const tips = [];
    for (let b = 0; b < 2; b++) {
      const y0 = spec.h * range(rng, 0.38, 0.62);
      const az = rng() * TAU;
      const tilt = range(rng, 15, 38) * DEG;
      const L = range(rng, 0.1, 0.17) * spec.h;
      const [cx, cz] = centre(y0);
      const dx = Math.cos(az);
      const dz = Math.sin(az);
      const bp = [];
      for (let k = 0; k <= 5; k++) {
        const s = k / 5;
        // rises with a lift that eases off, plus a slow sideways wobble
        const lift = L * Math.sin(tilt) * s * (1.2 - 0.5 * s);
        const wob = 0.4 * Math.sin(s * 5 + b);
        bp.push(new V(cx + dx * L * s - dz * wob, gh + y0 + lift, cz + dz * L * s + dx * wob));
      }
      const curve = new THREE.CatmullRomCurve3(bp, false, "catmullrom", 0.5);
      const bpts = curve.getPoints(6);
      const rb = range(rng, 0.24, 0.34) * (spec.r / 0.95);
      const brad = bpts.map((_, i) => mix(rb, 0.05, Math.pow(i / 6, 0.75)));
      addTube(mesher, bpts, {
        radial: 5,
        baseRadius: brad,
        uOffset: rng(),
        colorAt: () => [0.5 - haze * 0.04, 0.5, 0.5 + haze * 0.06],
      });
      tips.push(curve);
    }

    // --- leaf clusters: a crown ellipsoid (shell biased, thinner underneath) plus clusters out
    // along the limbs. Per instance colour carries the cool, dark, hazy grade.
    const [ccx, ccz] = centre(spec.h * 0.84);
    const crown = new V(ccx, gh + spec.h * 0.84, ccz);
    const rad = [spec.h * 0.25, spec.h * 0.15, spec.h * 0.25];
    tint.copy(leafDark).lerp(leafMid, 0.45).multiplyScalar(0.8).lerp(mist, haze * 0.4);
    pushInstance(massInst, [crown.x, crown.y, crown.z], { yaw: spec.seed, sx: rad[0] * 0.58, sy: rad[1] * 0.6, sz: rad[2] * 0.58 }, tint);
    const addCluster = (p) => {
      const kind = rng() < 0.55 ? 0 : 1;
      const s = range(rng, 3.2, 5.0);
      tint.copy(leafDark).lerp(leafMid, rng() * 0.7).multiplyScalar(range(rng, 0.62, 0.95));
      tint.lerp(mist, haze * 0.4);
      _dummy.position.copy(p);
      _dummy.rotation.set(range(rng, -0.9, 0.9), rng() * TAU, range(rng, -0.9, 0.9), "YXZ");
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      const inst = crowns[kind];
      for (let e = 0; e < 16; e++) inst.m.push(_dummy.matrix.elements[e]);
      inst.c.push(tint.r, tint.g, tint.b);
    };
    const p = new V();
    for (let k = 0; k < 105; k++) {
      const cosT = rng() * 2 - 1;
      const sinT = Math.sqrt(1 - cosT * cosT);
      const phi = rng() * TAU;
      let r = Math.pow(rng(), 0.45);
      if (cosT < 0) r *= 0.75;
      p.set(crown.x + sinT * Math.cos(phi) * rad[0] * r, crown.y + cosT * rad[1] * r, crown.z + sinT * Math.sin(phi) * rad[2] * r);
      addCluster(p);
    }
    for (const curve of tips) {
      for (let k = 0; k < 12; k++) {
        const q = curve.getPointAt(range(rng, 0.4, 1));
        p.set(q.x + range(rng, -1.6, 1.6), q.y + range(rng, -0.8, 1.4), q.z + range(rng, -1.6, 1.6));
        addCluster(p);
      }
    }
  });

  const trunkGeo = meshToGeometry(mesher);
  const trunkMat = new THREE.MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: bark.roughnessMap,
    aoMap: bark.roughnessMap,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const trunks = new THREE.Mesh(trunkGeo, trunkMat);
  trunks.name = "background-trunks";

  const wind = { amplitude: 0.05, speed: 1.0 };
  const make = (tex, seed) => {
    const geometry = buildLeafClusterGeometry({ cards: 2, width: 1, height: 1, bend: 0.2, segments: [1, 1], normalBlend: 0.9, pivot: "center", seed });
    const material = makeFoliageMaterial({ map: tex.map, normalMap: tex.normalMap, translucency: 0.7, roughness: 0.78, normalScale: 0.6, transmissionColor: LEAF_GLOW, wind });
    return { geometry, material };
  };
  const oak = make(oakTex, 31);
  const beech = make(beechTex, 32);
  const oakMesh = makeInstanced(oak.geometry, oak.material, crowns[0], { cast: false, receive: false });
  const beechMesh = makeInstanced(beech.geometry, beech.material, crowns[1], { cast: false, receive: false });
  oakMesh.name = "background-crowns-oak";
  beechMesh.name = "background-crowns-beech";
  const massGeo = new THREE.SphereGeometry(1, 12, 8);
  const massMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0 });
  const massMesh = makeInstanced(massGeo, massMat, massInst, { cast: false, receive: false });
  massMesh.name = "background-crown-mass";
  const objects = [trunks, massMesh, oakMesh, beechMesh];
  return {
    objects,
    triangles: objects.reduce((s, o) => s + triangleCount(o), 0),
    dispose: () => {
      [trunkGeo, trunkMat, massGeo, massMat, oak.geometry, oak.material, beech.geometry, beech.material].forEach((r) => r.dispose());
      massMesh.dispose();
      oakMesh.dispose();
      beechMesh.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------------
// FAR TREE LINE
// ------------------------------------------------------------------------------------------------
function buildFarTrees() {
  const bark = createBarkTextures({ seed: 7 });
  // trunks are about 45 units tall and 4.7 round: repeat the bark 9 times along them
  const set = withRepeat(bark, 1, 9);
  // 7 sided, 1 unit tall, narrower at the top, origin at the foot
  const geometry = new THREE.CylinderGeometry(0.58, 1, 1, 7, 1, true);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 1,
    metalness: 0,
  });
  const rng = createRng(1717);
  const inst = createInstances();
  const tint = new THREE.Color();
  const COUNT = 28;
  for (let i = 0; i < COUNT; i++) {
    // depth 40 to 85, weighted toward the nearer end where the mist is still thin
    const depth = 40 + 45 * Math.pow(rng(), 1.7);
    const x = viewX(range(rng, -1.15, 1.15), depth);
    const z = CAM_Z - depth;
    const h = range(rng, 28, 52);
    // Widths from slim 0.2 m stems to 1.2 m trunks, skewed to the slim end, so the line is a mix
    // of ages instead of 28 identical posts.
    const r = 0.2 + 1.0 * Math.pow(rng(), 1.6);
    // Tone steps: most trunks sit deep in the haze, but a few are noticeably darker (nearer or in
    // shade), which gives the eye layers to separate instead of one grey wall.
    const b = rng() < 0.18 ? range(rng, 0.14, 0.2) : range(rng, 0.26, 0.5);
    tint.setRGB(b * 1.0, b * 0.98, b * 0.96);
    // Real trunks lean and wander: up to about 3.5 degrees each way, in any direction.
    pushInstance(inst, [x, groundHeight(x, z) - 0.5, z], { yaw: rng() * TAU, tilt: range(rng, -0.06, 0.06), roll: range(rng, -0.06, 0.06), sx: r, sy: h, sz: r }, tint);
  }
  const mesh = makeInstanced(geometry, material, inst, { cast: false, receive: false });
  mesh.name = "far-tree-line";
  return {
    objects: [mesh],
    triangles: triangleCount(mesh),
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Components
// ------------------------------------------------------------------------------------------------
// Renders an object list built by one of the builders above and disposes it on unmount.
function Built({ builder }) {
  const built = useMemo(() => builder(), [builder]);
  useEffect(() => () => built.dispose(), [built]);
  return (
    <>
      {built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </>
  );
}

// Stages are mounted one per frame so the texture painting (the expensive part) is spread out.
const STAGES = [buildGround, buildBackgroundTrees, buildGroundCover, buildStoneAndWood, buildFarTrees];

export default function ForestEnvironment() {
  const [stage, setStage] = useState(0);

  useFrame(() => {
    if (stage < STAGES.length + 1) setStage((s) => s + 1);
    // The shared wind clock is written only by HeroScene's WindClock (it honours reduced motion).
  });

  return (
    <group name="forest-environment">
      {STAGES.map((builder, i) => (stage > i ? <Built key={i} builder={builder} /> : null))}
      {stage > STAGES.length ? <ForegroundLeaves /> : null}
    </group>
  );
}
