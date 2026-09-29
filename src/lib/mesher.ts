// Naive Surface Nets mesher with surface projection.
// Produces a watertight, consistently-wound (outward CCW) indexed triangle mesh.

import type { SDF } from "./sdf";

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshSDF(
  f: SDF,
  box: Box,
  cell: number,
  opts: { project?: number; smooth?: number; onProgress?: (t: number) => void } = {},
): Mesh {
  const project = opts.project ?? 3;
  const smooth = opts.smooth ?? 1;
  // pad by one cell on each side so the boundary is always "outside"
  const ox = box.min[0] - cell, oy = box.min[1] - cell, oz = box.min[2] - cell;
  const nx = Math.ceil((box.max[0] - box.min[0]) / cell) + 3;
  const ny = Math.ceil((box.max[1] - box.min[1]) / cell) + 3;
  const nz = Math.ceil((box.max[2] - box.min[2]) / cell) + 3;
  const sxy = nx * ny;

  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = oz + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * cell;
      let idx = k * sxy + j * nx;
      for (let i = 0; i < nx; i++, idx++) {
        const border = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        const v = f(ox + i * cell, y, z);
        field[idx] = border ? Math.max(v, cell * 0.5) : v;
      }
    }
    opts.onProgress?.((k + 1) / nz * 0.8);
  }

  // one vertex per sign-changing cell
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cxy = (nx - 1) * (ny - 1);
  const verts: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x
    [0, 2], [1, 3], [4, 6], [5, 7], // y
    [0, 4], [1, 5], [2, 6], [3, 7], // z
  ];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
          const v = field[(k + dk) * sxy + (j + dj) * nx + (i + di)];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const axx = a & 1, ayy = (a >> 1) & 1, azz = (a >> 2) & 1;
          const bxx = b & 1, byy = (b >> 1) & 1, bzz = (b >> 2) & 1;
          ax += axx + (bxx - axx) * t;
          ay += ayy + (byy - ayy) * t;
          az += azz + (bzz - azz) * t;
          n++;
        }
        cellVert[k * cxy + j * (nx - 1) + i] = verts.length / 3;
        verts.push(ox + (i + ax / n) * cell, oy + (j + ay / n) * cell, oz + (k + az / n) * cell);
      }
    }
  }

  const tris: number[] = [];
  const cv = (i: number, j: number, k: number) => cellVert[k * cxy + j * (nx - 1) + i];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) tris.push(a, d, c, a, c, b);
    else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = field[k * sxy + j * nx + i];
        const in0 = v0 < 0;
        // x edge (i,j,k)->(i+1,j,k): cells around in (y,z)
        if (in0 !== field[k * sxy + j * nx + i + 1] < 0) {
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !in0);
        }
        // y edge: cells around in (z,x)
        if (in0 !== field[k * sxy + (j + 1) * nx + i] < 0) {
          quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !in0);
        }
        // z edge: cells around in (x,y)
        if (in0 !== field[(k + 1) * sxy + j * nx + i] < 0) {
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !in0);
        }
      }
    }
  }

  const positions = new Float32Array(verts);
  const indices = new Uint32Array(tris);

  if (smooth > 0) laplacian(positions, indices, smooth, 0.5);
  if (project > 0) projectToSurface(f, positions, project, cell);
  opts.onProgress?.(1);
  return { positions, indices };
}

function laplacian(pos: Float32Array, idx: Uint32Array, iters: number, lambda: number) {
  const n = pos.length / 3;
  const acc = new Float32Array(pos.length);
  const cnt = new Uint16Array(n);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    cnt.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
        acc[a * 3] += pos[b * 3]; acc[a * 3 + 1] += pos[b * 3 + 1]; acc[a * 3 + 2] += pos[b * 3 + 2];
        acc[b * 3] += pos[a * 3]; acc[b * 3 + 1] += pos[a * 3 + 1]; acc[b * 3 + 2] += pos[a * 3 + 2];
        cnt[a]++; cnt[b]++;
      }
    }
    for (let v = 0; v < n; v++) {
      if (!cnt[v]) continue;
      for (let c = 0; c < 3; c++) {
        const avg = acc[v * 3 + c] / cnt[v];
        pos[v * 3 + c] += (avg - pos[v * 3 + c]) * lambda;
      }
    }
  }
}

function projectToSurface(f: SDF, pos: Float32Array, iters: number, cell: number) {
  const h = cell * 0.05;
  const maxStep = cell * 0.75;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < iters; it++) {
      const d = f(x, y, z);
      const gx = (f(x + h, y, z) - f(x - h, y, z)) / (2 * h);
      const gy = (f(x, y + h, z) - f(x, y - h, z)) / (2 * h);
      const gz = (f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-8) break;
      x -= (d * gx) / g2; y -= (d * gy) / g2; z -= (d * gz) / g2;
    }
    // never move too far (protects sharp features / non-exact SDFs)
    const dx = x - x0, dy = y - y0, dz = z - z0;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const s = dl > maxStep ? maxStep / dl : 1;
    pos[v] = x0 + dx * s; pos[v + 1] = y0 + dy * s; pos[v + 2] = z0 + dz * s;
  }
}
