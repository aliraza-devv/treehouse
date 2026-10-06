// Geometry for the four hand carved signposts (Signposts.jsx). Pure maths, no canvas: it runs under node.
//
// A signpost is built in its own local frame: origin at the foot of the post on the ground, +Y up, the
// lettered face of the board looking along +Z (toward the oncoming walker, before the sign's yaw). The
// component then places it with a position, a yaw and a lean (signFrame).
//
//   post      hewn octagon, slightly twisted and bowed, a little wider at the foot, buried 16 cm, with a
//             bevelled cap that sheds rain. Faceted: every face of the adze is flat.
//   board     an arm passing through a mortise in the post (the tenon shows 3.5 cm on the far side) and
//             running away from the path. Hand cut outline: wavering edges, drooping end, one chipped corner,
//             a pointed fingerpost end on some, plus one detail that differs: a V notch, a rope loop through
//             a drilled hole, an old broken arm stub. Two draw bored pegs show on the post face.
//   clutter   (world space, signClutter) a soil mound packed round the foot, stones, moss cushions, tufts of
//             grass: they are what makes the post look SET INTO the ground and not stuck on it.
//
// Material groups of the sign mesh: 0 the lettered board face (its own texture), 1 weathered wood.

import * as THREE from "three";
import { createRng, range } from "@/lib/random";
import { createNoise } from "@/lib/noise";
import { SIGNS, atPath } from "@/lib/sections/world";
import { groundSurface, rideHeight } from "./pathMath";
import { createBuilder, DEG, TAU, clamp, smoothstep, hash1 } from "./propKit";
import { layoutWord } from "./propLetters";
import { SIGN_TEX } from "./propSignTextures";
import { TONES, linearOf, mixBytes } from "./propTones";

// ------------------------------------------------------------------------------------------------
// TUNING: what is different about each sign (everything else is shared)
// ------------------------------------------------------------------------------------------------
export const SIGN_LOOKS = {
  surrey: {
    boardCentre: 1.46, // metres above the foot: the centre of the board, near eye level so the lettering is read straight on
    boardHeight: 0.27,
    postTop: 1.94,
    pointed: true,
    decor: "leaf", // a small carved oak leaf after the name
    wood: { silver: 0.74, groove: 0.74, lichen: 0.3, damp: 0.4, cracks: 2 },
    chestnut: false,
    droop: 0.012, // how far the free end sags (metres)
    chip: "shoulder",
    tint: [1.0, 1.0, 0.98],
  },
  "lake-como": {
    boardCentre: 1.4,
    boardHeight: 0.29,
    postTop: 2.06,
    pointed: false,
    decor: null,
    notch: true, // a V notch cut in the top edge, where a tally used to be counted
    wood: { silver: 0.6, groove: 0.76, lichen: 0.2, damp: 0.3, cracks: 2 },
    chestnut: true, // sweet chestnut: honey where it is not yet silvered
    droop: 0.006,
    chip: "corner",
    tint: [1.04, 1.0, 0.94],
  },
  quebec: {
    boardCentre: 1.5,
    boardHeight: 0.265,
    postTop: 1.9,
    pointed: true,
    decor: null,
    ropeHole: true, // a drilled hole at the tip with a loop of hemp rope
    stub: true, // the stump of an older, broken arm lower down
    wood: { silver: 0.82, groove: 0.64, lichen: 0.34, damp: 0.55, cracks: 3, mossGroove: 0.75 },
    chestnut: false,
    droop: 0.016,
    chip: "none",
    tint: [0.96, 1.0, 0.96],
  },
  seychelles: {
    boardCentre: 1.44,
    boardHeight: 0.28,
    postTop: 1.98,
    pointed: false,
    decor: "bird", // a swift carved before the name
    wood: { silver: 0.5, groove: 0.8, lichen: 0.14, damp: 0.2, cracks: 1 },
    chestnut: false,
    droop: 0.004,
    chip: "corner",
    tint: [1.03, 1.02, 0.98],
  },
};

const POST_A = 0.077; // half width, flat to flat (a 15.4 cm hewn oak post)
const BOARD_T = 0.048; // board thickness
const TENON_OUT = 0.035; // how far the through tenon shows on the post's far side
const TEXT_MARGIN = 0.066; // clear wood between the post face and the first letter
const POINT_LEN = 0.17; // length of the pointed end (the tip is mid height)
const OCT_R = POST_A / Math.cos(Math.PI / 8); // octagon circumradius from the flat half width
const POST_TILE_M = SIGN_TEX.postH / (SIGN_TEX.postW / SIGN_TEX.postPerimeterM); // metres of post one texture tile covers

// ------------------------------------------------------------------------------------------------
// Frames
// ------------------------------------------------------------------------------------------------
// World placement of a sign: foot position, yaw (the lettered face looks at the oncoming walker, turned by
// sign.yawDeg, positive turning it toward the walker's right), and the lean quaternion (leanDeg toward the path
// or away from it, in the direction across the path).
export function signFrame(sign) {
  const p = atPath(sign.s, sign.lateral);
  const side = Math.sign(sign.lateral) || 1;
  const y = groundSurface(p.x, p.z);
  // Local +Z -> (sin yaw, cos yaw) in (x, z). To face the oncoming walker (direction -t) the yaw is atan2(-tx, -tz).
  const yaw = Math.atan2(-p.tx, -p.tz) + sign.yawDeg * DEG;
  const dir = (sign.leanToward === "path" ? -side : side) * 1;
  const lx = p.rx * dir;
  const lz = p.rz * dir;
  const axis = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(lx, 0, lz)).normalize(); // up x lean direction
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const qLean = new THREE.Quaternion().setFromAxisAngle(axis, sign.leanDeg * DEG);
  return { x: p.x, y, z: p.z, yaw, side, quaternion: qLean.multiply(qYaw), path: p };
}

// ------------------------------------------------------------------------------------------------
// The plan: every dimension of a sign, and what its board texture needs to paint
// ------------------------------------------------------------------------------------------------
export function planSign(sign, index) {
  const look = SIGN_LOOKS[sign.id];
  const side = Math.sign(sign.lateral) || 1; // the arm runs AWAY from the path, so the camera can never meet it
  const seed = 40 + index * 7;
  const rng = createRng(seed * 911 + 5);
  const h = look.boardHeight;
  const yb0 = look.boardCentre - h / 2;

  // text and decoration laid out left to right in the board frame (the viewer's frame)
  const word = layoutWord(sign.label, { seed: seed + 1 });
  const decorSize = look.decor === "bird" ? 0.145 : look.decor === "leaf" ? 0.13 : 0;
  const decorAdv = look.decor === "bird" ? 1.2 * decorSize : look.decor === "leaf" ? 0.62 * decorSize : 0;
  const gap = decorSize ? 0.06 : 0;

  let x0; // left end of the board
  let x1; // right end
  let textX; // baseline left of the word
  let decor = null;
  const baseline = yb0 + (h - 0.124) / 2;
  const tipLen = look.pointed ? POINT_LEN : 0;
  if (side > 0) {
    // post at the left: the arm runs to the right
    const start = POST_A + TEXT_MARGIN;
    x0 = -(POST_A + TENON_OUT);
    let cursor = start;
    if (look.decor === "bird") {
      decor = { kind: "bird", x: cursor, y: baseline - 0.012, size: decorSize, rot: 0.05 };
      cursor += decorAdv + gap;
    }
    textX = cursor;
    cursor += word.width;
    if (look.decor === "leaf") {
      decor = { kind: "leaf", x: cursor + gap, y: baseline - 0.012, size: decorSize, rot: -0.2 };
      cursor += gap + decorAdv;
    }
    x1 = cursor + 0.04 + tipLen;
  } else {
    // post at the right: the arm runs to the left, so the board's pointed end is on the left
    x1 = POST_A + TENON_OUT;
    let cursor = -(POST_A + TEXT_MARGIN);
    if (look.decor === "leaf") {
      decor = { kind: "leaf", x: cursor - decorAdv, y: baseline - 0.012, size: decorSize, rot: 0.2 };
      cursor -= decorAdv + gap;
    }
    cursor -= word.width;
    textX = cursor;
    if (look.decor === "bird") {
      cursor -= gap + decorAdv;
      decor = { kind: "bird", x: cursor, y: baseline - 0.012, size: decorSize, rot: 0.05 };
    }
    x0 = cursor - 0.04 - tipLen;
  }
  // board rectangle covered by the texture (a little slack for the droop and wobble of the edges)
  const slack = 0.012;
  const bx0 = x0;
  const bx1 = x1;
  const by0 = yb0 - slack;
  const by1 = yb0 + h + slack;
  const pxPerM = SIGN_TEX.boardPxPerM;
  const wPx = Math.ceil(((bx1 - bx0) * pxPerM) / 4) * 4;
  const hPx = Math.ceil(((by1 - by0) * pxPerM) / 4) * 4;
  const early = look.chestnut ? TONES.chestnutEarly : TONES.oakEarly;
  const late = look.chestnut ? TONES.chestnutLate : TONES.oakLate;

  return {
    id: sign.id,
    index,
    seed,
    side,
    look,
    rng,
    board: { x0, x1, yb0, h, bx0, bx1, by0, by1, droopSide: side },
    postTop: look.postTop,
    texture: {
      seed,
      text: sign.label,
      w: wPx,
      h: hPx,
      pxPerM,
      x0: bx0,
      y0: by0,
      textX,
      textY: baseline,
      cap: 0.14,
      small: 0.114,
      decor,
      look: { ...look.wood, early, late },
    },
  };
}

// ------------------------------------------------------------------------------------------------
// The post
// ------------------------------------------------------------------------------------------------
function buildPost(b, plan, rng, noise) {
  const top = plan.postTop;
  // ring heights: buried foot, ground line, a slight flare, then the long shaft, the bevelled cap
  const ys = [-0.16, 0.0, 0.2, 0.62, 1.18, 1.62, top - 0.16, top - 0.03, top];
  const tint = plan.look.tint;
  const vOff = rng() * 3;
  const uOff = rng();
  const twist = (rng() - 0.5) * 0.09; // radians of twist over the whole length (a hand hewn post is never true)
  const bowX = (rng() - 0.5) * 0.03;
  const bowZ = (rng() - 0.5) * 0.026;
  const fRad = ys.map((_, i) => {
    // per ring, per face radius jitter: each adze cut is a little deeper or shallower
    const row = [];
    for (let j = 0; j < 8; j++) row.push(1 + (rng() - 0.5) * 0.07 + 0.012 * noise.perlin2(i * 0.9, j * 1.7));
    return row;
  });
  const rings = ys.map((y, i) => {
    const t = clamp((y + 0.16) / (top + 0.16));
    // wider at the foot (an oak post is cut from the butt), the cap narrows to shed water
    const foot = 1 + 0.07 * (1 - smoothstep(-0.16, 0.9, y));
    const cap = i === ys.length - 2 ? 0.78 : i === ys.length - 1 ? 0.46 : 1;
    const ang = twist * t;
    const bx = bowX * Math.sin(Math.PI * t);
    const bz = bowZ * Math.sin(Math.PI * t * 1.2);
    const ring = [];
    for (let j = 0; j < 8; j++) {
      // octagon vertices at 22.5 + 45 j degrees (from +X toward +Z) so the flat faces look along +-Z and +-X
      const th = (j * TAU) / 8 + TAU / 16 + ang;
      const r = OCT_R * foot * cap * fRad[i][j];
      ring.push([bx + Math.cos(th) * r, y, bz + Math.sin(th) * r]);
    }
    return ring;
  });
  // vertex colours (linear): near the foot the post is damp, dark and green with moss; elsewhere a quiet tint
  b.loft(rings, {
    group: 1,
    faceted: true,
    uv: (i, j) => [j / 8 + uOff, (ys[i] + vOff) / POST_TILE_M],
    color: (i, j) => {
      const y = ys[i];
      const jitter = 0.94 + 0.12 * hash1(i * 8 + j, plan.seed);
      const foot = 1 - smoothstep(0.0, 0.5, y); // 1 at the ground line, 0 half a metre up
      const mossK = foot * (0.5 + 0.35 * hash1(j + 11, plan.seed + 3)) * (plan.id === "quebec" ? 1.25 : 0.8);
      const cap = i >= ys.length - 2 ? 0.88 : 1; // the cap is darker: it holds the rain
      const damp = 1 - 0.3 * foot; // damp darkening near the ground
      const k = jitter * cap * damp;
      // a multiplier on the post texture (which carries the silvered oak): near the ground a green one, less red and
      // blue, where moss grows (the same trick the hero trunk uses)
      const m = Math.min(1, mossK) * 0.7;
      return [tint[0] * k * (1 - 0.24 * m), tint[1] * k * (1 + 0.4 * m), tint[2] * k * (1 - 0.3 * m)];
    },
  });
  // flat cap on the top
  const last = rings[rings.length - 1];
  const c = [0, 0, 0];
  for (const p of last) {
    c[0] += p[0] / 8;
    c[1] += p[1] / 8;
    c[2] += p[2] / 8;
  }
  const cc = b.vert(c, [0, 1, 0], 0.5, 0.5, tint);
  const ids = last.map((p) => b.vert(p, [0, 1, 0], 0.5 + p[0] * 4, 0.5 + p[2] * 4, [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9]));
  for (let j = 0; j < 8; j++) b.triHint(cc, ids[j], ids[(j + 1) % 8], [0, 1, 0], 1);
  return { bowX, bowZ, twist, rings };
}

// ------------------------------------------------------------------------------------------------
// The board: outline, extrusion, pegs, the details that differ
// ------------------------------------------------------------------------------------------------
function boardContour(plan, rng, noise) {
  const { x0, x1, yb0, h } = plan.board;
  const look = plan.look;
  const side = plan.side;
  const wob = (x, k) => 0.0028 * noise.perlin2(x * 7 + k * 3, k) + 0.0012 * (rng() - 0.5);
  // the free end sags: droop grows with the square of the distance from the post
  const farX = side > 0 ? x1 : x0;
  const span = Math.abs(farX);
  const droop = (x) => -look.droop * Math.pow(clamp(Math.abs(x) / span), 2.2);
  const tipLen = look.pointed ? POINT_LEN : 0;
  // x positions of the points along the straight edges, left to right, ending at the shoulders of a pointed end
  const left = look.pointed && side < 0 ? x0 + tipLen : x0;
  const right = look.pointed && side > 0 ? x1 - tipLen : x1;
  const nSeg = Math.max(3, Math.round((right - left) / 0.2));
  const xs = [];
  for (let i = 0; i <= nSeg; i++) xs.push(left + ((right - left) * i) / nSeg + (i > 0 && i < nSeg ? (rng() - 0.5) * 0.03 : 0));
  const bottom = xs.map((x) => [x, yb0 + droop(x) + wob(x, 1)]);
  const top = xs.map((x) => [x, yb0 + h + droop(x) + wob(x, 2)]);
  const tipY = yb0 + h * 0.5 + droop(farX);
  const contour = [...bottom];
  // ---- the right end, bottom to top
  if (look.pointed && side > 0) {
    contour.push([x1, tipY - 0.004]);
    if (look.chip === "shoulder") contour.push([x1 - tipLen * 0.52, yb0 + h * 0.86 + droop(x1)]);
  } else if (look.chip === "corner" && side > 0) {
    // one corner of the far end is chipped off: the top right is missing a wedge
    top.pop();
    contour.push([x1 + 0.003, yb0 + h * 0.58 + droop(x1)], [x1 - 0.036, yb0 + h * 0.8 + droop(x1)], [x1 - 0.018, yb0 + h * 1.0 + droop(x1)]);
  }
  // ---- the top edge, right to left, with the notch cut in it
  const topRev = top.slice().reverse();
  if (look.notch) {
    const nx = x1 - 0.36;
    const k = topRev.findIndex((p) => p[0] < nx);
    topRev.splice(Math.max(0, k), 0, [nx + 0.034, yb0 + h + droop(nx)], [nx, yb0 + h - 0.052 + droop(nx)], [nx - 0.03, yb0 + h + droop(nx)]);
  }
  contour.push(...topRev);
  // ---- the left end, top to bottom
  if (look.pointed && side < 0) {
    if (look.chip === "shoulder") contour.push([x0 + tipLen * 0.5, yb0 + h * 0.88 + droop(x0)]);
    contour.push([x0, tipY - 0.004]);
  }
  return contour;
}

// remove consecutive duplicate points and make sure the loop is counter clockwise
function cleanContour(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) out.reverse();
  return out;
}

function buildBoard(b, plan, rng, noise) {
  const { bx0, bx1, by0, by1 } = plan.board;
  const contour = cleanContour(boardContour(plan, rng, noise));
  const holes = [];
  let ropeAt = null;
  if (plan.look.ropeHole) {
    const hx = plan.side > 0 ? plan.board.x1 - 0.085 : plan.board.x0 + 0.085;
    const hy = plan.board.yb0 + plan.board.h * 0.5 - 0.002;
    const hole = [];
    for (let k = 0; k < 7; k++) {
      // clockwise (a hole)
      const a = -(k / 7) * TAU;
      hole.push([hx + Math.cos(a) * 0.0115 * (1 + 0.15 * (rng() - 0.5)), hy + Math.sin(a) * 0.0115]);
    }
    holes.push(hole);
    ropeAt = [hx, hy];
  }
  const z0 = -BOARD_T / 2;
  const z1 = BOARD_T / 2;
  const tile = 0.5;
  b.extrude(contour, holes, z0, z1, {
    gFront: 0,
    gBack: 1,
    gSide: 1,
    uvFront: (x, y) => [(x - bx0) / (bx1 - bx0), (y - by0) / (by1 - by0)],
    uvBack: (x, y) => [x / tile + 0.3, y / tile],
    uvSide: (x, y, z) => [(x + z) / tile + 0.6, y / tile],
    color: [1, 1, 1],
    colorSide: [0.92, 0.9, 0.86], // end grain and edges are darker
  });
  return { contour, ropeAt };
}

// a peg: a short octagonal pin with a chamfered head, driven through the post face into the tenon
function addPeg(b, x, y, z, rng, color) {
  const r = 0.0105 + 0.0015 * rng();
  const out = 0.012 + 0.005 * rng();
  const j = () => (rng() - 0.5) * 0.004;
  b.tube(
    [
      [x + j(), y + j(), z - 0.004],
      [x, y, z + out * 0.75],
      [x + j() * 0.5, y + j() * 0.5, z + out],
    ],
    [r * 1.0, r, r * 0.72],
    6,
    { group: 1, color, capEnd: true },
  );
}

// the rope loop through the drilled hole (hemp, a little untidy)
function addRopeLoop(b, at, plan) {
  const [hx, hy] = at;
  const z = BOARD_T / 2;
  const s = plan.side;
  const color = linearOf(mixBytes(TONES.grassDry, TONES.oakEarly, 0.35));
  // through the hole from the back, out the front, then a hanging U with a tail and a knot
  const pts = [
    [hx, hy + 0.003, -z - 0.012],
    [hx, hy, 0],
    [hx + s * 0.002, hy - 0.004, z + 0.012],
    [hx + s * 0.012, hy - 0.05, z + 0.026],
    [hx + s * 0.004, hy - 0.115, z + 0.034],
    [hx - s * 0.018, hy - 0.15, z + 0.03],
    [hx - s * 0.036, hy - 0.115, z + 0.026],
    [hx - s * 0.026, hy - 0.05, z + 0.022],
    [hx - s * 0.004, hy - 0.012, z + 0.014],
  ].map((p) => [p[0], p[1], p[2]]);
  b.tube(pts, 0.0062, 4, { group: 1, color, vPerM: 40, uRep: 1, capStart: true, capEnd: true });
  // a loose tail
  b.tube(
    [
      [hx - s * 0.004, hy - 0.012, z + 0.014],
      [hx - s * 0.01, hy - 0.04, z + 0.03],
      [hx - s * 0.002, hy - 0.075, z + 0.04],
    ],
    [0.0055, 0.0055, 0.004],
    4,
    { group: 1, color, capEnd: true },
  );
}

// ------------------------------------------------------------------------------------------------
// One sign, local frame
// ------------------------------------------------------------------------------------------------
export function buildSignGeometry(plan) {
  const b = createBuilder();
  const rng = createRng(plan.seed * 31 + 7);
  const noise = createNoise(plan.seed * 3 + 1);
  const post = buildPost(b, plan, rng, noise);
  const { ropeAt } = buildBoard(b, plan, rng, noise);
  // draw bored pegs: two heads on the post's front face, one above and one below the arm's centre
  const peg = linearOf(mixBytes(TONES.oakEarly, TONES.silver, 0.35));
  const yc = plan.board.yb0 + plan.board.h / 2;
  const zFront = POST_A + post.bowZ;
  const dx = (rng() - 0.5) * 0.012;
  addPeg(b, -0.027 + dx + post.bowX, yc + plan.board.h * 0.28, zFront, rng, peg);
  addPeg(b, 0.027 + dx + post.bowX, yc - plan.board.h * 0.3, zFront, rng, peg);
  if (ropeAt) addRopeLoop(b, ropeAt, plan);
  if (plan.look.stub) {
    // the stump of an older arm, sawn off long ago: a weathered block that came through the same way
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (plan.side > 0 ? -1 : 1) * 0.1);
    const len = 0.17;
    b.box([plan.side * (POST_A + len / 2 - 0.004), plan.board.yb0 - 0.3, 0.001], [len, 0.075, 0.046], {
      group: 1,
      quat: q,
      color: [0.9, 0.88, 0.84],
      tile: 0.5,
      uvOffset: [0.2, 0.1],
    });
  }
  return b.toGeometry();
}

// ------------------------------------------------------------------------------------------------
// Ground clutter in WORLD space: soil mound, stones, moss, grass tufts for all four signs
// ------------------------------------------------------------------------------------------------
// Returns { soil, stones, moss, grass } geometries (any may be empty). soil uses the hero ground texture
// (uv = world xz), moss the moss texture, stones their own sheet (uv round the stone), grass the card.
export function buildSignClutter(frames, plans) {
  const soil = createBuilder();
  const stones = createBuilder();
  const moss = createBuilder();
  const grassList = []; // one mesh per sign, so each tuft group has its own origin and sways on its own phase
  const dark = linearOf(TONES.soil);
  const wet = linearOf(TONES.soilWet);
  const litter = linearOf(TONES.litter);
  const stoneTint = linearOf(TONES.stone);
  const stoneWarm = linearOf(TONES.stoneWarm);
  const mossCol = linearOf(TONES.moss);

  frames.forEach((f, idx) => {
    const plan = plans[idx];
    const rng = createRng(plan.seed * 17 + 3);
    const noise = createNoise(plan.seed * 5 + 11);
    const grass = createBuilder();
    grassList.push(grass);
    const gy = (x, z) => rideHeight(x, z);

    // ---- soil mound packed round the foot: three rings, lumpy, with litter in it ----------------------------------------
    const N = 9;
    const radii = [0.44, 0.27, 0.1];
    const lifts = [-0.03, 0.05, 0.075];
    const phase = rng() * TAU;
    const rings = radii.map((r0, k) => {
      const ring = [];
      for (let j = 0; j < N; j++) {
        const th = phase + (j / N) * TAU;
        // squashed along the path, the way a post gets packed with earth from one side
        const lump = 1 + 0.28 * noise.perlin2(Math.cos(th) * 1.4 + idx * 4, Math.sin(th) * 1.4 + k * 3);
        const r = r0 * lump * (k === 0 ? 1 : 0.95 + 0.1 * rng());
        const x = f.x + Math.cos(th) * r;
        const z = f.z + Math.sin(th) * r;
        // the inner rings follow the lean of the post a few cm; negligible, so just the ground height
        ring.push([x, gy(x, z) + lifts[k] * (0.7 + 0.5 * noise.perlin2(x * 3, z * 3 + 5)), z]);
      }
      return ring;
    });
    // rings run from the outer skirt in to the post, so (in x around) points UP and the mound faces the sky
    soil.loft(rings, {
      group: 0,
      uv: (i, j) => {
        const p = rings[i][j % N];
        return [p[0] * 0.5, p[2] * 0.5];
      },
      // the ground texture is already dark litter: the vertex colour only shades it (wet skirt, drier, warmer crown)
      color: (i, j) => {
        const lit = 0.8 + 0.4 * hash1(idx * 100 + i * 10 + j, 3);
        const m = i === 0 ? wet : i === 1 ? dark : litter;
        const k = i === 0 ? 0.95 : 1.12; // the wet skirt a touch darker than the packed, drier crown
        return [lit * k * (1 + (m[0] - dark[0]) * 4), lit * k * (1 + (m[1] - dark[1]) * 4), lit * k * (1 + (m[2] - dark[2]) * 4)];
      },
    });

    // ---- stones: half buried, lumpy, 21 triangles each ------------------------------------------------------------------
    const nStone = 3;
    for (let k = 0; k < nStone; k++) {
      const th = phase + 0.9 + k * 2.1 + (rng() - 0.5) * 0.6;
      const dist = 0.17 + rng() * 0.2;
      const sx = f.x + Math.cos(th) * dist;
      const sz = f.z + Math.sin(th) * dist;
      const big = k === 0;
      const rx = big ? range(rng, 0.11, 0.15) : range(rng, 0.05, 0.085);
      const ry = rx * range(rng, 0.45, 0.7);
      const rz = rx * range(rng, 0.7, 1.0);
      const sy = gy(sx, sz) - ry * 0.35; // set into the soil: a third of its height is below ground
      const seed = rng() * 100;
      const tone = hash1(idx * 10 + k, 8);
      // the stone texture carries the colour: the vertex tint only nudges it warmer or cooler, stone to stone
      const base = [
        0.9 + 0.2 * tone + (stoneWarm[0] - stoneTint[0]) * 0.4 * tone,
        0.9 + 0.12 * tone,
        0.92 - 0.1 * tone + (stoneWarm[2] - stoneTint[2]) * 0.3 * tone,
      ];
      stones.blob(
        [sx, sy, sz],
        [rx, ry, rz],
        2,
        7,
        (dx, dy, dz) => 1 + 0.2 * noise.perlin2(dx * 2.2 + seed, dz * 2.2 + dy),
        {
          phiEnd: Math.PI / 2,
          color: base,
          uv: (i, j) => [j / 7, (i / 2) * 0.5],
        },
      );
    }

    // ---- moss cushion hugging the foot of the post on its shaded side, and one on the big stone ------------------------------
    {
      const th = phase + 3.4;
      const mx = f.x + Math.cos(th) * 0.1;
      const mz = f.z + Math.sin(th) * 0.1;
      moss.blob([mx, gy(mx, mz) + 0.03, mz], [0.13, 0.06, 0.12], 2, 7, (dx, dy, dz) => 1 + 0.25 * noise.perlin2(dx * 3 + 7, dz * 3), {
        phiEnd: Math.PI / 2,
        color: [0.85 + mossCol[0], 0.9 + mossCol[1], 0.85 + mossCol[2]],
        uv: (i, j) => [Math.cos((j / 7) * TAU) * 0.5 * (i / 2 + 0.3) + mx * 1.5, Math.sin((j / 7) * TAU) * 0.5 * (i / 2 + 0.3) + mz * 1.5],
      });
    }

    // ---- tufts of grass: crossed cards (4 triangles) pushed up beside the stones and the mound ---------------------------------
    const nTuft = 4;
    for (let k = 0; k < nTuft; k++) {
      const th = phase + 0.4 + k * 1.7 + (rng() - 0.5) * 0.9;
      const dist = 0.24 + rng() * 0.22;
      const wx = f.x + Math.cos(th) * dist;
      const wz = f.z + Math.sin(th) * dist;
      const ty = gy(wx, wz) - 0.01; // world height; x and z are relative to the sign's foot (the mesh sits there)
      const tx = wx - f.x;
      const tz = wz - f.z;
      const size = range(rng, 0.2, 0.34);
      const tone = 0.8 + 0.4 * rng();
      const rot = rng() * Math.PI;
      for (let c = 0; c < 2; c++) {
        const a = rot + c * (Math.PI / 2 + (rng() - 0.5) * 0.4);
        const hx = Math.cos(a) * size * 0.5;
        const hz = Math.sin(a) * size * 0.5;
        // a card leaning outward a touch (the tuft fans)
        const lean = 0.12;
        const nrm = [-Math.sin(a), 0.0, Math.cos(a)];
        const v = [
          grass.vert([tx - hx, ty, tz - hz], nrm, 0, 0, [tone, tone, tone]),
          grass.vert([tx + hx, ty, tz + hz], nrm, 1, 0, [tone, tone, tone]),
          grass.vert([tx + hx * (1 + lean) * 0.9, ty + size, tz + hz * (1 + lean) * 0.9], nrm, 1, 1, [tone, tone, tone]),
          grass.vert([tx - hx * (1 + lean) * 0.9, ty + size, tz - hz * (1 + lean) * 0.9], nrm, 0, 1, [tone, tone, tone]),
        ];
        grass.tri(v[0], v[1], v[2], 0);
        grass.tri(v[0], v[2], v[3], 0);
      }
    }
  });
  return {
    soil: soil.toGeometry(),
    stones: stones.toGeometry(),
    moss: moss.toGeometry(),
    grass: grassList.map((g) => g.toGeometry()),
    counts: { soil: soil.triangles, stones: stones.triangles, moss: moss.triangles, grass: grassList.reduce((n, g) => n + g.triangles, 0) },
  };
}

export const SIGN_LIST = SIGNS;
