// A small position-based-dynamics soft body engine tuned for squishies.
//
// Constraints per step:
//  - rest-shape attraction ("memory foam" slow rise)
//  - edge length constraints (local elasticity / skin tension)
//  - global volume preservation (poke here -> bulge there)
//  - finger (sphere) colliders, squeeze plates and a ground plane

export interface MaterialParams {
  /** how fast it returns to the rest shape, per second (0..1-ish) */
  rise: number;
  /** edge stiffness 0..1 */
  stiffness: number;
  /** volume preservation 0..1 */
  volume: number;
  /** velocity damping per second (0 = none, 1 = heavy) */
  damping: number;
}

export const MATERIALS: Record<string, MaterialParams & { label: string; hint: string }> = {
  slowRise: { label: "Slow-rise foam", hint: "classic PU squishy", rise: 0.9, stiffness: 0.35, volume: 0.15, damping: 0.995 },
  paper: { label: "Paper + stuffing", hint: "crinkly, doesn't stretch", rise: 2.2, stiffness: 0.85, volume: 0.35, damping: 0.9 },
  butter: { label: "Butter", hint: "silky, melty, slow", rise: 1.6, stiffness: 0.18, volume: 0.55, damping: 0.97 },
  mochi: { label: "Mochi (TPR)", hint: "soft, stretchy", rise: 3.5, stiffness: 0.25, volume: 0.6, damping: 0.93 },
  jelly: { label: "Jelly", hint: "bouncy & wobbly", rise: 10, stiffness: 0.5, volume: 0.9, damping: 0.25 },
  stress: { label: "Stress ball", hint: "firm, quick return", rise: 14, stiffness: 0.8, volume: 0.7, damping: 0.7 },
};

export interface Finger {
  id: number;
  /** sphere center in body space */
  cx: number; cy: number; cz: number;
  r: number;
  active: boolean;
}

export interface Grab {
  id: number;
  verts: Uint32Array;
  weights: Float32Array;
  origin: Float32Array; // original positions of grabbed verts
  dx: number; dy: number; dz: number;
}

export class SoftBody {
  readonly n: number;
  readonly pos: Float32Array;
  readonly rest: Float32Array;
  readonly vel: Float32Array;
  readonly indices: Uint32Array;
  private prev: Float32Array;
  private edgeA: Uint32Array;
  private edgeB: Uint32Array;
  private edgeLen: Float32Array;
  private invMassish: Float32Array;
  private grad: Float32Array;
  readonly restVolume: number;
  readonly groundY: number;

  material: MaterialParams = MATERIALS.slowRise;
  fingers = new Map<number, Finger>();
  grabs = new Map<number, Grab>();
  /** squeeze plates: top plate y, bottom plate y (Infinity / -Infinity when off) */
  plateTop = Infinity;
  plateBottom = -Infinity;
  iterations = 4;

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.n = positions.length / 3;
    this.pos = positions.slice();
    this.rest = positions.slice();
    this.prev = positions.slice();
    this.vel = new Float32Array(positions.length);
    this.indices = indices;
    this.grad = new Float32Array(positions.length);
    this.invMassish = new Float32Array(this.n).fill(1);

    const seen = new Set<number>();
    const ea: number[] = [], eb: number[] = [];
    for (let t = 0; t < indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        let a = indices[t + e], b = indices[t + ((e + 1) % 3)];
        if (a > b) [a, b] = [b, a];
        const key = a * this.n + b;
        if (seen.has(key)) continue;
        seen.add(key);
        ea.push(a); eb.push(b);
      }
    }
    this.edgeA = new Uint32Array(ea);
    this.edgeB = new Uint32Array(eb);
    this.edgeLen = new Float32Array(ea.length);
    for (let e = 0; e < ea.length; e++) {
      const a = ea[e] * 3, b = eb[e] * 3;
      const dx = positions[a] - positions[b], dy = positions[a + 1] - positions[b + 1], dz = positions[a + 2] - positions[b + 2];
      this.edgeLen[e] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.restVolume = this.volume();
    let minY = Infinity;
    for (let i = 1; i < positions.length; i += 3) minY = Math.min(minY, positions[i]);
    this.groundY = minY;
  }

  volume(p = this.pos) {
    const I = this.indices;
    let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      v +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return v / 6;
  }

  step(dt: number) {
    const sub = 2;
    const h = Math.min(dt, 1 / 30) / sub;
    for (let s = 0; s < sub; s++) this.substep(h);
  }

  private substep(h: number) {
    const { pos, prev, vel, rest, n, material: m } = this;
    const damp = Math.pow(1 - Math.min(m.damping, 0.999), h * 10); // per-substep velocity retention

    // integrate
    for (let i = 0; i < n * 3; i++) {
      prev[i] = pos[i];
      vel[i] *= damp;
      pos[i] += vel[i] * h;
    }

    // rest-shape memory (critically soft spring toward rest)
    const k = 1 - Math.exp(-m.rise * h);
    for (let i = 0; i < n * 3; i++) pos[i] += (rest[i] - pos[i]) * k;

    for (let it = 0; it < this.iterations; it++) {
      this.solveEdges(m.stiffness);
      if (m.volume > 0) this.solveVolume(m.volume);
      this.solveGrabs();
      this.solveColliders();
    }

    const inv = 1 / h;
    for (let i = 0; i < n * 3; i++) vel[i] = (pos[i] - prev[i]) * inv;
  }

  private solveEdges(stiff: number) {
    const { pos, edgeA, edgeB, edgeLen } = this;
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e] * 3, b = edgeB[e] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-9) continue;
      const c = ((l - edgeLen[e]) / l) * 0.5 * stiff;
      pos[a] += dx * c; pos[a + 1] += dy * c; pos[a + 2] += dz * c;
      pos[b] -= dx * c; pos[b + 1] -= dy * c; pos[b + 2] -= dz * c;
    }
  }

  private solveVolume(stiff: number) {
    const { pos: p, indices: I, grad } = this;
    grad.fill(0);
    let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      // grad of signed tet volume wrt each vertex = cross of the other two / 6
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const cx = p[c], cy = p[c + 1], cz = p[c + 2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      grad[a] += by * cz - bz * cy; grad[a + 1] += bz * cx - bx * cz; grad[a + 2] += bx * cy - by * cx;
      grad[b] += cy * az - cz * ay; grad[b + 1] += cz * ax - cx * az; grad[b + 2] += cx * ay - cy * ax;
      grad[c] += ay * bz - az * by; grad[c + 1] += az * bx - ax * bz; grad[c + 2] += ax * by - ay * bx;
    }
    v /= 6;
    let g2 = 0;
    for (let i = 0; i < grad.length; i++) {
      grad[i] /= 6;
      g2 += grad[i] * grad[i];
    }
    if (g2 < 1e-12) return;
    const lambda = ((this.restVolume - v) / g2) * stiff;
    for (let i = 0; i < grad.length; i++) p[i] += grad[i] * lambda;
  }

  private solveGrabs() {
    const p = this.pos;
    for (const g of this.grabs.values()) {
      for (let i = 0; i < g.verts.length; i++) {
        const v = g.verts[i] * 3, w = g.weights[i];
        const tx = g.origin[i * 3] + g.dx * w;
        const ty = g.origin[i * 3 + 1] + g.dy * w;
        const tz = g.origin[i * 3 + 2] + g.dz * w;
        const s = 0.6 * w;
        p[v] += (tx - p[v]) * s;
        p[v + 1] += (ty - p[v + 1]) * s;
        p[v + 2] += (tz - p[v + 2]) * s;
      }
    }
  }

  private solveColliders() {
    const p = this.pos;
    const fingers = [...this.fingers.values()].filter((f) => f.active);
    const top = this.plateTop, bottom = Math.max(this.plateBottom, this.groundY);
    for (let i = 0; i < p.length; i += 3) {
      for (const f of fingers) {
        const dx = p[i] - f.cx, dy = p[i + 1] - f.cy, dz = p[i + 2] - f.cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < f.r * f.r) {
          const d = Math.sqrt(d2) || 1e-6;
          const s = f.r / d;
          p[i] = f.cx + dx * s; p[i + 1] = f.cy + dy * s; p[i + 2] = f.cz + dz * s;
        }
      }
      if (p[i + 1] > top) p[i + 1] = top;
      if (p[i + 1] < bottom) {
        p[i + 1] = bottom;
        // floor friction
        p[i] += (this.prev[i] - p[i]) * 0.5;
        p[i + 2] += (this.prev[i + 2] - p[i + 2]) * 0.5;
      }
    }
  }

  /** Select vertices near a point for pulling. */
  startGrab(id: number, x: number, y: number, z: number, radius: number) {
    const verts: number[] = [], weights: number[] = [], origin: number[] = [];
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < radius) {
        const t = 1 - d / radius;
        verts.push(i);
        weights.push(t * t * (3 - 2 * t));
        origin.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      }
    }
    this.grabs.set(id, {
      id,
      verts: new Uint32Array(verts),
      weights: new Float32Array(weights),
      origin: new Float32Array(origin),
      dx: 0, dy: 0, dz: 0,
    });
  }

  /** Give the whole body a jiggle impulse (fun when switching shape). */
  kick(strength = 1) {
    for (let i = 0; i < this.n; i++) {
      const y = this.rest[i * 3 + 1] - this.groundY;
      this.vel[i * 3 + 1] -= strength * y * 2;
      this.vel[i * 3] += strength * this.rest[i * 3] * y * 1.2;
      this.vel[i * 3 + 2] += strength * this.rest[i * 3 + 2] * y * 1.2;
    }
  }

  maxY() {
    let m = -Infinity;
    for (let i = 1; i < this.rest.length; i += 3) m = Math.max(m, this.rest[i]);
    return m;
  }
}
