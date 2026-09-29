// Signed distance functions for every squishy type.
// Shapes live in "unit space": roughly fitting in [-1.2, 1.2]^3, face pointing +Z, up is +Y.
// Negative = inside, positive = outside.

export type SDF = (x: number, y: number, z: number) => number;

export type SquishyType =
  | "mochi"
  | "cat"
  | "bear"
  | "bunny"
  | "frog"
  | "heart"
  | "star"
  | "donut"
  | "peach"
  | "cloud"
  | "toast"
  | "chick"
  | "butter";

export interface ShapeParams {
  type: SquishyType;
  /** non-uniform stretch in unit space */
  stretchX: number;
  stretchY: number;
  stretchZ: number;
  /** thickness for pillow-like (2D inflated) shapes */
  puff: number;
}

// ---------- primitives ----------

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

export function smin(a: number, b: number, k: number) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

function sdSphere(x: number, y: number, z: number, r: number) {
  return len3(x, y, z) - r;
}

// iq's ellipsoid bound (good enough for meshing)
function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  if (k1 === 0) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

function sdRoundBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

function sdTorus(x: number, y: number, z: number, R: number, r: number, flatten: number) {
  const q = len2(x, z) - R;
  return len2(q, y / flatten) * Math.min(1, flatten) - r;
}

function sdRoundCone(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r1: number, r2: number,
) {
  // capsule with varying radius along segment a->b
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const t = clamp((pax * bax + pay * bay + paz * baz) / baba, 0, 1);
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return len3(dx, dy, dz) - (r1 + (r2 - r1) * t);
}

// ---------- 2D shapes (for inflated "pillow" squishies) ----------

function sdHeart2D(x: number, y: number) {
  // iq heart, remapped so it's centred and ~unit sized
  x = Math.abs(x);
  y = y + 0.55;
  if (x + y > 1) {
    return len2(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  }
  const a = len2(x, y - 1);
  const m = 0.5 * Math.max(x + y, 0);
  const b = len2(x - m, y - m);
  return Math.min(a, b) * Math.sign(x - y);
}

function sdStar2D(x: number, y: number, r: number, rf: number) {
  // iq sdStar5
  const k1x = 0.809016994375, k1y = -0.587785252292;
  const k2x = -k1x, k2y = k1y;
  x = Math.abs(x);
  let d = 2 * Math.max(k1x * x + k1y * y, 0);
  x -= d * k1x; y -= d * k1y;
  d = 2 * Math.max(k2x * x + k2y * y, 0);
  x -= d * k2x; y -= d * k2y;
  x = Math.abs(x);
  y -= r;
  const bax = -rf * k1y, bay = rf * k1x - 1; // (rf*(-k1.y, k1.x) - (0,1))
  const ba_x = bax, ba_y = bay;
  const h = clamp((x * ba_x + y * ba_y) / (ba_x * ba_x + ba_y * ba_y), 0, r);
  return len2(x - ba_x * h, y - ba_y * h) * Math.sign(y * ba_x - x * ba_y);
}

function sdToast2D(x: number, y: number) {
  // bread slice: rounded rect with a wide rounded top
  const body = (() => {
    const qx = Math.abs(x) - 0.78, qy = Math.abs(y + 0.18) - 0.62;
    return len2(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.08;
  })();
  const topL = len2(x + 0.5, y - 0.45) - 0.48;
  const topR = len2(x - 0.5, y - 0.45) - 0.48;
  return smin(smin(body, topL, 0.12), topR, 0.12);
}

/** Inflate a 2D SDF into a puffy pillow. */
function inflate(d2: number, z: number, thickness: number, depth = 0.45) {
  // thickness grows like sqrt of interior distance -> round rim, flatter centre
  const inner = Math.max(-d2, 0);
  const h = thickness * Math.sqrt(Math.min(inner, depth) / depth) + 0.001;
  const rim = 0.08;
  const wx = d2 + rim;
  const wz = Math.abs(z) - h;
  return Math.min(Math.max(wx, wz), 0) + len2(Math.max(wx, 0), Math.max(wz, 0)) - rim;
}

// ---------- squishy shapes ----------

type RawShape = (x: number, y: number, z: number, p: ShapeParams) => number;

const shapes: Record<SquishyType, RawShape> = {
  mochi: (x, y, z) => {
    const body = sdEllipsoid(x, y + 0.1, z, 1.0, 0.72, 1.0);
    return smax(body, -(y + 0.62), 0.18);
  },

  cat: (x, y, z) => {
    const head = sdEllipsoid(x, y + 0.08, z, 1.0, 0.8, 0.78);
    const earL = sdRoundCone(x, y, z, -0.52, 0.45, 0, -0.72, 0.98, 0, 0.26, 0.05);
    const earR = sdRoundCone(x, y, z, 0.52, 0.45, 0, 0.72, 0.98, 0, 0.26, 0.05);
    let d = smin(head, earL, 0.12);
    d = smin(d, earR, 0.12);
    return smax(d, -(y + 0.8), 0.12);
  },

  bear: (x, y, z) => {
    const head = sdEllipsoid(x, y + 0.05, z, 0.98, 0.85, 0.8);
    const earL = sdSphere(x + 0.66, y - 0.66, z, 0.3);
    const earR = sdSphere(x - 0.66, y - 0.66, z, 0.3);
    const snout = sdEllipsoid(x, y + 0.25, z - 0.6, 0.35, 0.25, 0.25);
    let d = smin(head, earL, 0.14);
    d = smin(d, earR, 0.14);
    d = smin(d, snout, 0.2);
    return smax(d, -(y + 0.82), 0.12);
  },

  bunny: (x, y, z) => {
    const head = sdEllipsoid(x, y + 0.35, z, 0.9, 0.7, 0.72);
    const earL = sdRoundCone(x, y, z, -0.32, 0.1, 0, -0.42, 1.05, 0, 0.2, 0.17);
    const earR = sdRoundCone(x, y, z, 0.32, 0.1, 0, 0.42, 1.05, 0, 0.2, 0.17);
    let d = smin(head, earL, 0.15);
    d = smin(d, earR, 0.15);
    // flatten ears a bit in z
    return smax(d, -(y + 0.95), 0.12);
  },

  frog: (x, y, z) => {
    const body = sdEllipsoid(x, y + 0.15, z, 1.05, 0.68, 0.85);
    const eyeL = sdSphere(x + 0.45, y - 0.45, z - 0.15, 0.3);
    const eyeR = sdSphere(x - 0.45, y - 0.45, z - 0.15, 0.3);
    let d = smin(body, eyeL, 0.15);
    d = smin(d, eyeR, 0.15);
    return smax(d, -(y + 0.72), 0.14);
  },

  heart: (x, y, z, p) => inflate(sdHeart2D(x * 0.6, y * 0.6) / 0.6, z, 0.5 * p.puff, 0.6),

  star: (x, y, z, p) => {
    const d2 = sdStar2D(x, y + 0.08, 1.05, 0.5) - 0.1;
    return inflate(d2, z, 0.45 * p.puff, 0.4);
  },

  donut: (x, y, z) => sdTorus(x, y, z, 0.66, 0.36, 0.95),

  peach: (x, y, z) => {
    // tip at the top, cleft on the front
    const ty = y > 0 ? y * (1 + 0.25 * Math.max(0, 1 - len2(x, z) * 2)) : y;
    let d = sdEllipsoid(x, ty + 0.02, z, 0.95, 0.92, 0.9);
    const cleft = 0.07 * Math.exp(-(x * x) / 0.012) * clamp((z + 0.1) * 2, 0, 1);
    d += cleft;
    return smax(d, -(y + 0.82), 0.14);
  },

  cloud: (x, y, z) => {
    const zf = 0.62;
    let d = sdEllipsoid(x, y + 0.15, z, 0.95, 0.45, zf);
    d = smin(d, sdEllipsoid(x + 0.45, y - 0.12, z, 0.45, 0.42, zf * 0.95), 0.2);
    d = smin(d, sdEllipsoid(x - 0.1, y - 0.32, z, 0.5, 0.48, zf), 0.2);
    d = smin(d, sdEllipsoid(x - 0.6, y - 0.05, z, 0.38, 0.36, zf * 0.9), 0.2);
    return d;
  },

  toast: (x, y, z, p) => {
    const d2 = sdToast2D(x, y);
    const slab = Math.abs(z) - 0.3 * p.puff;
    const r = 0.14;
    return Math.min(Math.max(d2 + r, slab + r), 0) + len2(Math.max(d2 + r, 0), Math.max(slab + r, 0)) - r;
  },

  butter: (x, y, z) => {
    // a soft pat of butter: rounded block with a slightly domed, "melting" top
    const dome = 0.06 * Math.max(0, 1 - (x * x) / 0.9 - (z * z) / 0.4);
    const d = sdRoundBox(x, y + 0.12 - dome, z, 1.0, 0.48, 0.62, 0.22);
    return smax(d, -(y + 0.6), 0.1);
  },

  chick: (x, y, z) => {
    const body = sdEllipsoid(x, y + 0.08, z, 0.82, 0.95, 0.8);
    const tuftA = sdRoundCone(x, y, z, 0, 0.72, 0, -0.08, 1.05, 0, 0.12, 0.04);
    const tuftB = sdRoundCone(x, y, z, 0, 0.72, 0, 0.14, 1.0, 0, 0.1, 0.035);
    const wingL = sdEllipsoid(x + 0.8, y + 0.1, z, 0.12, 0.3, 0.35);
    const wingR = sdEllipsoid(x - 0.8, y + 0.1, z, 0.12, 0.3, 0.35);
    let d = smin(body, tuftA, 0.08);
    d = smin(d, tuftB, 0.08);
    d = smin(d, wingL, 0.1);
    d = smin(d, wingR, 0.1);
    return smax(d, -(y + 0.85), 0.14);
  },
};

export function buildSDF(p: ShapeParams): SDF {
  const raw = shapes[p.type];
  const sx = p.stretchX, sy = p.stretchY, sz = p.stretchZ;
  const m = Math.min(sx, sy, sz);
  return (x, y, z) => raw(x / sx, y / sy, z / sz, p) * m;
}

export const SHAPE_BOUNDS = 1.35; // half-extent of unit-space sampling box (before stretch)
