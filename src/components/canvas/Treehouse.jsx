"use client";

// The luxury treehouse: a bespoke timber cabin on a bearer-and-joist deck, braced into the oak.
// Everything is procedural: merged boxes, lathes and tubes with PBR textures from the toolkit.
//
// Local frame: the group sits at (TREE.x, 0, TREE.z), +X right, +Y up, +Z toward the camera.
// The trunk axis passes through x = z = 0 at TREE.forkY (Tree.jsx leans it slightly above and
// below, see axisAt()). Deck top is PLATFORM.y; the deck footprint is PLATFORM.centerOffset
// +/- half width / depth.
//
// Vertical stack at the deck (all in metres):
//   8.80  deck top            planks 0.04 thick, 8 mm gaps, individually tinted and jittered
//   8.76  joists 0.15 deep    run along Z every 0.45, trimmed around the trunk hole
//   8.61  bearers 0.20 deep   three beams along X resting on the fork branches (tops 8.36-8.46),
//   8.41                      the two nearest the trunk sandwich it on a through rod
//   below struts, collars, lashing, lanterns: the underside is what the low camera sees.
//
// What the camera sees (camera at y = 0.9, 15 m away, looking up about 31 degrees at the deck):
// the underside, the front rim, the railing, the cabin front and its left wall at a grazing
// angle, the gable overhang soffit, and through the porch opening only a band of ceiling (rays
// leave the deck lip at slope 0.72). That band holds the warm pendant lantern and ridge beam.
//
// Triangle budget: see buildTreehouseModel().stats (about 12k total).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import Tree from "./Tree";
import { BRAND, PALETTE, PLATFORM, TREE, trunkRadiusAt } from "@/lib/sceneConfig";
import { createRng } from "@/lib/random";
import {
  createGlassSmudgeTexture,
  createLeafCardTexture,
  createMossTexture,
  createRopeTextures,
  createShingleTextures,
  createSoftSpriteTexture,
  createWoodTextures,
} from "@/lib/proceduralTextures";
import { buildLeafClusterGeometry, makeFoliageMaterial } from "@/lib/foliageMaterial";
import useReducedMotion from "@/hooks/useReducedMotion";
import useStaged from "@/hooks/useStaged";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const Y_UP = new THREE.Vector3(0, 1, 0);
const ID_Q = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const WHITE = [1, 1, 1];
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------------------------------------
// Dimensions
// ------------------------------------------------------------------------------------------------
const DECK_Y = PLATFORM.y;
const [DCX, DCZ] = PLATFORM.centerOffset;
const DX0 = DCX - PLATFORM.width / 2; // deck x range -1.9 .. 4.3
const DX1 = DCX + PLATFORM.width / 2;
const DZ0 = DCZ - PLATFORM.depth / 2; // deck z range -1.6 .. 3.2
const DZ1 = DCZ + PLATFORM.depth / 2;

const PLANK_T = 0.04;
const JOIST_H = 0.15;
const RIM_H = 0.19;
const BEAR_H = 0.2;
const JOIST_TOP = DECK_Y - PLANK_T;
const BEAR_TOP = JOIST_TOP - JOIST_H; // 8.61
const BEAR_BOT = BEAR_TOP - BEAR_H; // 8.41
const BEAR_Z = [-0.9, 0.9, DZ1 - 0.65]; // rear and front of the trunk, then the front bearer

// Cabin: 3.0 wide x 2.4 deep x 2.3 high walls, pushed to the back of the deck so a porch
// 2.2 m deep opens toward the camera.
const CAB = { x0: DX1 - 0.3 - 3.0, x1: DX1 - 0.3, z0: DZ0 + 1.1, z1: DZ0 + 1.1 + 2.4, h: 2.65, t: 0.09 };
CAB.top = DECK_Y + CAB.h; // wall plate level, 11.1
CAB.cx = (CAB.x0 + CAB.x1) / 2;
CAB.half = (CAB.x1 - CAB.x0) / 2;

// Roof: gable facing the camera, ridge along Z. Slope angle from rise 1.3 over half width 1.5.
const ROOF = { rise: 1.3, over: 0.45, overFront: 0.55, overBack: 0.45 };
ROOF.alpha = Math.atan2(ROOF.rise, CAB.half);
ROOF.cos = Math.cos(ROOF.alpha);
ROOF.sin = Math.sin(ROOF.alpha);
ROOF.tan = ROOF.rise / CAB.half;
ROOF.len = (CAB.half + ROOF.over) / ROOF.cos; // eave to ridge along the slope, 2.58
ROOF.z0 = CAB.z0 - ROOF.overBack;
ROOF.z1 = CAB.z1 + ROOF.overFront;
ROOF.depth = ROOF.z1 - ROOF.z0;
ROOF.zc = (ROOF.z0 + ROOF.z1) / 2;
ROOF.ridgeY = CAB.top + ROOF.rise; // underside apex 12.4
// Layer stack measured along the slope normal from the rafter underside:
//   rafters 0 .. 0.12, sheathing 0.12 .. 0.145, shingles 0.145 .. 0.19
const SHEATH_O = 0.1325;
const SHEATH_T = 0.025;
const SHINGLE_O = 0.1675;
const SHINGLE_T = 0.045;
const SHINGLE_TOP = SHINGLE_O + SHINGLE_T / 2; // 0.19
// Shingle surface apex is higher than the rafter apex by top / cos(alpha).
ROOF.apexY = ROOF.ridgeY + SHINGLE_TOP / ROOF.cos;

// Front door and windows (x/z positions in cabin space).
const DOOR = { x0: CAB.x0 + 1.25, h: 2.15 }; // opening runs from x0 to the right wall's inner face
// Windows sit high (sill 1.15 m): rays from the low camera clear the deck lip only above y = 10.4
// at the front wall, so a low window would be hidden behind the deck.
const WIN_FRONT = { x: CAB.x0 + 0.68, w: 0.5, h: 0.95, sill: DECK_Y + 1.15 };
const WIN_LEFT = { z: CAB.z0 + 0.75, w: 0.8, h: 1.0, sill: DECK_Y + 1.1 };

// Trunk axis (copied from Tree.jsx: a gentle lean that is zero at forkY).
const axisAt = (y) => ({
  x: 0.2 * Math.sin(0.45 * (y - TREE.forkY)),
  z: 0.15 * (Math.sin(0.31 * (y - TREE.forkY) + 0.4) - Math.sin(0.4)),
});

// ------------------------------------------------------------------------------------------------
// Colour constants. Vertex colours multiply the albedo textures in LINEAR space, so these are
// ratios between the toolkit texture mean and the brand swatch (warm timber #8A633F etc).
// ------------------------------------------------------------------------------------------------
const C_DECK = [1.24, 0.87, 0.61]; // silver-tan weathered board -> brand timber
const C_BEAM = [1.15, 1.1, 1.3]; // beam texture mean -> brand timber, then toned darker per piece
const C_WALL = [0.98, 0.9, 1.15];
const C_TRIM = [0.8, 0.75, 1.0]; // oiled rails sit a little darker than the cladding
const C_DOOR = [0.2, 0.55, 1.35]; // green wash over the plank grain
const C_CREAM = [0.7, 0.68, 0.61]; // weathered cream paint (BRAND.cream darkened)
const C_MOSSPAINT = [0.13, 0.17, 0.1]; // BRAND.moss paint
// Blackened wrought iron. For a metal the albedo is also the reflectance, so it cannot be near 0.
const C_IRON = [0.1, 0.104, 0.11];
const C_COPPER = [0.48, 0.17, 0.035];
const C_PATINA = [0.1, 0.3, 0.2];
const C_LEAD = [0.2, 0.205, 0.21];
const C_CLAY = [0.5, 0.17, 0.07];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const scaleC = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ------------------------------------------------------------------------------------------------
// Mesher: accumulates boxes and arbitrary geometry into ONE BufferGeometry per material.
// Attributes: position, normal, uv, color. Boxes get uvs in metres divided by a tile size so wood
// grain, board widths and shingle courses have believable physical scale.
// ------------------------------------------------------------------------------------------------
const FACES = [
  { n: 0, s: 1, a: 2, b: 1 },
  { n: 0, s: -1, a: 2, b: 1 },
  { n: 1, s: 1, a: 0, b: 2 },
  { n: 1, s: -1, a: 0, b: 2 },
  { n: 2, s: 1, a: 0, b: 1 },
  { n: 2, s: -1, a: 0, b: 1 },
];
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
// Winding per face: flip when (axis a) x (axis b) points against the outward normal.
const FACE_FLIP = FACES.map((f) => {
  const ea = new THREE.Vector3().setComponent(f.a, 1);
  const eb = new THREE.Vector3().setComponent(f.b, 1);
  return new THREE.Vector3().crossVectors(ea, eb).getComponent(f.n) * f.s < 0;
});

class Mesher {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
  }

  get tris() {
    return this.i.length / 3;
  }

  vert(px, py, pz, nx, ny, nz, u, v, c) {
    this.p.push(px, py, pz);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    this.c.push(c[0], c[1], c[2]);
    return this.p.length / 3 - 1;
  }

  // Oriented box. c centre, s size, q rotation. grain = axis (0,1,2) along which texture V runs.
  // tile = [u, v] metres per texture repeat. world = add the centre to the uv so adjacent pieces
  // of one wall line up. shade(P) multiplies the vertex colour. uvFn(local, face) overrides uvs.
  box({ c, s, q = null, color = WHITE, grain = null, tile = [1, 1], off = [0, 0], world = false, shade = null, uvFn = null }) {
    const half = [s[0] / 2, s[1] / 2, s[2] / 2];
    const loc = [0, 0, 0];
    const P = new THREE.Vector3();
    const N = new THREE.Vector3();
    FACES.forEach((f, fi) => {
      const first = this.p.length / 3;
      for (const [ca, cb] of CORNERS) {
        loc[f.n] = f.s * half[f.n];
        loc[f.a] = ca * half[f.a];
        loc[f.b] = cb * half[f.b];
        let u;
        let v;
        if (uvFn) {
          [u, v] = uvFn(loc, f);
        } else {
          const ua = loc[f.a] + (world ? c[f.a] : 0);
          const ub = loc[f.b] + (world ? c[f.b] : 0);
          if (grain === f.a) {
            // rotate the texture a quarter turn so V (the grain) follows axis a
            u = -ub / tile[0];
            v = ua / tile[1];
          } else {
            u = ua / tile[0];
            v = ub / tile[1];
          }
        }
        P.set(loc[0], loc[1], loc[2]);
        N.set(0, 0, 0).setComponent(f.n, f.s);
        if (q) {
          P.applyQuaternion(q);
          N.applyQuaternion(q);
        }
        P.x += c[0];
        P.y += c[1];
        P.z += c[2];
        const m = shade ? shade(P) : 1;
        this.vert(P.x, P.y, P.z, N.x, N.y, N.z, u + off[0], v + off[1], [color[0] * m, color[1] * m, color[2] * m]);
      }
      if (FACE_FLIP[fi]) this.i.push(first, first + 2, first + 1, first, first + 3, first + 2);
      else this.i.push(first, first + 1, first + 2, first, first + 2, first + 3);
    });
  }

  // Flat triangle with a given normal (gables, flags).
  tri(a, b, d, n, uvs, color) {
    const k = this.p.length / 3;
    this.vert(a.x, a.y, a.z, n.x, n.y, n.z, uvs[0][0], uvs[0][1], color);
    this.vert(b.x, b.y, b.z, n.x, n.y, n.z, uvs[1][0], uvs[1][1], color);
    this.vert(d.x, d.y, d.z, n.x, n.y, n.z, uvs[2][0], uvs[2][1], color);
    this.i.push(k, k + 1, k + 2);
  }

  // Copy any indexed geometry in, transformed by matrix m. tint(P) optionally scales the colour.
  geo(g, m, color = WHITE, uvScale = [1, 1], tint = null) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.p.length / 3;
    const P = new THREE.Vector3();
    const N = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      P.fromBufferAttribute(pos, k).applyMatrix4(m);
      N.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
      const t = tint ? tint(P) : 1;
      this.vert(
        P.x,
        P.y,
        P.z,
        N.x,
        N.y,
        N.z,
        uv ? uv.getX(k) * uvScale[0] : 0,
        uv ? uv.getY(k) * uvScale[1] : 0,
        [color[0] * t, color[1] * t, color[2] * t]
      );
    }
    const idx = g.index;
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// Quaternion whose local +X runs along dir and whose local +Y is as close to `up` as possible.
function quatAlong(dir, up = Y_UP) {
  const x = dir.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, up);
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const quatYTo = (dir) => new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.clone().normalize());
const rotY = (a) => new THREE.Quaternion().setFromAxisAngle(Y_UP, a);
const rotZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const longestAxis = (s) => (s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2);

// Timber (a box) running from A to B, h tall (local Y) and w wide (local Z).
function timber(mesher, A, B, h, w, color, extra = {}) {
  const L = A.distanceTo(B);
  mesher.box({
    c: A.clone().add(B).multiplyScalar(0.5).toArray(),
    s: [L, h, w],
    q: quatAlong(B.clone().sub(A)),
    color,
    grain: 0,
    ...extra,
  });
}

// Cylinder between two points. open = no end caps.
function cylBetween(mesher, A, B, r0, r1, seg, color, open = false, uvTile = [0.3, 1]) {
  const L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, open);
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), quatYTo(B.clone().sub(A)), ONE);
  mesher.geo(g, m, color, [(TAU * Math.max(r0, r1)) / uvTile[0], L / uvTile[1]]);
  g.dispose();
}

// Swept tube with the rope texture: the texture runs U round the rope and V along it, with four
// twists per 0.8 m of rope (a plausible lay length for 36 mm manila).
function ropeTube(mesher, curve, radius, tubSeg, radSeg, color, closed = false) {
  const g = new THREE.TubeGeometry(curve, tubSeg, radius, radSeg, closed);
  const len = curve.getLength();
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), (uv.getX(k) * len) / 0.8);
  mesher.geo(g, new THREE.Matrix4(), color);
  g.dispose();
}

// Cable (thin dark tube) through a curve, uv unused.
function cableTube(mesher, curve, radius, tubSeg, color) {
  const g = new THREE.TubeGeometry(curve, tubSeg, radius, 3, false);
  mesher.geo(g, new THREE.Matrix4(), color);
  g.dispose();
}

// Catenary sag between A and B. drop(t) = sag * (cosh k - cosh(k (2t-1))) / (cosh k - 1) is zero at
// both ends and equals sag at the middle; k sets how pointed the hang is.
function catenaryPoint(A, B, sag, t, k = 1.7) {
  const p = new THREE.Vector3().lerpVectors(A, B, t);
  p.y -= (sag * (Math.cosh(k) - Math.cosh(k * (2 * t - 1)))) / (Math.cosh(k) - 1);
  return p;
}

// ------------------------------------------------------------------------------------------------
// Procedural helper textures that the toolkit does not provide: ashlar stone and a lit curtain.
// ------------------------------------------------------------------------------------------------
function hexRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Tileable dry-stone / ashlar: 5 rows of irregular blocks in soft stone with mortar, speckle and
// lichen blotches. The normal map comes from the painted luminance (Sobel).
function makeStoneTextures(seed = 21) {
  const S = 256;
  const rng = createRng(seed);
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  // mortar: charcoal lifted a little toward the stone
  ctx.fillStyle = `#${new THREE.Color(BRAND.charcoal).lerp(new THREE.Color(PALETTE.stone), 0.14).getHexString()}`;
  ctx.fillRect(0, 0, S, S);
  const base = hexRgb(PALETTE.stone);
  const rows = 5;
  const rowH = [];
  let tot = 0;
  for (let r = 0; r < rows; r++) {
    const h = 0.75 + rng() * 0.5;
    rowH.push(h);
    tot += h;
  }
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const h = (rowH[r] / tot) * S;
    const n = 3 + Math.floor(rng() * 2);
    const ws = [];
    let wt = 0;
    for (let k = 0; k < n; k++) {
      const w = 0.7 + rng() * 0.6;
      ws.push(w);
      wt += w;
    }
    let x = 0;
    for (let k = 0; k < n; k++) {
      const w = (ws[k] / wt) * S;
      const tone = 0.55 + 0.45 * rng();
      const warm = (rng() - 0.5) * 18;
      const col = [base[0] * tone + warm, base[1] * tone + warm * 0.4, base[2] * tone - warm * 0.5];
      const inset = 2.5 + rng() * 1.5;
      ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      ctx.beginPath();
      const rad = 3 + rng() * 4;
      ctx.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, rad);
      ctx.fill();
      // speckle and blotches inside the block
      for (let sp = 0; sp < 40; sp++) {
        const px = x + inset + rng() * (w - inset * 2);
        const py = y + inset + rng() * (h - inset * 2);
        const l = rng() < 0.5 ? 0 : 255;
        ctx.fillStyle = `rgba(${l},${l},${l},${0.05 + rng() * 0.1})`;
        ctx.fillRect(px, py, 1 + rng() * 2, 1 + rng() * 2);
      }
      if (rng() < 0.35) {
        ctx.fillStyle = "rgba(102,116,90,0.28)"; // lichen / moss stain in the brand moss tone
        ctx.beginPath();
        ctx.ellipse(x + w * rng(), y + h * rng(), w * 0.22, h * 0.2, rng() * 3, 0, TAU);
        ctx.fill();
      }
      x += w;
    }
    y += h;
  }
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const hgt = new Float32Array(S * S);
  for (let k = 0; k < S * S; k++) hgt[k] = (d[k * 4] * 0.3 + d[k * 4 + 1] * 0.5 + d[k * 4 + 2] * 0.2) / 255;
  const nrm = new Uint8Array(S * S * 4);
  const at = (x, yy) => hgt[((yy + S) % S) * S + ((x + S) % S)];
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      const dx = at(xx + 1, yy) - at(xx - 1, yy);
      const dy = at(xx, yy + 1) - at(xx, yy - 1);
      // canvas rows run top to bottom, so +Y in uv space is -dy
      const nx = -dx * 3.2;
      const ny = dy * 3.2;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yy * S + xx) * 4;
      nrm[o] = (nx * inv * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm[o + 2] = (inv * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normalMap = new THREE.DataTexture(nrm, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.anisotropy = 8;
  normalMap.needsUpdate = true;
  return { map, normalMap };
}

// A warm lit curtain seen from outside: vertical folds, brighter in the middle, falling off at the
// frame so the window reads as a lit interior and not a flat emissive card.
function makeCurtainTexture() {
  const W = 64;
  const H = 96;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);
  const warm = hexRgb(BRAND.warmLight);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const fold = 0.82 + 0.18 * Math.sin(u * TAU * 3.5 + Math.sin(v * 2.0) * 0.6);
      const falloff = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.08 + v * 0.84)), 0.6);
      const k = fold * falloff;
      const o = (y * W + x) * 4;
      img.data[o] = Math.min(255, warm[0] * 1.15 * k);
      img.data[o + 1] = Math.min(255, warm[1] * 1.1 * k);
      img.data[o + 2] = Math.min(255, warm[2] * 0.95 * k);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------------------------------------
// MODEL: pure geometry, no textures, so it can be counted and tested outside the browser.
// ------------------------------------------------------------------------------------------------
const MESH_KEYS = ["deck", "beam", "wall", "trim", "paint", "shingle", "rope", "metal", "copper", "stone", "glow", "glass", "curtain", "cloth", "moss"];

function bolt(ctx, p, axis, s = 1) {
  const a = axis.clone().normalize();
  const q = quatYTo(a).multiply(rotY(ctx.rng() * 3));
  ctx.inst.bolts.push({
    pos: p.clone().addScaledVector(a, 0.009 * s),
    quat: q,
    scale: V3(s, s, s),
    color: (() => {
      const t = 0.7 + ctx.rng() * 0.7; // instance colour multiplies the material colour: rust and oil variation
      return [t, t * 0.97, t * 0.92];
    })(),
  });
}

function addDeck(ctx) {
  const { M, rng } = ctx;
  const hole = axisAt(DECK_Y);
  const trunkR = trunkRadiusAt(DECK_Y);
  const cutR = trunkR + 0.09; // planks stop this far from the axis: a ragged gap the collar covers
  const holeHalf = 0.95; // trimmer joists stand at +/- this x (relative to the axis)

  // Joist positions along X: regular every ~0.45 except inside the trunk hole, plus two trimmers.
  const nJ = Math.round((DX1 - DX0 - 0.24) / 0.45);
  const step = (DX1 - DX0 - 0.24) / nJ;
  const joistX = [];
  for (let k = 0; k <= nJ; k++) {
    const x = DX0 + 0.12 + k * step;
    if (Math.abs(x - hole.x) >= holeHalf + 0.12) joistX.push(x);
  }
  joistX.push(hole.x - holeHalf, hole.x + holeHalf);
  joistX.sort((a, b) => a - b);

  // --- planks: rows along Z, each row several boards butted on joists with 8 mm gaps ---
  const rows = [];
  for (let z = DZ0; z < DZ1 - 0.05; ) {
    const w = 0.136 + rng() * 0.012;
    rows.push({ z0: z, w: Math.min(w, DZ1 - z) });
    z += w + 0.008;
  }
  let prevBoard = 0;
  const pushPlank = (xa, xb, row) => {
    const len = xb - xa;
    if (len < 0.2) return;
    const h = rng();
    let tone = 0.82 + 0.34 * rng();
    if (h < 0.1) tone *= 0.55; // dark stained board
    else if (h > 0.92) tone *= 1.22; // newer, paler replacement board
    const warm = (rng() - 0.5) * 0.16;
    const color = [C_DECK[0] * tone * (1 + warm), C_DECK[1] * tone, C_DECK[2] * tone * (1 - warm * 1.5)];
    // Pick one of the four boards painted in the texture so the grain differs from the neighbour.
    prevBoard = (prevBoard + 1 + Math.floor(rng() * 3)) % 4;
    const t = PLANK_T + (rng() - 0.5) * 0.004;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.003, (rng() - 0.5) * 0.0024, 0));
    M.deck.box({
      c: [(xa + xb) / 2, DECK_Y - t / 2 + (rng() - 0.5) * 0.003, row.z0 + row.w / 2],
      s: [len, t, row.w],
      q,
      color,
      grain: 0,
      tile: [0.64, 1.5], // a plank is 0.14 m = 0.22 of one texture repeat, so it stays inside one painted board
      off: [prevBoard * 0.25 + 0.125 + (rng() - 0.5) * 0.01, rng()],
    });
  };
  for (const row of rows) {
    const dz = row.z0 <= hole.z && row.z0 + row.w >= hole.z ? 0 : Math.min(Math.abs(row.z0 - hole.z), Math.abs(row.z0 + row.w - hole.z));
    const segs = [];
    const xs = DX0 + (rng() - 0.5) * 0.03;
    const xe = DX1 + (rng() - 0.5) * 0.03;
    if (dz < cutR) {
      const hc = Math.sqrt(cutR * cutR - dz * dz);
      segs.push([xs, hole.x - hc], [hole.x + hc, xe]);
    } else segs.push([xs, xe]);
    for (const [a, b] of segs) {
      // break long runs on a joist, keeping each board between 1.4 and 3.1 m
      let pos = a;
      for (;;) {
        if (b - pos <= 3.1) {
          pushPlank(pos, b, row);
          break;
        }
        const cands = joistX.filter((x) => x > pos + 1.4 && x < Math.min(pos + 3.1, b - 1.2));
        if (!cands.length) {
          pushPlank(pos, b, row);
          break;
        }
        const j = cands[Math.floor(rng() * cands.length)];
        pushPlank(pos, j - 0.004, row);
        pos = j + 0.004;
      }
    }
  }

  // --- joists (run along Z) ---
  const joistY = JOIST_TOP - JOIST_H / 2;
  const zc = (DZ0 + DZ1) / 2;
  const jlen = DZ1 - DZ0 - 0.1;
  for (const x of joistX) {
    const tone = 0.8 + rng() * 0.25;
    M.beam.box({ c: [x, joistY, zc], s: [0.05, JOIST_H, jlen], color: scaleC(C_BEAM, tone), grain: 2, tile: [0.2, 1.5], off: [rng(), rng()] });
  }
  // staggered solid blocking between joists stiffens the frame and reads well from below
  for (const [zb, jig] of [
    [1.72, 0.12],
    [-1.25, 0.1],
  ]) {
    for (let k = 0; k < joistX.length - 1; k++) {
      const xa = joistX[k] + 0.025;
      const xb = joistX[k + 1] - 0.025;
      if (xb - xa < 0.1) continue;
      if (xa < hole.x + holeHalf && xb > hole.x - holeHalf && Math.abs(zb - hole.z) < 1.1) continue; // trunk hole
      M.beam.box({ c: [(xa + xb) / 2, joistY, zb + (k % 2 ? jig : -jig)], s: [xb - xa, JOIST_H, 0.045], color: scaleC(C_BEAM, 0.75 + rng() * 0.2), grain: 0, tile: [0.2, 1.5], off: [rng(), rng()] });
    }
  }
  // header joists close the trunk hole front and back (they sit on the two trunk bearers)
  for (const zs of [-1, 1]) {
    M.beam.box({ c: [hole.x, joistY, hole.z + zs * 0.9], s: [holeHalf * 2 - 0.05, JOIST_H, 0.05], color: scaleC(C_BEAM, 0.85), grain: 0, tile: [0.2, 1.5], off: [rng(), rng()] });
  }

  // --- rim boards (fascia) around the deck edge: the face the camera sees from below ---
  const rimY = JOIST_TOP - RIM_H / 2 + 0.0;
  const rimTone = [0.8, 0.88, 0.76, 0.84];
  M.beam.box({ c: [DCX, rimY, DZ1 - 0.03], s: [DX1 - DX0, RIM_H, 0.04], color: scaleC(C_BEAM, rimTone[0]), grain: 0, tile: [0.22, 1.6], off: [0.1, 0.3] });
  M.beam.box({ c: [DCX, rimY, DZ0 + 0.03], s: [DX1 - DX0, RIM_H, 0.04], color: scaleC(C_BEAM, rimTone[1]), grain: 0, tile: [0.22, 1.6], off: [0.4, 0.5] });
  M.beam.box({ c: [DX0 + 0.03, rimY, DCZ], s: [0.04, RIM_H, DZ1 - DZ0 - 0.08], color: scaleC(C_BEAM, rimTone[2]), grain: 2, tile: [0.22, 1.6], off: [0.2, 0.7] });
  M.beam.box({ c: [DX1 - 0.03, rimY, DCZ], s: [0.04, RIM_H, DZ1 - DZ0 - 0.08], color: scaleC(C_BEAM, rimTone[3]), grain: 2, tile: [0.22, 1.6], off: [0.6, 0.1] });

  // --- bearers: three beams along X, tails projecting 0.12 m past the rim ---
  const bearY = BEAR_TOP - BEAR_H / 2;
  BEAR_Z.forEach((z, i) => {
    M.beam.box({
      c: [DCX, bearY, z],
      s: [DX1 - DX0 + 0.24, BEAR_H, i === 2 ? 0.13 : 0.11],
      color: scaleC(C_BEAM, 0.78 + 0.1 * i),
      grain: 0,
      tile: [0.22, 1.5],
      off: [0.15 * i, 0.3 + 0.2 * i],
    });
  });

  // --- tree attachment: a through rod passes the trunk between the two inner bearers ---
  const rodY = bearY;
  const rodA = V3(hole.x, rodY, hole.z - 1.04);
  const rodB = V3(hole.x, rodY, hole.z + 1.04);
  cylBetween(M.metal, rodA, rodB, 0.016, 0.016, 6, scaleC(C_IRON, 1.1), false);
  for (const zs of [-1, 1]) {
    // spacer block bearing on the bark, washer plate and nut on the outer face of each bearer
    M.beam.box({ c: [hole.x, rodY, hole.z + zs * 0.79], s: [0.14, 0.2, 0.09], color: scaleC(C_BEAM, 0.7), grain: 1, tile: [0.2, 1.4], off: [rng(), rng()] });
    M.metal.box({ c: [hole.x, rodY, hole.z + zs * 0.966], s: [0.13, 0.17, 0.012], color: scaleC(C_IRON, 1.3) });
    bolt(ctx, V3(hole.x, rodY, hole.z + zs * 0.972), V3(0, 0, zs), 1.4);
  }
  // Steel band around the trunk above the lashing, and a rope lashing below it
  const bandY = 8.35;
  const ax = axisAt(bandY);
  const band = new THREE.CylinderGeometry(trunkRadiusAt(bandY) + 0.03, trunkRadiusAt(bandY) + 0.03, 0.1, 24, 1, true);
  M.metal.geo(band, new THREE.Matrix4().makeTranslation(ax.x, bandY, ax.z), scaleC(C_IRON, 1.2));
  band.dispose();
  const lashPts = [];
  const turns = 2;
  const lashSeg = 36;
  for (let k = 0; k <= lashSeg; k++) {
    const t = k / lashSeg;
    const y = 8.12 + t * 0.17;
    const a = t * turns * TAU;
    const r = trunkRadiusAt(y) + 0.04;
    const c = axisAt(y);
    lashPts.push(V3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r));
  }
  ropeTube(M.rope, new THREE.CatmullRomCurve3(lashPts), 0.021, lashSeg, 4, [0.85, 0.8, 0.72]);

  // --- flashing collar on the deck top (hides the ragged plank ends) ---
  const prof = [
    new THREE.Vector2(trunkR + 0.02, 0.07),
    new THREE.Vector2(trunkR + 0.045, 0.078),
    new THREE.Vector2(trunkR + 0.26, 0.012),
    new THREE.Vector2(trunkR + 0.28, 0.0),
  ];
  const ring = new THREE.LatheGeometry(prof, 28);
  M.copper.geo(ring, new THREE.Matrix4().makeTranslation(hole.x, DECK_Y, hole.z), C_LEAD);
  ring.dispose();
}

// Struts and brackets under the deck. Each strut starts on a steel shoe against the trunk and
// ends under a bearer; the fork branches and lower limbs from Tree.jsx stay clear of them.
function addUnderStructure(ctx) {
  const { M, rng } = ctx;
  const camDir = V3(-0.3, -0.2, 0.9);
  const struts = [
    { az: 48, y0: 6.9, tx: 1.4, tz: BEAR_Z[2] },
    { az: 120, y0: 6.9, tx: -0.8, tz: BEAR_Z[2] },
    { az: 22, y0: 7.3, tx: 2.2, tz: BEAR_Z[1] },
    { az: 235, y0: 7.35, tx: -0.7, tz: BEAR_Z[0] },
  ];
  for (const st of struts) {
    const a = st.az * DEG;
    const rad = V3(Math.cos(a), 0, Math.sin(a));
    const c0 = axisAt(st.y0);
    const A = V3(c0.x, st.y0, c0.z).addScaledVector(rad, trunkRadiusAt(st.y0) + 0.045);
    const B = V3(st.tx, BEAR_BOT + 0.05, st.tz);
    const dir = B.clone().sub(A);
    const L = dir.length();
    timber(M.beam, A, B, 0.13, 0.1, scaleC(C_BEAM, 0.8 + rng() * 0.2), { tile: [0.22, 1.5], off: [rng(), rng()] });
    // steel shoe flat against the bark
    M.metal.box({ c: A.clone().addScaledVector(rad, -0.015).toArray(), s: [0.02, 0.3, 0.2], q: quatAlong(rad), color: scaleC(C_IRON, 1.2) });
    // plate under the bearer
    M.metal.box({ c: [B.x, BEAR_BOT - 0.006, B.z], s: [0.2, 0.012, 0.2], color: scaleC(C_IRON, 1.1) });
    // through bolts on the face that looks toward the camera
    const x = dir.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, Y_UP).normalize();
    if (z.dot(camDir) < 0) z.negate();
    for (const t of [0.07, 0.93]) {
      for (const oy of [-0.035, 0.035]) {
        const p = A.clone().addScaledVector(x, L * t).addScaledVector(z, 0.05).add(V3(0, oy, 0));
        bolt(ctx, p, z, 0.8);
      }
    }
    bolt(ctx, V3(B.x, BEAR_BOT - 0.012, B.z).add(V3(0.06, 0, 0)), V3(0, -1, 0), 0.9);
    bolt(ctx, V3(B.x, BEAR_BOT - 0.012, B.z).add(V3(-0.06, 0, 0)), V3(0, -1, 0), 0.9);
  }
  // Collars where the struts bear on the trunk
  for (const y of [6.9, 7.3]) {
    const c = axisAt(y);
    const r = trunkRadiusAt(y) + 0.03;
    const g = new THREE.CylinderGeometry(r, r, 0.17, 24, 1, true);
    M.metal.geo(g, new THREE.Matrix4().makeTranslation(c.x, y, c.z), scaleC(C_IRON, 1.15));
    g.dispose();
  }
  // Strap plates where bearers cross the fork branches (branch 1 x mid bearer, branch 3 x front)
  const straps = [
    [3.35, BEAR_Z[1]],
    [-0.45, BEAR_Z[2]],
  ];
  for (const [sx, sz] of straps) {
    for (const zs of [-1, 1]) {
      M.metal.box({ c: [sx, BEAR_BOT + 0.05, sz + zs * 0.0675], s: [0.06, 0.3, 0.012], color: scaleC(C_IRON, 1.2) });
    }
    bolt(ctx, V3(sx, BEAR_BOT + 0.05, sz + 0.0735), V3(0, 0, 1), 0.9);
  }
}

// Railings: posts bolted outside the rim, top rail, bottom rail, turned balusters (instanced).
function addRailings(ctx) {
  const { M, rng } = ctx;
  const postTop = 9.74;
  const postBot = JOIST_TOP - RIM_H;
  const fz = DZ1 - 0.04;
  const bz = DZ0 + 0.045;
  const lx = DX0 + 0.045;
  const rx = DX1 - 0.045;
  const posts = new Map();
  const addPost = (x, z, top = postTop) => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (!posts.has(key)) posts.set(key, { x, z, top });
    else posts.get(key).top = Math.max(posts.get(key).top, top);
  };
  // bays: [x0,z0,x1,z1, balusters?]
  const bays = [];
  const line = (x0, z0, x1, z1, n, bal) => {
    for (let k = 0; k < n; k++) {
      const a = [lerp(x0, x1, k / n), lerp(z0, z1, k / n)];
      const b = [lerp(x0, x1, (k + 1) / n), lerp(z0, z1, (k + 1) / n)];
      bays.push([a[0], a[1], b[0], b[1], bal]);
    }
  };
  const gap0 = -1.25;
  const gap1 = -0.65; // the rope ladder hangs through this opening in the front rail
  line(DX0 + 0.045, fz, gap0, fz, 1, true);
  line(gap1, fz, rx, fz, 5, true);
  line(lx, fz, lx, bz, 5, true);
  line(rx, fz, rx, bz, 5, true);
  line(lx, bz, rx, bz, 6, false);
  for (const [x0, z0, x1, z1] of bays) {
    addPost(x0, z0);
    addPost(x1, z1);
  }
  // front-left corner post becomes the lantern and string-light pole, front-right carries a lantern
  addPost(lx, fz, 10.66);
  const poleTop = V3(lx, 10.66, fz);

  for (const p of posts.values()) {
    const h = p.top - postBot;
    M.beam.box({
      c: [p.x, postBot + h / 2, p.z],
      s: [0.075, h, 0.075],
      color: scaleC(C_BEAM, 0.85 + rng() * 0.2),
      grain: 1,
      tile: [0.22, 1.4],
      off: [rng(), rng()],
    });
    if (p.top > 10) {
      // cap and finial on the pole
      M.beam.box({ c: [p.x, p.top + 0.02, p.z], s: [0.1, 0.04, 0.1], color: scaleC(C_BEAM, 0.9) });
      M.copper.box({ c: [p.x, p.top + 0.075, p.z], s: [0.04, 0.07, 0.04], color: C_COPPER });
    }
    // carriage bolt on the outer face of front posts
    if (Math.abs(p.z - fz) < 0.01) bolt(ctx, V3(p.x, postBot + 0.2, p.z + 0.0375), V3(0, 0, 1), 0.85);
  }

  for (const [x0, z0, x1, z1, bal] of bays) {
    const d = V3(x1 - x0, 0, z1 - z0);
    const L = d.length();
    const q = rotY(Math.atan2(-d.z, d.x));
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    M.trim.box({ c: [mx, 9.7625, mz], s: [L - 0.06, 0.045, 0.1], q, color: scaleC(C_TRIM, 0.95 + rng() * 0.1), grain: 0, tile: [0.12, 0.9], off: [rng(), rng()] });
    if (bal) {
      M.trim.box({ c: [mx, DECK_Y + 0.105, mz], s: [L - 0.06, 0.05, 0.07], q, color: scaleC(C_TRIM, 0.85), grain: 0, tile: [0.12, 0.9], off: [rng(), rng()] });
      const n = Math.max(2, Math.round((L - 0.075) / 0.15));
      const dn = d.clone().normalize();
      for (let k = 0; k < n; k++) {
        const t = 0.0375 + ((k + 0.5) * (L - 0.075)) / n;
        const pos = V3(x0, DECK_Y + 0.13, z0).addScaledVector(dn, t).add(V3((rng() - 0.5) * 0.004, 0, (rng() - 0.5) * 0.004));
        ctx.inst.balusters.push({
          pos,
          quat: new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.02, rng() * TAU, (rng() - 0.5) * 0.02)),
          scale: V3(1, 1, 1),
          color: [0.8 + rng() * 0.5, 0.78 + rng() * 0.4, 0.8 + rng() * 0.35],
        });
      }
    } else {
      // plain horizontal mid rail where nobody looks
      M.trim.box({ c: [mx, 9.25, mz], s: [L - 0.06, 0.05, 0.06], q, color: scaleC(C_TRIM, 0.85), grain: 0, tile: [0.12, 0.9] });
    }
  }
  return { poleTop };
}

// Wall piece helper: cladding in world-aligned uvs so battens run continuously past openings.
function addCabin(ctx) {
  const { M, rng } = ctx;
  const T = CAB.t;
  const y0 = DECK_Y;
  const top = CAB.top;
  // splash zone darkening: boards are darker near the deck and bleached higher up
  const wallShade = (P) => 0.72 + 0.28 * smooth(DECK_Y, DECK_Y + 1.5, P.y);
  const wall = (x0, x1, ya, yb, z0, z1, off, tone = 1) => {
    M.wall.box({
      c: [(x0 + x1) / 2, (ya + yb) / 2, (z0 + z1) / 2],
      s: [x1 - x0, yb - ya, z1 - z0],
      color: scaleC(C_WALL, tone),
      grain: 1,
      tile: [0.6, 1.2],
      world: true,
      off,
      shade: wallShade,
    });
  };

  // Left wall (x = CAB.x0, faces the camera at a grazing angle) with a window opening
  const wz0 = WIN_LEFT.z - WIN_LEFT.w / 2;
  const wz1 = WIN_LEFT.z + WIN_LEFT.w / 2;
  const offL = [0.13, 0.0];
  wall(CAB.x0, CAB.x0 + T, y0, WIN_LEFT.sill, CAB.z0, CAB.z1, offL, 0.97);
  wall(CAB.x0, CAB.x0 + T, WIN_LEFT.sill + WIN_LEFT.h, top, CAB.z0, CAB.z1, offL, 0.97);
  wall(CAB.x0, CAB.x0 + T, WIN_LEFT.sill, WIN_LEFT.sill + WIN_LEFT.h, CAB.z0, wz0, offL, 0.97);
  wall(CAB.x0, CAB.x0 + T, WIN_LEFT.sill, WIN_LEFT.sill + WIN_LEFT.h, wz1, CAB.z1, offL, 0.97);
  // Right wall and back wall (plain)
  wall(CAB.x1 - T, CAB.x1, y0, top, CAB.z0, CAB.z1, [0.47, 0.2], 1.04);
  wall(CAB.x0 + T, CAB.x1 - T, y0, top, CAB.z0, CAB.z0 + T, [0.71, 0.4], 0.92);
  // Front wall: left piece with a window, then the wide open doorway under a header
  const fz0 = CAB.z1 - T;
  const offF = [0.31, 0.1];
  const wx0 = WIN_FRONT.x - WIN_FRONT.w / 2;
  const wx1 = WIN_FRONT.x + WIN_FRONT.w / 2;
  wall(CAB.x0 + T, DOOR.x0, y0, WIN_FRONT.sill, fz0, CAB.z1, offF);
  wall(CAB.x0 + T, DOOR.x0, WIN_FRONT.sill + WIN_FRONT.h, top, fz0, CAB.z1, offF);
  wall(CAB.x0 + T, wx0, WIN_FRONT.sill, WIN_FRONT.sill + WIN_FRONT.h, fz0, CAB.z1, offF);
  wall(wx1, DOOR.x0, WIN_FRONT.sill, WIN_FRONT.sill + WIN_FRONT.h, fz0, CAB.z1, offF);
  wall(DOOR.x0, CAB.x1 - T, y0 + DOOR.h, top, fz0, CAB.z1, offF, 0.95);

  // Gable infill above the wall plate, front and back, as flat triangles in world-aligned uvs
  const gable = (z, nz, tone) => {
    const col = scaleC(C_WALL, tone);
    const n = V3(0, 0, nz);
    const A = V3(CAB.x0, top, z);
    const B = V3(CAB.x1, top, z);
    const Cp = V3(CAB.cx, top + ROOF.rise, z);
    const uv = (p) => [(p.x + 0.3) / 0.6, p.y / 1.2];
    if (nz > 0) M.wall.tri(A, B, Cp, n, [uv(A), uv(B), uv(Cp)], col);
    else M.wall.tri(B, A, Cp, n, [uv(B), uv(A), uv(Cp)], col);
  };
  gable(CAB.z1, 1, 0.95); // outer faces flush with the wall faces
  gable(CAB.z0, -1, 0.85);
  gable(CAB.z1 - T, -1, 0.7); // inner faces, seen from inside through the doorway
  gable(CAB.z0 + T, 1, 0.7);

  // Corner posts (proud of the walls by 0.04) and wall plates
  for (const sx of [0, 1]) {
    for (const sz of [0, 1]) {
      const cx = sx ? CAB.x1 - 0.03 : CAB.x0 + 0.03;
      const cz = sz ? CAB.z1 - 0.03 : CAB.z0 + 0.03;
      M.beam.box({ c: [cx + (sx ? 0.0 : 0.0) + 0.0, DECK_Y + CAB.h / 2, cz], s: [0.14, CAB.h, 0.14], color: scaleC(C_BEAM, 0.85 + rng() * 0.15), grain: 1, tile: [0.22, 1.4], off: [rng(), rng()] });
    }
  }
  M.beam.box({ c: [CAB.x0 + 0.06, top - 0.045, (CAB.z0 + CAB.z1) / 2], s: [0.12, 0.09, CAB.z1 - CAB.z0 + 0.1], color: scaleC(C_BEAM, 0.8), grain: 2, tile: [0.22, 1.4], off: [0.3, 0.2] });
  M.beam.box({ c: [CAB.x1 - 0.06, top - 0.045, (CAB.z0 + CAB.z1) / 2], s: [0.12, 0.09, CAB.z1 - CAB.z0 + 0.1], color: scaleC(C_BEAM, 0.8), grain: 2, tile: [0.22, 1.4], off: [0.6, 0.2] });
  // Tie beams across the cabin (the ceiling band the camera sees through the doorway)
  for (const z of [0.42, -0.72]) {
    M.beam.box({ c: [CAB.cx, top - 0.09, z], s: [CAB.x1 - CAB.x0 + 0.1, 0.16, 0.1], color: scaleC(C_BEAM, 0.95), grain: 0, tile: [0.22, 1.5], off: [rng(), rng()] });
  }
  // Skirting boards (moss-green paint) round the base of the walls
  const skirt = (x0, x1, z0, z1) =>
    M.paint.box({ c: [(x0 + x1) / 2, DECK_Y + 0.07, (z0 + z1) / 2], s: [x1 - x0, 0.14, z1 - z0], color: scaleC(C_MOSSPAINT, 0.9), grain: longestAxis([x1 - x0, 0.14, z1 - z0]), tile: [0.12, 0.8] });
  skirt(CAB.x0 - 0.02, CAB.x0 + 0.02 + T, CAB.z0 - 0.02, CAB.z1 + 0.02);
  skirt(CAB.x1 - T - 0.02, CAB.x1 + 0.02, CAB.z0 - 0.02, CAB.z1 + 0.02);
  skirt(CAB.x0 + T, DOOR.x0, CAB.z1 - T, CAB.z1 + 0.02);

  // Door frame in cream paint, threshold board and the open door leaf
  const paintBox = (c, s, q, col) =>
    M.paint.box({ c, s, q, color: col, grain: longestAxis(s), tile: [0.12, 0.8], off: [rng(), rng()] });
  paintBox([DOOR.x0 - 0.04, DECK_Y + DOOR.h / 2, CAB.z1 + 0.01], [0.09, DOOR.h, 0.13], null, scaleC(C_CREAM, 0.95));
  paintBox([(DOOR.x0 + CAB.x1 - T) / 2, DECK_Y + DOOR.h + 0.03, CAB.z1 + 0.01], [CAB.x1 - T - DOOR.x0 + 0.1, 0.07, 0.13], null, scaleC(C_CREAM, 0.9));
  M.trim.box({ c: [(DOOR.x0 + CAB.x1 - T) / 2, DECK_Y + 0.02, CAB.z1 + 0.05], s: [CAB.x1 - T - DOOR.x0, 0.04, 0.32], color: scaleC(C_TRIM, 0.8), grain: 0, tile: [0.12, 0.9] });

  // The door stands open at 110 degrees, hinged on the right post, so the camera sees its
  // outer face (planks with ledges, braces and iron strap hinges).
  const hinge = V3(CAB.x1 - T - 0.02, 0, CAB.z1 + 0.07);
  const phi = 110 * DEG;
  const dirD = V3(-Math.cos(phi), 0, Math.sin(phi)); // along the door width, hinge to free edge
  const qd = rotY(Math.PI + phi); // local x -> dirD, local z -> toward the camera side
  const dW = 0.85;
  const dH = DOOR.h - 0.05;
  const dc = hinge.clone().addScaledVector(dirD, dW / 2);
  const dPos = (lx, ly, lz) => V3(lx, ly, lz).applyQuaternion(qd).add(V3(dc.x, DECK_Y + 0.04, dc.z));
  M.wall.box({ c: dPos(0, dH / 2, 0).toArray(), s: [dW, dH, 0.045], q: qd, color: scaleC(C_DOOR, 1.0), grain: 1, tile: [0.6, 1.2], off: [0.2, 0.4] });
  for (const ly of [0.3, dH * 0.52, dH - 0.28]) {
    M.trim.box({ c: dPos(0, ly, 0.0425).toArray(), s: [dW - 0.06, 0.11, 0.025], q: qd, color: scaleC(C_DOOR, 0.78).map((v, i) => v * [1.4, 1.1, 1][i]), grain: 0, tile: [0.12, 0.9], off: [rng(), rng()] });
  }
  // diagonal brace
  const braceA = dPos(-dW / 2 + 0.08, 0.35, 0.052);
  const braceB = dPos(dW / 2 - 0.08, dH - 0.35, 0.052);
  timber(M.trim, braceA, braceB, 0.1, 0.022, scaleC(C_DOOR, 0.75).map((v, i) => v * [1.4, 1.1, 1][i]), { tile: [0.12, 0.9] });
  // iron strap hinges and latch
  for (const ly of [0.42, dH - 0.4]) {
    M.metal.box({ c: dPos(-dW / 2 + 0.33, ly, 0.0575).toArray(), s: [0.66, 0.05, 0.012], q: qd, color: scaleC(C_IRON, 1.1) });
    M.metal.box({ c: dPos(-dW / 2 + 0.03, ly, 0.0575).toArray(), s: [0.06, 0.09, 0.016], q: qd, color: scaleC(C_IRON, 1.3) });
    bolt(ctx, dPos(-dW / 2 + 0.55, ly, 0.0635), new THREE.Vector3(0, 0, 1).applyQuaternion(qd), 0.55);
  }
  M.metal.box({ c: dPos(dW / 2 - 0.1, dH * 0.5, 0.062).toArray(), s: [0.18, 0.035, 0.014], q: qd, color: scaleC(C_IRON, 1.2) });
  M.metal.box({ c: dPos(dW / 2 - 0.1, dH * 0.5, 0.07).toArray(), s: [0.025, 0.12, 0.02], q: qd, color: scaleC(C_IRON, 1.2) });

  // Gable brackets: diagonal corbels under the front overhang, bolted to the wall and the purlins
  for (const bx of [CAB.x0 + 0.1, CAB.x1 - 0.1]) {
    const A = V3(bx, top - 0.62, CAB.z1 + 0.04);
    const B = V3(bx, top - 0.03, ROOF.z1 - 0.1);
    timber(M.beam, A, B, 0.08, 0.07, scaleC(C_BEAM, 0.9), { tile: [0.22, 1.5], off: [rng(), rng()] });
    bolt(ctx, V3(bx, top - 0.5, CAB.z1 + 0.05).add(V3(0.04, 0, 0)), V3(1, 0, 0), 0.7);
    bolt(ctx, V3(bx, top - 0.1, ROOF.z1 - 0.12).add(V3(0.04, 0, 0)), V3(1, 0, 0), 0.7);
  }

  // Windows
  addWindow(ctx, { O: V3(WIN_FRONT.x, WIN_FRONT.sill + WIN_FRONT.h / 2, CAB.z1), q: ID_Q.clone(), w: WIN_FRONT.w, h: WIN_FRONT.h, shutters: true });
  addWindow(ctx, { O: V3(CAB.x0, WIN_LEFT.sill + WIN_LEFT.h / 2, WIN_LEFT.z), q: rotY(-Math.PI / 2), w: WIN_LEFT.w, h: WIN_LEFT.h, shutters: false });

  // Round attic window in the front gable: ring, cross and a glowing disc
  const rwY = top + 0.58;
  const ringG = new THREE.RingGeometry(0.2, 0.27, 20);
  M.paint.geo(ringG, new THREE.Matrix4().makeTranslation(CAB.cx, rwY, CAB.z1 + 0.012), scaleC(C_CREAM, 0.9));
  ringG.dispose();
  const discG = new THREE.CircleGeometry(0.2, 20);
  M.curtain.geo(discG, new THREE.Matrix4().makeTranslation(CAB.cx, rwY, CAB.z1 + 0.004), WHITE, [1, 1]);
  discG.dispose();
  M.paint.box({ c: [CAB.cx, rwY, CAB.z1 + 0.016], s: [0.4, 0.022, 0.016], color: scaleC(C_CREAM, 0.9), grain: 0, tile: [0.1, 0.8] });
  M.paint.box({ c: [CAB.cx, rwY, CAB.z1 + 0.016], s: [0.022, 0.4, 0.016], color: scaleC(C_CREAM, 0.9), grain: 1, tile: [0.1, 0.8] });
  ctx.halos.window.push(V3(CAB.cx, rwY, CAB.z1 + 0.15));
  ctx.halos.window.push(V3(WIN_FRONT.x, WIN_FRONT.sill + WIN_FRONT.h / 2, CAB.z1 + 0.15));
  ctx.halos.window.push(V3(CAB.x0 - 0.15, WIN_LEFT.sill + WIN_LEFT.h / 2, WIN_LEFT.z));
}

// Framed window with mullions, sill, glass pane and a lit curtain behind. O is the centre of the
// opening on the outer wall face, q turns local +Z (outward) to the wall normal.
function addWindow(ctx, { O, q, w, h, shutters }) {
  const { M, rng } = ctx;
  const place = (lx, ly, lz) => V3(lx, ly, lz).applyQuaternion(q).add(O);
  const paintBox = (lx, ly, lz, sx, sy, sz, col) =>
    M.paint.box({ c: place(lx, ly, lz).toArray(), s: [sx, sy, sz], q, color: col, grain: longestAxis([sx, sy, sz]), tile: [0.12, 0.8], off: [rng(), rng()] });
  const cream = scaleC(C_CREAM, 0.85 + rng() * 0.1);
  for (const sx of [-1, 1]) paintBox(sx * (w / 2 + 0.03), 0, 0.02, 0.06, h + 0.12, 0.13, cream);
  paintBox(0, h / 2 + 0.03, 0.02, w + 0.12, 0.06, 0.13, cream);
  paintBox(0, -h / 2 - 0.02, 0.07, w + 0.2, 0.045, 0.2, scaleC(C_CREAM, 0.8));
  paintBox(0, 0, 0.0, 0.035, h, 0.06, cream);
  paintBox(0, 0, 0.0, w, 0.03, 0.06, cream);
  const plane = new THREE.PlaneGeometry(w, h);
  M.glass.geo(plane, new THREE.Matrix4().compose(place(0, 0, -0.02), q, ONE), WHITE);
  M.curtain.geo(plane, new THREE.Matrix4().compose(place(0, 0, -0.075), q, ONE), WHITE);
  plane.dispose();
  if (shutters) {
    const green = scaleC(C_MOSSPAINT, 1.0 + rng() * 0.3);
    for (const sx of [-1, 1]) {
      const cx = sx * (w / 2 + 0.06 + 0.1);
      paintBox(cx, 0, 0.012, 0.2, h + 0.1, 0.03, green);
      paintBox(cx, 0.28, 0.034, 0.2, 0.05, 0.02, scaleC(green, 0.85));
      paintBox(cx, -0.28, 0.034, 0.2, 0.05, 0.02, scaleC(green, 0.85));
    }
  }
}

// Slope frame for one side of the gable. side -1 = left (x decreasing), +1 = right.
// Layers are boxes rotated about Z so local X runs along the slope, local Y along the normal.
function slopeFrame(side) {
  const E = V3(CAB.cx + side * (CAB.half + ROOF.over), CAB.top - ROOF.over * ROOF.tan, 0); // underside at the eave tip
  const d = V3(-side * ROOF.cos, ROOF.sin, 0); // up the slope
  const n = V3(side * ROOF.sin, ROOF.cos, 0); // outward normal
  return { side, E, d, n, q: rotZ(side < 0 ? ROOF.alpha : -ROOF.alpha) };
}
// Point on the slope: s metres up from the eave, o metres out along the normal.
const slopePoint = (f, s, o, z = 0) => f.E.clone().addScaledVector(f.d, s).addScaledVector(f.n, o).add(V3(0, 0, z));

function addRoof(ctx) {
  const { M, rng } = ctx;
  const T = CAB.t;
  const ext = 0.14; // slabs run past the ridge so the two slopes overlap under the cap
  for (const side of [-1, 1]) {
    const f = slopeFrame(side);
    const len = ROOF.len + ext;
    // sheathing boards (plank texture, visible from below as the soffit and ceiling)
    const sheathUv = (loc, face) => {
      const sUp = len / 2 + (side < 0 ? loc[0] : -loc[0]);
      const z = loc[2] + ROOF.zc;
      return face.n === 1 ? [z / 0.6 + 0.2, sUp / 1.2] : [loc[face.a] / 0.6, loc[face.b] / 1.2];
    };
    M.wall.box({
      c: slopePoint(f, len / 2, SHEATH_O, ROOF.zc).toArray(),
      s: [len, SHEATH_T, ROOF.depth],
      q: f.q,
      color: scaleC(C_WALL, side < 0 ? 0.9 : 0.95),
      uvFn: sheathUv,
    });
    // shingles: courses run along Z, butts point down the slope, one texture tile per metre
    const shingleUv = (loc, face) => {
      const sUp = len / 2 + (side < 0 ? loc[0] : -loc[0]);
      const z = loc[2] + ROOF.zc;
      return face.n === 1 ? [z + 0.37 * (side + 1), sUp] : [loc[face.a], loc[face.b]];
    };
    M.shingle.box({
      c: slopePoint(f, len / 2, SHINGLE_O, ROOF.zc).toArray(),
      s: [len, SHINGLE_T, ROOF.depth],
      q: f.q,
      color: side < 0 ? [0.95, 0.9, 0.9] : [1.12, 1.0, 0.95],
      uvFn: shingleUv,
    });
    // rafters, exposed under the sheathing and projecting to the eave
    const nRaf = 9;
    for (let k = 0; k < nRaf; k++) {
      const z = ROOF.z0 + 0.1 + (k * (ROOF.depth - 0.2)) / (nRaf - 1);
      M.beam.box({
        c: slopePoint(f, ROOF.len / 2, 0.06, z).toArray(),
        s: [ROOF.len, 0.12, 0.055],
        q: f.q,
        color: scaleC(C_BEAM, 0.85 + rng() * 0.2),
        grain: 0,
        tile: [0.22, 1.5],
        off: [rng(), rng()],
      });
    }
    // two purlins under the rafters; their ends project from the gable overhang
    for (const s of [0.95, 1.85]) {
      M.beam.box({ c: slopePoint(f, s, -0.05, ROOF.zc).toArray(), s: [0.08, 0.1, ROOF.depth - 0.02], q: f.q, color: scaleC(C_BEAM, 0.9), grain: 2, tile: [0.22, 1.5], off: [rng(), rng()] });
    }
    // fascia across the rafter ends (moss-green paint) and a copper drip edge on the shingle butts
    M.paint.box({ c: slopePoint(f, -0.0125, 0.0925, ROOF.zc).toArray(), s: [0.025, 0.215, ROOF.depth + 0.07], q: f.q, color: scaleC(C_MOSSPAINT, 1.1 + 0.2 * rng()), grain: 2, tile: [0.12, 0.8], off: [rng(), rng()] });
    M.copper.box({ c: slopePoint(f, 0.03, SHINGLE_TOP + 0.003, ROOF.zc).toArray(), s: [0.1, 0.006, ROOF.depth + 0.05], q: f.q, color: scaleC(C_COPPER, 0.9) });
    // barge boards on the gable edges
    for (const z of [ROOF.z1 + 0.015, ROOF.z0 - 0.015]) {
      M.paint.box({ c: slopePoint(f, len / 2, 0.09, z).toArray(), s: [len, 0.25, 0.03], q: f.q, color: scaleC(C_MOSSPAINT, 1.0 + 0.2 * rng()), grain: 0, tile: [0.12, 0.8], off: [rng(), rng()] });
    }
  }
  // ridge beam (exposed inside and projecting past both gables) and shingle ridge cap
  M.beam.box({ c: [CAB.cx, ROOF.ridgeY - 0.08, ROOF.zc], s: [0.1, 0.16, ROOF.depth + 0.04], color: scaleC(C_BEAM, 0.95), grain: 2, tile: [0.22, 1.5], off: [0.3, 0.6] });
  for (const side of [-1, 1]) {
    const f = slopeFrame(side);
    const A = V3(CAB.cx, ROOF.apexY, 0);
    const c = A.clone().addScaledVector(f.d, -0.17).addScaledVector(f.n, 0.015).add(V3(0, 0, ROOF.zc));
    M.trim.box({ c: c.toArray(), s: [0.36, 0.03, ROOF.depth + 0.04], q: f.q, color: scaleC(C_TRIM, 0.85), grain: 2, tile: [0.12, 0.9], off: [side * 0.3, 0.2] });
  }

  // Moss on the roof, thickest on the left (shaded) slope and along the eave and ridge
  const mossG = new THREE.SphereGeometry(1, 7, 4);
  const mossAt = (side, sUp, z, sx, sz) => {
    const f = slopeFrame(side);
    const p = slopePoint(f, sUp, SHINGLE_TOP + 0.004, z);
    const m = new THREE.Matrix4().compose(p, f.q.clone().multiply(rotY(rng() * TAU)), V3(sx, 0.03 + rng() * 0.02, sz));
    M.moss.geo(mossG, m, scaleC(WHITE, 0.8 + 0.3 * rng()), [1.2, 1.2]);
  };
  const mossSpots = [
    [-1, 0.35, -1.2, 0.34, 0.2],
    [-1, 0.5, 0.1, 0.28, 0.16],
    [-1, 0.28, 1.1, 0.3, 0.2],
    [-1, 1.2, -0.5, 0.22, 0.28],
    [-1, 2.2, 0.75, 0.2, 0.3],
    [-1, 1.7, -1.5, 0.3, 0.18],
    [-1, 0.9, 1.35, 0.17, 0.12],
    [1, 0.3, -0.9, 0.2, 0.16],
    [1, 2.3, 0.6, 0.18, 0.25],
    [1, 1.1, 1.3, 0.14, 0.1],
  ];
  for (const sp of mossSpots) mossAt(...sp);
  mossG.dispose();

  // Stone chimney through the right slope near the rear, with lead flashing and clay pots
  // The stack stands in the back right corner as a masonry column from the floor, so the part the
  // camera sees through the doorway reads as a real chimney breast and not a hanging block.
  const chx = CAB.x1 - T - 0.275;
  const chz = CAB.z0 + T + 0.275;
  const chBase = DECK_Y + 0.01;
  const chTop = ROOF.ridgeY + 0.6;
  M.stone.box({ c: [chx, (chBase + chTop) / 2, chz], s: [0.55, chTop - chBase, 0.55], color: WHITE, world: true, tile: [0.8, 0.8], grain: null });
  M.stone.box({ c: [chx, chTop - 0.05, chz], s: [0.64, 0.1, 0.64], color: scaleC(WHITE, 0.85), world: true, tile: [0.8, 0.8] });
  M.stone.box({ c: [chx, chTop + 0.05, chz], s: [0.72, 0.075, 0.72], color: scaleC(WHITE, 0.95), world: true, tile: [0.8, 0.8], off: [0.3, 0.5] });
  for (const dx of [-0.13, 0.13]) {
    const pot = new THREE.CylinderGeometry(0.085, 0.1, 0.32, 8, 1, true);
    M.stone.geo(pot, new THREE.Matrix4().makeTranslation(chx + dx, chTop + 0.24, chz + (dx > 0 ? 0.04 : -0.04)), C_CLAY, [1, 1]);
    pot.dispose();
    const potTop = new THREE.CircleGeometry(0.07, 8);
    M.stone.geo(potTop, new THREE.Matrix4().compose(V3(chx + dx, chTop + 0.28, chz + (dx > 0 ? 0.04 : -0.04)), new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -Math.PI / 2), ONE), scaleC(C_CLAY, 0.18));
    potTop.dispose();
  }
  const fr = slopeFrame(1);
  const flashC = slopePoint(fr, (CAB.x1 + ROOF.over - chx) / ROOF.cos, SHINGLE_TOP + 0.012, chz);
  M.copper.box({ c: flashC.toArray(), s: [0.82, 0.012, 0.82], q: fr.q, color: C_LEAD });

  // Front finial and rear weathervane
  const fin = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.032, 0.0),
      new THREE.Vector2(0.045, 0.045),
      new THREE.Vector2(0.018, 0.1),
      new THREE.Vector2(0.034, 0.17),
      new THREE.Vector2(0.0, 0.3),
    ],
    8
  );
  M.copper.geo(fin, new THREE.Matrix4().makeTranslation(CAB.cx, ROOF.apexY - 0.02, ROOF.z1 + 0.02), C_PATINA);
  fin.dispose();
  const vz = ROOF.z0 + 0.12;
  const vy = ROOF.apexY;
  cylBetween(M.copper, V3(CAB.cx, vy, vz), V3(CAB.cx, vy + 0.72, vz), 0.012, 0.008, 6, C_PATINA);
  const ball = new THREE.SphereGeometry(0.03, 6, 4);
  M.copper.geo(ball, new THREE.Matrix4().makeTranslation(CAB.cx, vy + 0.74, vz), C_COPPER);
  M.copper.geo(ball, new THREE.Matrix4().makeTranslation(CAB.cx, vy + 0.32, vz), C_COPPER);
  ball.dispose();
  M.copper.box({ c: [CAB.cx, vy + 0.4, vz], s: [0.44, 0.012, 0.012], color: C_PATINA });
  M.copper.box({ c: [CAB.cx, vy + 0.4, vz], s: [0.012, 0.012, 0.44], color: C_PATINA });
  // arrow: shaft, head and a vane tail, pointing roughly at the sun
  const arrowQ = rotY(-0.5);
  M.copper.box({ c: [CAB.cx, vy + 0.58, vz], s: [0.62, 0.014, 0.014], q: arrowQ, color: C_COPPER });
  const head = new THREE.ConeGeometry(0.035, 0.12, 6);
  M.copper.geo(
    head,
    new THREE.Matrix4().compose(V3(CAB.cx, vy + 0.58, vz).add(V3(0.31, 0, 0).applyQuaternion(arrowQ)), arrowQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -Math.PI / 2)), ONE),
    C_COPPER
  );
  head.dispose();
  M.copper.box({ c: V3(CAB.cx, vy + 0.58, vz).add(V3(-0.3, 0, 0).applyQuaternion(arrowQ)).toArray(), s: [0.14, 0.11, 0.008], q: arrowQ, color: C_PATINA });
}

// Lanterns, string lights, bunting, planter, pendant. Returns light positions.
function addLantern(ctx, top, { scale = 1, hang = 0.22, pendant = false } = {}) {
  const { M } = ctx;
  const sc = scale;
  const hs = 0.065 * sc;
  const H = 0.2 * sc;
  const bodyTop = top.y - hang;
  const cy = bodyTop - 0.03 * sc - H / 2;
  const iron = scaleC(C_IRON, 1.3);
  if (hang > 0.01) cylBetween(M.metal, top, V3(top.x, bodyTop + 0.12 * sc, top.z), 0.005, 0.005, 4, iron, true);
  // top ring, cap, plates, corner posts, glowing core
  M.metal.box({ c: [top.x, bodyTop + 0.115 * sc, top.z], s: [0.05 * sc, 0.03 * sc, 0.05 * sc], color: iron });
  const cap = new THREE.CylinderGeometry(0.01 * sc, hs * 1.7, 0.09 * sc, 4, 1, true);
  M.metal.geo(cap, new THREE.Matrix4().compose(V3(top.x, bodyTop + 0.045 * sc, top.z), rotY(Math.PI / 4), ONE), scaleC(iron, 0.7)); // sooty cap
  cap.dispose();
  M.metal.box({ c: [top.x, bodyTop - 0.012 * sc, top.z], s: [2 * hs + 0.02 * sc, 0.02 * sc, 2 * hs + 0.02 * sc], color: scaleC(iron, 0.55) }); // sooty top plate
  M.metal.box({ c: [top.x, cy - H / 2 - 0.012 * sc, top.z], s: [2 * hs + 0.025 * sc, 0.024 * sc, 2 * hs + 0.025 * sc], color: iron });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      M.metal.box({ c: [top.x + sx * hs, cy, top.z + sz * hs], s: [0.012 * sc, H, 0.012 * sc], color: iron });
    }
  }
  M.glow.box({ c: [top.x, cy, top.z], s: [2 * hs - 0.012 * sc, H - 0.01, 2 * hs - 0.012 * sc], color: WHITE });
  (pendant ? ctx.halos.large : ctx.halos.lantern).push(V3(top.x, cy, top.z));
  return V3(top.x, cy, top.z);
}

function stringLights(ctx, A, B, sag, spacing) {
  const { M, rng } = ctx;
  const pts = [];
  for (let k = 0; k <= 18; k++) pts.push(catenaryPoint(A, B, sag, k / 18));
  cableTube(M.metal, new THREE.CatmullRomCurve3(pts), 0.007, 18, scaleC(C_IRON, 1.0));
  const n = Math.max(2, Math.round(A.distanceTo(B) / spacing));
  for (let k = 1; k < n; k++) {
    const t = k / n + (rng() - 0.5) * 0.02;
    const p = catenaryPoint(A, B, sag, t);
    const bulb = p.clone().add(V3((rng() - 0.5) * 0.01, -0.05, (rng() - 0.5) * 0.01));
    ctx.inst.bulbs.push({ pos: bulb, quat: ID_Q, scale: V3(1, 1.15, 1) });
    ctx.halos.bulb.push(bulb);
    // tiny socket
    cylBetween(M.metal, p, p.clone().add(V3(0, -0.03, 0)), 0.008, 0.008, 4, scaleC(C_IRON, 1.4), true);
  }
}

function addDetails(ctx, { poleTop }) {
  const { M, rng } = ctx;
  const lights = {};

  // Lantern on the pole arm, on the front right post, and under the deck (the second point light)
  const arm = poleTop.clone().add(V3(0.0, -0.1, 0));
  cylBetween(M.metal, arm, arm.clone().add(V3(0.26, 0.0, 0.0)), 0.009, 0.009, 5, scaleC(C_IRON, 1.3));
  addLantern(ctx, arm.clone().add(V3(0.26, 0, 0)), { scale: 1.0, hang: 0.2 });
  addLantern(ctx, V3(DX1 - 0.045, 10.1, DZ1 - 0.04), { scale: 1.1, hang: 0.0 }); // stands on the front right post
  const under = addLantern(ctx, V3(2.9, BEAR_BOT - 0.0, BEAR_Z[2] + 0.15), { scale: 1.2, hang: 0.3 });
  lights.under = under.clone().add(V3(0, 0.0, 0.15));
  // two eye hooks that carry the under-deck chain
  M.metal.box({ c: [2.9, BEAR_BOT - 0.006, BEAR_Z[2] + 0.15], s: [0.06, 0.012, 0.06], color: scaleC(C_IRON, 1.3) });

  // Pendant lantern hanging from the ridge beam inside the cabin (the ceiling band seen through the door)
  const pend = addLantern(ctx, V3(CAB.cx + 0.05, ROOF.ridgeY - 0.16, CAB.z0 + 1.1), { scale: 1.5, hang: 0.6, pendant: true });
  lights.interior = pend.clone().add(V3(0, -0.12, 0.1));
  // a hanging bundle of dried herbs from a tie beam, for a hint of life
  const herb = new THREE.ConeGeometry(0.06, 0.22, 6, 1, true);
  M.cloth.geo(herb, new THREE.Matrix4().compose(V3(CAB.cx + 0.75, CAB.top - 0.36, 0.42), new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), Math.PI), ONE), [0.35, 0.33, 0.15]);
  herb.dispose();
  cylBetween(M.metal, V3(CAB.cx + 0.75, CAB.top - 0.17, 0.42), V3(CAB.cx + 0.75, CAB.top - 0.27, 0.42), 0.004, 0.004, 4, [0.3, 0.2, 0.1], true);

  // String lights along the front eave, from the pole and to the right post
  const eaveL = V3(CAB.cx - CAB.half - ROOF.over - 0.1, CAB.top - ROOF.over * ROOF.tan + 0.1, ROOF.z1 + 0.03);
  const eaveR = V3(CAB.cx + CAB.half + ROOF.over + 0.1, CAB.top - ROOF.over * ROOF.tan + 0.1, ROOF.z1 + 0.03);
  stringLights(ctx, eaveL, eaveR, 0.46, 0.34);
  stringLights(ctx, poleTop.clone().add(V3(0, -0.04, 0)), eaveL, 0.32, 0.34);
  stringLights(ctx, eaveR, V3(DX1 - 0.045, 10.25, DZ1 - 0.04), 0.28, 0.34);
  // eye screws where the strings attach
  for (const p of [eaveL, eaveR]) M.metal.box({ c: p.toArray(), s: [0.02, 0.04, 0.02], color: scaleC(C_IRON, 1.5) });

  // Bunting along a catenary from the pole to the front-left eave corner, faded brand colours
  const bA = poleTop.clone().add(V3(0.04, -0.2, 0.0));
  const bB = eaveL.clone().add(V3(0.0, -0.18, -0.02));
  const flagCols = [
    [0.08, 0.2, 0.08], // brand green, faded
    [0.7, 0.66, 0.55], // cream
    [0.34, 0.15, 0.05], // timber
    [0.5, 0.26, 0.07], // warm light, dusty
    [0.15, 0.22, 0.12], // moss
  ];
  const nF = 9;
  const cordPts = [];
  for (let k = 0; k <= 14; k++) cordPts.push(catenaryPoint(bA, bB, 0.34, k / 14));
  cableTube(M.metal, new THREE.CatmullRomCurve3(cordPts), 0.005, 14, [0.3, 0.2, 0.1]);
  for (let k = 0; k < nF; k++) {
    const t0 = (k + 0.2) / nF;
    const t1 = (k + 0.8) / nF;
    const p0 = catenaryPoint(bA, bB, 0.34, t0);
    const p1 = catenaryPoint(bA, bB, 0.34, t1);
    const along = p1.clone().sub(p0);
    const nrm = new THREE.Vector3().crossVectors(along, V3(0, -1, 0)).normalize();
    const hgt = 0.2 + rng() * 0.04;
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const tipP = mid.clone().add(V3((rng() - 0.5) * 0.04, -hgt, (rng() - 0.5) * 0.03));
    const bulgeP = nrm.clone().multiplyScalar(0.012 + rng() * 0.01);
    const midL = p0.clone().lerp(tipP, 0.5).add(bulgeP);
    const midR = p1.clone().lerp(tipP, 0.5).sub(bulgeP);
    const col = scaleC(flagCols[(k + Math.floor(rng() * 2)) % flagCols.length], 0.85 + rng() * 0.3);
    const dark = scaleC(col, 0.78);
    M.cloth.tri(p0, p1, midR, nrm, [[0, 1], [1, 1], [1, 0.5]], col);
    M.cloth.tri(p0, midR, midL, nrm, [[0, 1], [1, 0.5], [0, 0.5]], col);
    M.cloth.tri(midL, midR, tipP, nrm, [[0, 0.5], [1, 0.5], [0.5, 0]], dark);
  }

  // Hanging planter under the front-left eave: pot, three chains, trailing ivy and a top tuft
  // roof underside height at x = 0.62, on the rafter at z = 1.45
  const hook = V3(0.62, CAB.top - (CAB.x0 - 0.62) * ROOF.tan, 1.45);
  const potC = hook.clone().add(V3(0, -0.52, 0));
  const potProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.07, 0.0),
    new THREE.Vector2(0.115, 0.07),
    new THREE.Vector2(0.135, 0.15),
    new THREE.Vector2(0.14, 0.17),
    new THREE.Vector2(0.115, 0.17),
  ];
  const pot = new THREE.LatheGeometry(potProfile, 10);
  M.stone.geo(pot, new THREE.Matrix4().makeTranslation(potC.x, potC.y - 0.12, potC.z), C_CLAY, [1.0, 1.0]);
  pot.dispose();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.4;
    cylBetween(M.metal, V3(potC.x + Math.cos(a) * 0.13, potC.y + 0.04, potC.z + Math.sin(a) * 0.13), hook, 0.004, 0.004, 4, scaleC(C_IRON, 1.6), true);
  }
  ctx.planter = { center: potC.clone().add(V3(0, 0.02, 0)) };
  return lights;
}

// Rope ladder from the deck edge to the ground. Built relative to the anchor so the group can
// sway about the top.
function buildLadder() {
  const rope = new Mesher();
  const wood = new Mesher();
  const rng = createRng(9137);
  const cx = (-1.25 + -0.65) / 2;
  const anchor = V3(cx, JOIST_TOP + 0.0, DZ1 + 0.1);
  const topY = 0;
  const botY = -(anchor.y - 0.35);
  const halfW = 0.225;
  // Garden pass: a rigid timber ladder (two stringers and flat rungs) leaning from the deck edge to
  // the lawn, as in the references. It leans toward the camera: the foot sits forward (+z) and out.
  // Leans out at about 65 degrees from the lawn, as in the reference: the foot sits about 4 m out
  // from the deck front. (The climb camera path in climb.js is written for this foot position.)
  const footX = 0.4;
  const footZ = 4.0;
  // Point on one stringer at fraction t (0 = deck edge, 1 = foot on the lawn). Splays out a little at the foot.
  const railAt = (sideSign, t) =>
    V3(sideSign * (halfW + 0.12 * t) + footX * t, topY + (botY - topY) * t, footZ * t);
  for (const sideSign of [-1, 1]) {
    // stringers: warm timber, slightly darker toward the lawn
    cylBetween(wood, railAt(sideSign, 0), railAt(sideSign, 1), 0.04, 0.04, 6, scaleC(C_TRIM, 0.95), false, [0.15, 0.6]);
  }
  // closely spaced, sturdy rungs that run a little past the rails, as on the reference staircase
  const rungCount = 17;
  for (let k = 0; k < rungCount; k++) {
    const t = 0.08 + (0.86 * k) / (rungCount - 1) + (rng() - 0.5) * 0.008;
    const a = railAt(-1, t).add(V3(-0.03, 0, 0));
    const b = railAt(1, t).add(V3(0.03, 0, 0));
    const tone = 0.95 + rng() * 0.08;
    cylBetween(wood, a, b, 0.03, 0.03, 6, scaleC(C_TRIM, tone), false, [0.15, 0.6]);
  }
  // Deck-edge fixing: a short iron bracket where the stringers meet the joists
  cylBetween(wood, V3(-halfW, 0.0, 0), V3(halfW, 0.0, 0), 0.02, 0.02, 6, scaleC(C_IRON, 1.2), false);
  return { rope, wood, anchor };
}

export function buildTreehouseModel() {
  const M = {};
  for (const k of MESH_KEYS) M[k] = new Mesher();
  const inst = { bolts: [], balusters: [], bulbs: [] };
  const halos = { bulb: [], lantern: [], large: [], window: [] };
  const ctx = { M, inst, halos, rng: createRng(20240611) };

  addDeck(ctx);
  addUnderStructure(ctx);
  const { poleTop } = addRailings(ctx);
  addCabin(ctx);
  addRoof(ctx);
  const lights = addDetails(ctx, { poleTop });
  const ladder = buildLadder();

  // Triangle accounting: merged meshes plus instanced geometries (counts of the source geometry)
  const BOLT_TRIS = 18;
  const BALUSTER_TRIS = 20;
  const BULB_TRIS = 20;
  const stats = { merged: {}, instanced: {}, total: 0 };
  let total = 0;
  for (const k of MESH_KEYS) {
    stats.merged[k] = M[k].tris;
    total += M[k].tris;
  }
  stats.merged.ladderRope = ladder.rope.tris;
  stats.merged.ladderWood = ladder.wood.tris;
  total += ladder.rope.tris + ladder.wood.tris;
  stats.instanced.bolts = inst.bolts.length * BOLT_TRIS;
  stats.instanced.balusters = inst.balusters.length * BALUSTER_TRIS;
  stats.instanced.bulbs = inst.bulbs.length * BULB_TRIS;
  total += stats.instanced.bolts + stats.instanced.balusters + stats.instanced.bulbs;
  stats.total = total;
  return { M, inst, halos, lights, ladder, planter: ctx.planter, stats };
}

// ------------------------------------------------------------------------------------------------
// ASSETS: geometry + materials. Built once under <Canvas> (textures need a browser).
// ------------------------------------------------------------------------------------------------
function makeInstanced(geometry, material, items, { cast = false, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    m.compose(it.pos, it.quat || ID_Q, it.scale || ONE);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, col.setRGB(it.color[0], it.color[1], it.color[2]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

function pointsOf(list, material) {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(list.length * 3);
  list.forEach((p, i) => p.toArray(arr, i * 3));
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(g, material);
  pts.frustumCulled = false;
  return pts;
}

function buildAssets() {
  const model = buildTreehouseModel();
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  // Textures from the toolkit (cached and shared: not disposed here)
  const deckT = createWoodTextures({ kind: "weathered", seed: 3, size: 512 });
  const plankT = createWoodTextures({ kind: "plank", seed: 4, size: 384 });
  const beamT = createWoodTextures({ kind: "beam", seed: 5, size: 384 });
  const trimT = createWoodTextures({ kind: "trim", seed: 6, size: 256 });
  const shingleT = createShingleTextures({ seed: 5, size: 384, kind: "cedar" });
  const ropeT = createRopeTextures({ seed: 9, size: 256 });
  const mossT = createMossTexture({ seed: 4, size: 256 });
  const smudge = createGlassSmudgeTexture({ seed: 6, size: 256 });
  const halo = createSoftSpriteTexture({ size: 128, kind: "soft", power: 2.2 });
  const ivyT = createLeafCardTexture({ kind: "ivy", seed: 8, size: 256 });
  const stoneT = keep(makeStoneTextures(21));
  const curtainTex = keep(makeCurtainTexture());

  const pbr = (set, extra = {}) =>
    keep(
      new THREE.MeshStandardMaterial({
        map: set.map,
        normalMap: set.normalMap,
        roughnessMap: set.roughnessMap,
        aoMap: set.roughnessMap,
        roughness: 1,
        metalness: 0,
        aoMapIntensity: 1,
        vertexColors: true,
        ...extra,
      })
    );

  const mats = {
    deck: pbr(deckT),
    beam: pbr(beamT),
    wall: pbr(plankT),
    trim: pbr(trimT),
    shingle: pbr(shingleT, { normalScale: new THREE.Vector2(1.2, 1.2) }),
    moss: pbr(mossT, { roughness: 1 }),
    rope: pbr(ropeT),
    // painted wood: colour from vertex colours, grain relief and cavities from the trim maps
    paint: keep(
      new THREE.MeshStandardMaterial({
        normalMap: trimT.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughnessMap: trimT.roughnessMap,
        aoMap: trimT.roughnessMap,
        roughness: 1.1,
        metalness: 0,
        vertexColors: true,
      })
    ),
    // wrought iron: dark, mottled roughness from the smudge map (rust and oil)
    metal: keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.85,
        roughness: 1.25,
        roughnessMap: smudge,
        vertexColors: true,
        side: THREE.DoubleSide,
      })
    ),
    copper: keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.85,
        roughness: 1.0,
        roughnessMap: smudge,
        vertexColors: true,
        side: THREE.DoubleSide,
      })
    ),
    stone: keep(
      new THREE.MeshStandardMaterial({
        map: stoneT.map,
        normalMap: stoneT.normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.93,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      })
    ),
    glow: keep(
      new THREE.MeshStandardMaterial({
        color: 0x2a1708,
        emissive: new THREE.Color(PALETTE.warmLight).lerp(new THREE.Color(PALETTE.cream), 0.4),
        emissiveIntensity: 2.6,
        roughness: 0.4,
        vertexColors: true,
      })
    ),
    glass: keep(
      new THREE.MeshStandardMaterial({
        color: 0xdbe8e6,
        metalness: 0.15,
        roughness: 1,
        roughnessMap: smudge,
        envMapIntensity: 2.2,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
      })
    ),
    curtain: keep(
      new THREE.MeshStandardMaterial({
        color: 0x1a0f06,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: curtainTex,
        emissiveIntensity: 1.35,
        map: curtainTex,
        roughness: 0.95,
        vertexColors: true,
      })
    ),
    cloth: keep(
      new THREE.MeshStandardMaterial({
        roughness: 0.95,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      })
    ),
  };

  // Geometry per merged mesh. Which meshes cast and receive shadows:
  const flags = {
    deck: [true, true],
    beam: [true, true],
    wall: [true, true],
    trim: [true, true],
    paint: [true, true],
    shingle: [true, true],
    rope: [false, true],
    metal: [false, true],
    copper: [false, true],
    stone: [true, true],
    glow: [false, false],
    glass: [false, false],
    curtain: [false, false],
    cloth: [false, true],
    moss: [false, true],
  };
  const parts = MESH_KEYS.filter((k) => model.M[k].tris > 0).map((k) => ({
    key: k,
    geometry: keep(model.M[k].build()),
    material: mats[k],
    cast: flags[k][0],
    receive: flags[k][1],
  }));

  // Instanced meshes
  const metalI = keep(
    new THREE.MeshStandardMaterial({ color: 0x606264, metalness: 0.85, roughness: 1.2, roughnessMap: smudge })
  );
  const boltG = keep(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 6, 1));
  // keep the torso and the top cap only (the bottom cap sits against the wood)
  boltG.setIndex(Array.from(boltG.index.array).slice(0, 54));
  const boltMesh = makeInstanced(boltG, metalI, model.inst.bolts, { cast: false });

  const balPts = [new THREE.Vector2(0.015, 0), new THREE.Vector2(0.027, 0.4), new THREE.Vector2(0.015, 0.8)];
  const balG = keep(new THREE.LatheGeometry(balPts, 5));
  const balM = keep(
    new THREE.MeshStandardMaterial({
      map: trimT.map,
      normalMap: trimT.normalMap,
      roughnessMap: trimT.roughnessMap,
      aoMap: trimT.roughnessMap,
      roughness: 1,
    })
  );
  const balMesh = makeInstanced(balG, balM, model.inst.balusters, { cast: true });

  const bulbG = keep(new THREE.SphereGeometry(0.032, 5, 3));
  const bulbM = keep(
    new THREE.MeshStandardMaterial({
      color: 0x2a1a0c,
      emissive: new THREE.Color(PALETTE.lampGlow),
      emissiveIntensity: 4.5,
      roughness: 0.3,
    })
  );
  const bulbMesh = makeInstanced(bulbG, bulbM, model.inst.bulbs, { cast: false, receive: false });

  // Soft halos around bulbs, lanterns and windows (additive sprites, one draw call each)
  const haloMat = (size, opacity, color) =>
    keep(
      new THREE.PointsMaterial({
        map: halo,
        size,
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
  const halos = [
    pointsOf(model.halos.bulb, haloMat(0.3, 0.55, PALETTE.warmLight)),
    pointsOf(model.halos.lantern, haloMat(0.7, 0.5, PALETTE.warmLight)),
    pointsOf(model.halos.large, haloMat(1.4, 0.42, PALETTE.warmLight)),
    pointsOf(model.halos.window, haloMat(1.3, 0.28, PALETTE.warmLight)),
  ].map((p) => {
    keep(p.geometry);
    return p;
  });

  // Ladder: rope and rungs relative to the anchor
  const ladderRope = keep(model.ladder.rope.build());
  const ladderWood = keep(model.ladder.wood.build());

  // Trailing ivy and a leafy tuft in the planter (alpha-cut cards from the toolkit)
  const ivyMat = keep(
    makeFoliageMaterial({
      map: ivyT.map,
      normalMap: ivyT.normalMap,
      tint: PALETTE.leafMid,
      translucency: 0.5,
      roughness: 0.75,
      normalScale: 0.6,
      wind: null,
    })
  );
  const ivyG = keep(buildLeafClusterGeometry({ cards: 2, width: 0.3, height: 0.4, bend: 0.3, segments: [1, 1], pivot: "bottom", seed: 11 }));
  const pc = model.planter.center;
  const rr = createRng(515);
  const ivyItems = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + rr();
    const trailing = k % 3 !== 0;
    const base = V3(pc.x + Math.cos(a) * 0.11, pc.y - (trailing ? 0.04 : -0.02), pc.z + Math.sin(a) * 0.11);
    const euler = trailing
      ? new THREE.Euler(Math.PI - 0.25 - rr() * 0.3, a, 0, "YXZ") // hang downward, away from the pot
      : new THREE.Euler(0.4 + rr() * 0.4, a, 0, "YXZ");
    const s = trailing ? 0.9 + rr() * 1.0 : 0.75 + rr() * 0.4;
    ivyItems.push({
      pos: base,
      quat: new THREE.Quaternion().setFromEuler(euler),
      scale: V3(s, s, s),
      color: [0.7 + rr() * 0.5, 0.75 + rr() * 0.4, 0.6 + rr() * 0.3],
    });
  }
  const ivyMesh = makeInstanced(ivyG, ivyMat, ivyItems, { cast: false });

  const dispose = () => {
    for (const x of disposables) {
      if (x && typeof x.dispose === "function") x.dispose();
      else if (x && x.map && x.map.dispose) {
        x.map.dispose();
        x.normalMap.dispose();
      }
    }
    boltMesh.dispose();
    balMesh.dispose();
    bulbMesh.dispose();
    ivyMesh.dispose();
  };

  return {
    parts,
    instanced: [boltMesh, balMesh, bulbMesh, ivyMesh],
    halos,
    ladder: { rope: ladderRope, wood: ladderWood, anchor: model.ladder.anchor, ropeMat: mats.rope, woodMat: mats.trim },
    lights: model.lights,
    stats: model.stats,
    dispose,
  };
}

// ------------------------------------------------------------------------------------------------
// Component
// ------------------------------------------------------------------------------------------------
export default function Treehouse() {
  const assets = useMemo(() => buildAssets(), []);
  // The oak (bark and leaf textures, geometry) mounts a frame later than the cabin.
  const treeReady = useStaged(2);
  const reduced = useReducedMotion();
  const ladderRef = useRef(null);
  const interiorRef = useRef(null);
  const underRef = useRef(null);

  useEffect(() => () => assets.dispose(), [assets]);

  // Tiny life: the ladder swings on its anchor, the lantern flames breathe.
  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    if (ladderRef.current) {
      ladderRef.current.rotation.x = Math.sin(t * 0.55) * 0.02;
      ladderRef.current.rotation.z = Math.sin(t * 0.43 + 1.0) * 0.014;
    }
    if (interiorRef.current) interiorRef.current.intensity = 11 * (1 + 0.025 * Math.sin(t * 7.1) + 0.018 * Math.sin(t * 13.7 + 1.3));
    if (underRef.current) underRef.current.intensity = 2.6 * (1 + 0.03 * Math.sin(t * 6.3 + 2.0) + 0.02 * Math.sin(t * 11.9));
  });

  return (
    <>
      {treeReady && <Tree />}
      <group position={[TREE.x, 0, TREE.z]}>
        {assets.parts.map((p) => (
          <mesh key={p.key} geometry={p.geometry} material={p.material} castShadow={p.cast} receiveShadow={p.receive} />
        ))}
        {assets.instanced.map((m) => (
          <primitive key={m.uuid} object={m} dispose={null} />
        ))}
        {assets.halos.map((h) => (
          <primitive key={h.uuid} object={h} dispose={null} />
        ))}
        <group ref={ladderRef} name="hero-rope-ladder" position={assets.ladder.anchor}>
          <mesh geometry={assets.ladder.rope} material={assets.ladder.ropeMat} castShadow receiveShadow />
          <mesh geometry={assets.ladder.wood} material={assets.ladder.woodMat} castShadow receiveShadow />
        </group>
        {/* Warm interior light tuned to stay on the cabin, porch and eaves */}
        <pointLight ref={interiorRef} position={assets.lights.interior.toArray()} color={PALETTE.lampGlow} intensity={11} distance={8} decay={2} />
        {/* Hanging lantern under the deck: lights the joists, bearers and braces */}
        <pointLight ref={underRef} position={assets.lights.under.toArray()} color={PALETTE.lampGlow} intensity={2.6} distance={6} decay={2} />
      </group>
    </>
  );
}
