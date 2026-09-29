// Paper squishy templates: a printable, real-size SVG.
//  - "pillow": front + back pieces with a cut line (tape together, stuff, seal)
//  - "box":    a fold-up net (butter block), like a papercraft cube
// Each side is rendered flat (unlit) with the same shader as the 3D squishy,
// so the printed drawing matches the design.

import * as THREE from "three";
import { buildSDF, SHAPE_BOUNDS, type ShapeParams, type SquishyType } from "./sdf";
import { meshSDF } from "./mesher";
import { createSquishyMaterial, type Look } from "./squishyMaterial";

export type PaperKind = "box" | "pillow";

export function paperKind(t: SquishyType): PaperKind | null {
  if (t === "butter") return "box";
  if (t === "donut") return null; // the hole doesn't work as a paper squishy
  return "pillow";
}

/** The 3D shape of the paper version: pillows are much flatter than foam squishies. */
export function paperShape(shape: ShapeParams): ShapeParams {
  if (paperKind(shape.type) === "pillow") return { ...shape, stretchZ: shape.stretchZ * 0.42 };
  return shape;
}

export interface PaperTemplate {
  svg: string;
  widthMm: number;
  heightMm: number;
  kind: PaperKind;
}

type Dir = "front" | "back" | "top" | "bottom" | "left" | "right";

const PX_PER_MM = 10; // ~254 dpi
const MARGIN = 10;

// ---------------------------------------------------------------------------
// flat renders

function buildMesh(shape: ShapeParams) {
  const f = buildSDF(shape);
  const b = SHAPE_BOUNDS;
  const ext = [b * shape.stretchX, b * shape.stretchY, b * shape.stretchZ];
  const cell = (2 * Math.max(...ext)) / 110;
  const m = meshSDF(f, { min: [-ext[0], -ext[1], -ext[2]], max: [ext[0], ext[1], ext[2]] }, cell, { project: 3, smooth: 1 });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("restPos", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  g.setAttribute("restNormal", g.getAttribute("normal"));
  g.computeBoundingBox();
  return g;
}

interface View {
  url: string;
  wMm: number;
  hMm: number;
}

function renderViews(shape: ShapeParams, look: Look, sizeMm: number, dirs: Dir[]): { views: Record<string, View>; centre: THREE.Vector3 } {
  const geo = buildMesh(shape);
  const { material, apply } = createSquishyMaterial("basic");
  apply({ ...look, paper: 0 });
  material.side = THREE.FrontSide;
  const mesh = new THREE.Mesh(geo, material);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const bb = geo.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  const sz = bb.getSize(new THREE.Vector3());
  const mmPerUnit = sizeMm / 2;

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);

  const out: Record<string, View> = {};
  for (const d of dirs) {
    // [horizontal extent, vertical extent, camera offset dir, up]
    const cfg: Record<Dir, [number, number, THREE.Vector3, THREE.Vector3]> = {
      front: [sz.x, sz.y, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
      back: [sz.x, sz.y, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
      top: [sz.x, sz.z, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
      bottom: [sz.x, sz.z, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
      left: [sz.z, sz.y, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
      right: [sz.z, sz.y, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
    };
    const [w, h, off, up] = cfg[d];
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, 50);
    cam.up.copy(up);
    cam.position.copy(c).addScaledVector(off, 10);
    cam.lookAt(c);
    const wMm = w * mmPerUnit, hMm = h * mmPerUnit;
    renderer.setSize(Math.max(8, Math.round(wMm * PX_PER_MM)), Math.max(8, Math.round(hMm * PX_PER_MM)), false);
    renderer.render(scene, cam);
    out[d] = { url: canvas.toDataURL("image/png"), wMm, hMm };
  }
  renderer.dispose();
  renderer.forceContextLoss();
  geo.dispose();
  material.dispose();
  return { views: out, centre: c.multiplyScalar(mmPerUnit) };
}

// ---------------------------------------------------------------------------
// silhouette outline (marching squares on the depth-projected SDF)

function silhouette(shape: ShapeParams, sizeMm: number, marginMm: number) {
  const f = buildSDF(shape);
  const s = sizeMm / 2;
  const B = SHAPE_BOUNDS;
  const zx = B * shape.stretchZ;
  const f2 = (x: number, y: number) => {
    let m = Infinity;
    for (let k = 0; k <= 28; k++) m = Math.min(m, f(x, y, -zx + (2 * zx * k) / 28));
    return m * s; // mm-ish distance
  };
  const step = 0.5 / s; // 0.5 mm grid
  const x0 = -B * shape.stretchX - 0.2, y0 = -B * shape.stretchY - 0.2;
  const nx = Math.ceil((2 * B * shape.stretchX + 0.4) / step) + 1;
  const ny = Math.ceil((2 * B * shape.stretchY + 0.4) / step) + 1;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f2(x0 + i * step, y0 + j * step) - marginMm;

  // edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i), vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const pt = new Map<number, [number, number]>();
  const edgePoint = (id: number) => {
    let p = pt.get(id);
    if (p) return id;
    const base = id >> 1, i = base % nx, j = Math.floor(base / nx);
    const a = v[j * nx + i];
    const b = (id & 1) === 0 ? v[j * nx + i + 1] : v[(j + 1) * nx + i];
    const t = a / (a - b);
    p = (id & 1) === 0 ? [x0 + (i + t) * step, y0 + j * step] : [x0 + i * step, y0 + (j + t) * step];
    pt.set(id, p);
    return id;
  };
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    edgePoint(a); edgePoint(b);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const c0 = v[j * nx + i], c1 = v[j * nx + i + 1], c2 = v[(j + 1) * nx + i + 1], c3 = v[(j + 1) * nx + i];
      const k = (c0 < 0 ? 1 : 0) | (c1 < 0 ? 2 : 0) | (c2 < 0 ? 4 : 0) | (c3 < 0 ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const e0 = 2 * (j * nx + i), e1 = 2 * (j * nx + i + 1) + 1, e2 = 2 * ((j + 1) * nx + i), e3 = 2 * (j * nx + i) + 1;
      const centre = (c0 + c1 + c2 + c3) / 4 < 0;
      switch (k) {
        case 1: case 14: link(e3, e0); break;
        case 2: case 13: link(e0, e1); break;
        case 3: case 12: link(e3, e1); break;
        case 4: case 11: link(e1, e2); break;
        case 6: case 9: link(e0, e2); break;
        case 7: case 8: link(e3, e2); break;
        case 5: if (centre) { link(e0, e1); link(e2, e3); } else { link(e3, e0); link(e1, e2); } break;
        case 10: if (centre) { link(e3, e0); link(e1, e2); } else { link(e0, e1); link(e2, e3); } break;
      }
    }
  // chain into closed loops
  const loops: [number, number][][] = [];
  const used = new Set<number>();
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop: [number, number][] = [];
    let prev = -1, cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      const p = pt.get(cur)!;
      loop.push([p[0] * s, p[1] * s]);
      const next = (adj.get(cur) ?? []).find((n) => n !== prev && !used.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

// ---------------------------------------------------------------------------
// SVG helpers

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f1 = (n: number) => n.toFixed(2);

function loopPath(loop: [number, number][], ox: number, oy: number, mirror: boolean) {
  // svg y goes down; shape y goes up
  return (
    loop.map(([x, y], i) => `${i ? "L" : "M"}${f1(ox + (mirror ? -x : x))} ${f1(oy - y)}`).join("") + "Z"
  );
}

function scaleBar(x: number, y: number) {
  return `<g font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#555">
  <rect x="${x}" y="${y}" width="20" height="2" fill="none" stroke="#555" stroke-width="0.3"/>
  <rect x="${x}" y="${y}" width="10" height="2" fill="#555"/>
  <text x="${x + 22}" y="${y + 2}">20 mm (check after printing at 100%)</text></g>`;
}

function svgDoc(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f1(w)}mm" height="${f1(h)}mm" viewBox="0 0 ${f1(w)} ${f1(h)}">
<rect width="100%" height="100%" fill="#fff"/>
${body}
</svg>`;
}

// ---------------------------------------------------------------------------

export function buildPaperTemplate(shape: ShapeParams, look: Look, sizeMm: number, label: string, title: string): PaperTemplate | null {
  const kind = paperKind(shape.type);
  if (!kind) return null;
  return kind === "box" ? boxTemplate(shape, look, sizeMm, label, title) : pillowTemplate(shape, look, sizeMm, title);
}

function pillowTemplate(shape: ShapeParams, look: Look, sizeMm: number, title: string): PaperTemplate {
  const flat = paperShape(shape);
  const { views, centre } = renderViews(flat, look, sizeMm, ["front", "back"]);
  const tape = 3; // mm of tape margin around the drawing
  const cut = silhouette(flat, sizeMm, tape);
  const draw = silhouette(flat, sizeMm, 0);

  // shape bounds (mm) from the cut outline
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of cut) for (const [x, y] of l) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pw = maxX - minX, ph = maxY - minY;
  const gap = 10;
  const header = 14;
  const sideBySide = 2 * pw + gap <= 190;
  const W = MARGIN * 2 + (sideBySide ? 2 * pw + gap : pw);
  const H = MARGIN * 2 + header + (sideBySide ? ph : 2 * ph + gap + 8) + 34;

  // the flat renders cover the mesh bounding box, centred on `centre` (mm)
  const piece = (dir: "front" | "back", px: number, py: number) => {
    const v = views[dir];
    const mirror = dir === "back"; // seen from behind, x is flipped
    const ox = px + (mirror ? maxX : -minX); // page position of shape origin
    const oy = py + maxY;
    const imgX = mirror ? ox - (centre.x + v.wMm / 2) : ox + (centre.x - v.wMm / 2);
    const imgY = oy - (centre.y + v.hMm / 2);
    const cutPath = cut.map((l) => loopPath(l, ox, oy, mirror)).join("");
    const drawPath = draw.map((l) => loopPath(l, ox, oy, mirror)).join("");
    return `<g>
  <path d="${cutPath}" fill="#fff" stroke="#111" stroke-width="0.35" fill-rule="evenodd"/>
  <image href="${v.url}" xlink:href="${v.url}" x="${f1(imgX)}" y="${f1(imgY)}" width="${f1(v.wMm)}" height="${f1(v.hMm)}" preserveAspectRatio="none"/>
  <path d="${drawPath}" fill="none" stroke="#2b2230" stroke-width="0.5" fill-rule="evenodd"/>
  <text x="${f1(px + pw / 2)}" y="${f1(py + ph + 5)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="3.2" fill="#777">${dir.toUpperCase()}</text>
</g>`;
  };

  const top = MARGIN + header;
  const body = [
    `<text x="${MARGIN}" y="${MARGIN + 5}" font-family="Helvetica, Arial, sans-serif" font-size="5.5" font-weight="700" fill="#2b2230">${esc(title)} · paper squishy</text>`,
    `<text x="${MARGIN}" y="${MARGIN + 10}" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#777">${f1(pw - 2 * tape)} × ${f1(ph - 2 * tape)} mm · print at 100% / actual size</text>`,
    piece("front", MARGIN, top),
    sideBySide ? piece("back", MARGIN + pw + gap, top) : piece("back", MARGIN, top + ph + gap + 8),
  ];
  const iy = H - MARGIN - 22;
  body.push(`<g font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#444">
  <text x="${MARGIN}" y="${iy}">1. Colour it in if you like, then cover both pieces with clear packing tape (front and back).</text>
  <text x="${MARGIN}" y="${iy + 4.5}">2. Cut along the solid black outline (the tape margin keeps the seam strong).</text>
  <text x="${MARGIN}" y="${iy + 9}">3. Tape the front to the back around the edge, leaving a gap. Stuff with plastic bags, foam or cotton.</text>
  <text x="${MARGIN}" y="${iy + 13.5}">4. Tape the gap closed and squish!</text></g>`);
  body.push(scaleBar(MARGIN, H - MARGIN - 2));
  return { svg: svgDoc(W, H, body.join("\n")), widthMm: W, heightMm: H, kind: "pillow" };
}

function boxTemplate(shape: ShapeParams, look: Look, sizeMm: number, label: string, title: string): PaperTemplate {
  const v = renderViews(shape, look, sizeMm, ["front", "back", "top", "bottom", "left", "right"]).views;
  const W = v.front.wMm, H = v.front.hMm, D = v.top.hMm;
  const t = Math.min(10, Math.max(6, H * 0.35)); // glue tab depth
  const header = 14;
  const ox = MARGIN + t, cx = ox + D, rx = cx + W;
  const yBack = MARGIN + header + t, yTop = yBack + H, yFront = yTop + D, yBottom = yFront + H, yEnd = yBottom + D;
  const pageW = rx + D + t + MARGIN;
  const pageH = yEnd + MARGIN + 30;

  const img = (view: View, x: number, y: number, w: number, h: number) =>
    `<image href="${view.url}" xlink:href="${view.url}" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" preserveAspectRatio="none"/>`;
  const rect = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${fill}"/>`;

  // faces get a base colour fill first (the renders of a rounded block have soft corners)
  const faces = [
    [v.back, cx, yBack, W, H],
    [v.top, cx, yTop, W, D],
    [v.front, cx, yFront, W, H],
    [v.bottom, cx, yBottom, W, D],
    [v.left, ox, yFront, D, H],
    [v.right, rx, yFront, D, H],
  ] as const;

  // glue tabs: [x, y, w, h, side] where side is the edge the tab sticks out of
  const tab = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    // trapezoid from edge (x1,y1)-(x2,y2) outwards by t along (nx,ny)
    const ix = (x2 - x1) * 0.15, iy = (y2 - y1) * 0.15;
    const p = [
      [x1, y1],
      [x1 + ix + nx * t, y1 + iy + ny * t],
      [x2 - ix + nx * t, y2 - iy + ny * t],
      [x2, y2],
    ];
    return {
      poly: `<polygon points="${p.map((q) => q.map(f1).join(",")).join(" ")}" fill="#eee" stroke="#111" stroke-width="0.35"/>`,
      base: `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#fff" stroke-width="0.6"/><line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#666" stroke-width="0.3" stroke-dasharray="1.5 1"/>`,
    };
  };
  const tabs = [
    tab(ox, yFront, ox + D, yFront, 0, -1), // left flap top
    tab(ox, yFront + H, ox + D, yFront + H, 0, 1), // left flap bottom
    tab(rx, yFront, rx + D, yFront, 0, -1),
    tab(rx, yFront + H, rx + D, yFront + H, 0, 1),
    tab(cx, yBack, cx, yBack + H, -1, 0), // back panel sides
    tab(rx, yBack, rx, yBack + H, 1, 0),
    tab(cx, yBack, rx, yBack, 0, -1), // back panel end
  ];

  const outline = [
    [cx, yBack], [rx, yBack], [rx, yFront], [rx + D, yFront], [rx + D, yFront + H], [rx, yFront + H],
    [rx, yEnd], [cx, yEnd], [cx, yFront + H], [ox, yFront + H], [ox, yFront], [cx, yFront],
  ];
  const folds = [
    [cx, yTop, rx, yTop], [cx, yFront, rx, yFront], [cx, yBottom, rx, yBottom],
    [cx, yFront, cx, yFront + H], [rx, yFront, rx, yFront + H],
  ];

  const fs = Math.min(W / (Math.max(label.length, 3) * 0.62), D * 0.42);
  const body = [
    `<text x="${MARGIN}" y="${MARGIN + 5}" font-family="Helvetica, Arial, sans-serif" font-size="5.5" font-weight="700" fill="#2b2230">${esc(title)} · paper squishy box</text>`,
    `<text x="${MARGIN}" y="${MARGIN + 10}" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#777">${f1(W)} × ${f1(H)} × ${f1(D)} mm · print at 100% / actual size</text>`,
    ...tabs.map((q) => q.poly),
    ...faces.map(([view, x, y, w, h]) => rect(x, y, w, h, look.color) + img(view, x, y, w, h)),
    // label on the top panel, like a butter wrapper
    label
      ? `<g font-family="Helvetica, Arial, sans-serif" text-anchor="middle" fill="#1d4f91">
  <text x="${f1(cx + W * 0.5)}" y="${f1(yTop + D * 0.5 - fs * 0.55)}" font-size="${f1(fs * 0.28)}" font-weight="700">SALTED</text>
  <text x="${f1(cx + W * 0.5)}" y="${f1(yTop + D * 0.5 + fs * 0.35)}" font-size="${f1(fs)}" font-weight="900">${esc(label.toUpperCase())}</text>
  <text x="${f1(cx + W * 0.5)}" y="${f1(yTop + D * 0.5 + fs * 0.35 + fs * 0.4)}" font-size="${f1(fs * 0.22)}">NET WT. SQUISHY (1 PC)</text></g>`
      : "",
    `<polygon points="${outline.map((q) => q.map(f1).join(",")).join(" ")}" fill="none" stroke="#111" stroke-width="0.4"/>`,
    ...tabs.map((q) => q.base),
    ...folds.map(([x1, y1, x2, y2]) => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#666" stroke-width="0.3" stroke-dasharray="1.5 1"/>`),
    `<g font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#999" text-anchor="middle">
  <text x="${f1(cx + W / 2)}" y="${f1(yBack + H - 2)}">BACK</text><text x="${f1(cx + W / 2)}" y="${f1(yTop + D - 2)}">TOP</text>
  <text x="${f1(cx + W / 2)}" y="${f1(yFront + H - 2)}">FRONT</text><text x="${f1(cx + W / 2)}" y="${f1(yBottom + D - 2)}">BOTTOM</text></g>`,
    `<g font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#444">
  <text x="${MARGIN}" y="${yEnd + 8}">Cut on solid lines · fold on dashed lines · glue the grey tabs inside.</text>
  <text x="${MARGIN}" y="${yEnd + 12.5}">For a squishy box: tape over it first, stuff it with plastic bags or foam before closing the last side.</text></g>`,
    scaleBar(MARGIN, yEnd + 17),
  ];
  return { svg: svgDoc(pageW, pageH, body.join("\n")), widthMm: pageW, heightMm: pageH, kind: "box" };
}

export function printSVG(svg: string, title: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${esc(title)}</title><style>@page{margin:0}html,body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 400);
}

export function downloadSVG(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
