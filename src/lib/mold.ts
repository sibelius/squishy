// Mold generation. Everything here is in millimetres.
// The mold is described as an SDF (box minus squishy cavity minus pour/vent channels,
// split at a parting plane, with registration keys) and meshed with surface nets.

import { buildSDF, SHAPE_BOUNDS, type SDF, type ShapeParams } from "./sdf";
import { meshSDF, type Box, type Mesh } from "./mesher";

export type MoldStyle = "two-part" | "open";
export type PartingAxis = "front-back" | "top-bottom";

export interface MoldParams {
  style: MoldStyle;
  parting: PartingAxis;
  /** squishy width in mm (unit space 2 == sizeMm) */
  sizeMm: number;
  wall: number;
  sprueDiameter: number;
  vent: boolean;
  keys: boolean;
  keyRadius: number;
  clearance: number;
  /** voxel size in mm */
  resolution: number;
}

export const DEFAULT_MOLD: MoldParams = {
  style: "two-part",
  parting: "front-back",
  sizeMm: 60,
  wall: 6,
  sprueDiameter: 8,
  vent: true,
  keys: true,
  keyRadius: 3.5,
  clearance: 0.3,
  resolution: 0.7,
};

export interface MoldPart {
  name: string;
  /** mesh in print orientation (Z up, sitting on z=0) */
  print: Mesh;
  /** mesh in squishy orientation (Y up, mm) for the 3D preview */
  preview: Mesh;
}

export interface MoldResult {
  parts: MoldPart[];
  master: Mesh; // the squishy itself, print orientation
  box: Box;
  /** 1 = y (top/bottom), 2 = z (front/back) */
  axis: number;
  plane: number;
}

const sdBox = (x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) => {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
};

/** squishy SDF in mm */
export function squishyMm(shape: ShapeParams, sizeMm: number): SDF {
  const f = buildSDF(shape);
  const s = sizeMm / 2;
  return (x, y, z) => f(x / s, y / s, z / s) * s;
}

/** Tight bounds of the squishy in mm, found by sampling. */
export function shapeBounds(f: SDF, shape: ShapeParams, sizeMm: number): Box {
  const s = sizeMm / 2;
  const B = [SHAPE_BOUNDS * shape.stretchX * s, SHAPE_BOUNDS * shape.stretchY * s, SHAPE_BOUNDS * shape.stretchZ * s];
  const N = 48;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k <= N; k++)
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const x = -B[0] + (2 * B[0] * i) / N, y = -B[1] + (2 * B[1] * j) / N, z = -B[2] + (2 * B[2] * k) / N;
        if (f(x, y, z) < 0) {
          if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
          if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
        }
      }
  const pad = (2 * Math.max(...B)) / N;
  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

export function generateMold(shape: ShapeParams, mp: MoldParams, onProgress?: (t: number, label: string) => void): MoldResult {
  const S = squishyMm(shape, mp.sizeMm);
  const sb = shapeBounds(S, shape, mp.sizeMm);
  const w = mp.wall;
  const open = mp.style === "open";
  // parting axis index: 2 = z (front/back), 1 = y (top/bottom). Open molds always split on y.
  const axis = open || mp.parting === "top-bottom" ? 1 : 2;

  // parting plane: through the widest section. For y-split of an open mold use the top of the shape.
  let plane: number;
  if (open) plane = sb.max[1] - 0.001;
  // front/back: shapes are ~symmetric in depth, split in the middle. top/bottom: widest section.
  else plane = axis === 2 ? (sb.min[2] + sb.max[2]) / 2 : widestY(S, sb);

  const bmin: [number, number, number] = [sb.min[0] - w, sb.min[1] - w, sb.min[2] - w];
  const bmax: [number, number, number] = [sb.max[0] + w, sb.max[1] + w, sb.max[2] + w];
  if (open) bmax[1] = plane; // open top
  const c = [0, 1, 2].map((i) => (bmin[i] + bmax[i]) / 2);
  const hx = (bmax[0] - bmin[0]) / 2, hy = (bmax[1] - bmin[1]) / 2, hz = (bmax[2] - bmin[2]) / 2;
  const corner = Math.min(2, w * 0.4);

  // pour channel runs along +Y from the top of the cavity out through the top of the block.
  const sprueR = mp.sprueDiameter / 2;
  const sprueZ = axis === 2 ? plane : cavityCenterZ(S, sb);
  // pick the x along the parting line where the cavity reaches highest (pour from the top)
  const tops: { x: number; y: number }[] = [];
  for (let x = sb.min[0]; x <= sb.max[0]; x += 0.5) tops.push({ x, y: ventTopY(S, x, sprueZ, sb) });
  const inCavity = tops.filter((t) => t.y > -Infinity);
  const byHeight = [...inCavity].sort((a, b) => Math.round(b.y) - Math.round(a.y) || Math.abs(a.x) - Math.abs(b.x));
  const sprue = byHeight[0] ?? { x: 0, y: sb.max[1] };
  const ventR = Math.max(1, sprueR * 0.35);
  const vent =
    byHeight.find((t) => Math.abs(t.x - sprue.x) > sprueR + ventR + 4 && t.y > sprue.y - (sb.max[1] - sb.min[1]) * 0.35) ??
    null;
  const channel = (x: number, y: number, z: number) => {
    if (open) return Infinity;
    const r = Math.hypot(x - sprue.x, z - sprueZ) - sprueR;
    let d = Math.max(r, sprue.y - sprueR * 1.5 - y);
    if (mp.vent && vent) {
      const vr = Math.hypot(x - vent.x, z - sprueZ) - ventR;
      d = Math.min(d, Math.max(vr, vent.y - ventR * 2 - y));
    }
    return d;
  };

  const block = (x: number, y: number, z: number) => sdBox(x - c[0], y - c[1], z - c[2], hx, hy, hz, corner);
  const solid: SDF = (x, y, z) => Math.max(block(x, y, z), -S(x, y, z), -channel(x, y, z));

  // registration keys at 4 corners of the parting face
  const keyR = mp.keyRadius;
  const keys: [number, number, number][] = [];
  if (mp.keys && !open) {
    const inset = Math.max(keyR + 1, w * 0.5);
    const [u, v] = axis === 2 ? [0, 1] : [0, 2];
    for (const su of [-1, 1])
      for (const sv of [-1, 1]) {
        const k: [number, number, number] = [0, 0, 0];
        k[u] = su > 0 ? bmax[u] - inset : bmin[u] + inset;
        k[v] = sv > 0 ? bmax[v] - inset : bmin[v] + inset;
        k[axis] = plane;
        // skip keys that would hit the cavity or the channels
        if (S(k[0], k[1], k[2]) > keyR + 1.5 && channel(k[0], k[1], k[2]) > keyR + 1.5) keys.push(k);
      }
  }
  const keyDist = (x: number, y: number, z: number, extra: number) => {
    let d = Infinity;
    for (const k of keys) d = Math.min(d, Math.hypot(x - k[0], y - k[1], z - k[2]) - keyR - extra);
    return d;
  };
  const coord = (x: number, y: number, z: number) => (axis === 2 ? z : y);

  // half A: coord < plane, with male keys; half B: coord > plane, with female sockets
  const halfA: SDF = (x, y, z) => {
    const cut = Math.max(solid(x, y, z), coord(x, y, z) - plane);
    if (!keys.length) return cut;
    const bump = Math.max(keyDist(x, y, z, 0), plane - coord(x, y, z) - 0.01);
    return Math.min(cut, bump);
  };
  const halfB: SDF = (x, y, z) => {
    const cut = Math.max(solid(x, y, z), plane - coord(x, y, z));
    if (!keys.length) return cut;
    return Math.max(cut, -keyDist(x, y, z, mp.clearance));
  };

  const res = mp.resolution;
  const parts: MoldPart[] = [];
  const boxA: Box = { min: [...bmin], max: [...bmax] };
  const boxB: Box = { min: [...bmin], max: [...bmax] };
  if (!open) {
    boxA.max[axis] = plane + keyR + 0.5;
    boxB.min[axis] = plane - 0.5;
  }

  const total = open ? 2 : 3;
  let step = 0;
  const prog = (label: string) => (t: number) => onProgress?.((step + t) / total, label);

  const meshA = meshSDF(open ? solid : halfA, boxA, res, { onProgress: prog(open ? "Mold" : "Mold half A") });
  step++;
  parts.push({
    name: open ? "mold" : "mold-A",
    preview: meshA,
    print: orientForPrint(meshA, axis, +1),
  });
  if (!open) {
    const meshB = meshSDF(halfB, boxB, res, { onProgress: prog("Mold half B") });
    step++;
    parts.push({ name: "mold-B", preview: meshB, print: orientForPrint(meshB, axis, -1) });
  }

  const masterMesh = meshSDF(S, sb, Math.min(res, 0.6), { onProgress: prog("Master") });
  const master = orientForPrint(masterMesh, 1, -1, true);

  // lay parts out side by side on the bed
  let xOff = 0;
  for (const p of parts) {
    const b = bounds(p.print.positions);
    translate(p.print.positions, xOff - b.min[0], -(b.min[1] + b.max[1]) / 2, 0);
    xOff += b.max[0] - b.min[0] + 8;
  }

  return { parts, master, box: { min: bmin, max: bmax }, axis, plane };
}

/** find the height where the horizontal cross-section is largest -> best top/bottom parting plane */
function widestY(S: SDF, b: Box) {
  return widest(S, b, 1);
}
function widest(S: SDF, b: Box, axis: number) {
  const N = 40, M = 30;
  let best = 0, bestArea = -1;
  const [u, v] = axis === 2 ? [0, 1] : [0, 2];
  for (let s = 1; s < N; s++) {
    const t = b.min[axis] + ((b.max[axis] - b.min[axis]) * s) / N;
    let area = 0;
    for (let i = 0; i < M; i++)
      for (let j = 0; j < M; j++) {
        const p = [0, 0, 0];
        p[axis] = t;
        p[u] = b.min[u] + ((b.max[u] - b.min[u]) * (i + 0.5)) / M;
        p[v] = b.min[v] + ((b.max[v] - b.min[v]) * (j + 0.5)) / M;
        if (S(p[0], p[1], p[2]) < 0) area++;
      }
    // prefer planes near the middle when tied
    const mid = (b.min[axis] + b.max[axis]) / 2;
    const score = area - Math.abs(t - mid) * 0.01;
    if (score > bestArea) {
      bestArea = score;
      best = t;
    }
  }
  return best;
}

/** highest point of the cavity along a vertical line (for placing sprue / vent) */
function ventTopY(S: SDF, x: number, z: number, b: Box) {
  for (let y = b.max[1]; y > b.min[1]; y -= 0.5) if (S(x, y, z) < 0) return y;
  return -Infinity;
}

function cavityCenterZ(S: SDF, b: Box) {
  // for top/bottom split, pour through the thickest front/back position at the top
  let best = 0, bestY = -Infinity;
  for (let z = b.min[2]; z <= b.max[2]; z += 0.5) {
    const y = ventTopY(S, 0, z, b);
    if (y > bestY + 0.25 || (Math.abs(y - bestY) <= 0.25 && Math.abs(z) < Math.abs(best))) {
      bestY = y;
      best = z;
    }
  }
  return best;
}

/**
 * Rotate a mesh so the parting face is on top (cavity opens upwards: no supports needed)
 * and convert to Z-up for slicers. `side` +1 means the part lies on the negative side of the plane.
 */
function orientForPrint(m: Mesh, axis: number, side: 1 | -1, keepY = false): Mesh {
  const src = m.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    let X: number, Y: number, Z: number;
    if (keepY) {
      // Y-up -> Z-up (face towards -Y on the bed)
      X = x; Y = -z; Z = y;
    } else if (axis === 2) {
      // parting normal is +z. half A (z<plane) keeps +z up; half B flips.
      if (side > 0) { X = x; Y = y; Z = z; }
      else { X = -x; Y = y; Z = -z; }
    } else {
      // parting normal is +y
      if (side > 0) { X = x; Y = -z; Z = y; }
      else { X = x; Y = z; Z = -y; }
    }
    out[i] = X; out[i + 1] = Y; out[i + 2] = Z;
  }
  // rotations above are proper (det +1) so winding stays valid
  const b = bounds(out);
  translate(out, -(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
  return { positions: out, indices: m.indices };
}

export function bounds(p: Float32Array): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let c = 0; c < 3; c++) {
      if (p[i + c] < min[c]) min[c] = p[i + c];
      if (p[i + c] > max[c]) max[c] = p[i + c];
    }
  return { min, max };
}

function translate(p: Float32Array, x: number, y: number, z: number) {
  for (let i = 0; i < p.length; i += 3) {
    p[i] += x; p[i + 1] += y; p[i + 2] += z;
  }
}
