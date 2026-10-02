import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { ImageResponse } from "next/og";
import { CATALOG } from "@/lib/catalog";

export const SITE_URL = "https://squishy.vercel.app";
export const SITE_NAME = "squishy.lab";
export const SITE_TITLE = "squishy.lab: build, squish & print";
export const SITE_DESCRIPTION = "Design squishies in 3D, squish them with touch, and export printable molds as STL.";
export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  bg: "#fdf6fb",
  ink: "#3b2f3f",
  muted: "#8a7a8e",
  line: "#eadde8",
  pink: "#ec4899",
  sky: "#0ea5e9",
  amber: "#f59e0b",
  violet: "#8b5cf6",
};

interface Page {
  kicker: string;
  title: string;
  blurb: string;
}

const PAGES: Record<string, Page> = {
  "/": {
    kicker: "build · squish · print the mold",
    title: SITE_TITLE,
    blurb: SITE_DESCRIPTION,
  },
};

function page(href: string): Page {
  const p = PAGES[href];
  if (!p) throw new Error(`No OG page for ${href}`);
  return p;
}

export function pageMetadata(href: string): Metadata {
  const { title, blurb: description } = page(href);
  return {
    title,
    description,
    openGraph: { title, description, url: href, siteName: SITE_NAME, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function ogAlt(href: string) {
  const p = page(href);
  return `${p.title}. ${p.blurb}`;
}

// ---- Art ----------------------------------------------------------------------

/** A soft blob sitting on the ground: round on top, flattened and wider where it is squished. */
export function blobPath(cx: number, cy: number, rx: number, ry: number, squish = 0.15, wobble = 0, seed = 1) {
  const n = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(t * 3 + seed);
    const s = Math.sin(t);
    const x = cx + Math.cos(t) * rx * w * (1 + (s > 0 ? squish * s : 0));
    const y = cy + s * ry * w * (s > 0 ? 1 - squish : 1);
    pts.push([x, y]);
  }
  // Catmull-Rom through the points, as cubic Béziers
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

function face({ cx, cy, r, eyes = "dot" }: { cx: number; cy: number; r: number; eyes?: string }) {
  const ex = r * 0.34;
  const er = r * 0.075;
  return (
    <g>
      {eyes === "happy" ? (
        <g>
          <path d={`M${cx - ex - er * 1.4} ${cy}q${er * 1.4} ${-er * 2} ${er * 2.8} 0`} stroke={C.ink} strokeWidth={er * 0.9} fill="none" strokeLinecap="round" />
          <path d={`M${cx + ex - er * 1.4} ${cy}q${er * 1.4} ${-er * 2} ${er * 2.8} 0`} stroke={C.ink} strokeWidth={er * 0.9} fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <circle cx={cx - ex} cy={cy} r={er} fill={C.ink} />
          <circle cx={cx + ex} cy={cy} r={er} fill={C.ink} />
          <circle cx={cx - ex + er * 0.35} cy={cy - er * 0.35} r={er * 0.32} fill="#fff" />
          <circle cx={cx + ex + er * 0.35} cy={cy - er * 0.35} r={er * 0.32} fill="#fff" />
        </g>
      )}
      <ellipse cx={cx - ex * 1.45} cy={cy + r * 0.16} rx={r * 0.11} ry={r * 0.06} fill="#ff6f91" fillOpacity={0.45} />
      <ellipse cx={cx + ex * 1.45} cy={cy + r * 0.16} rx={r * 0.11} ry={r * 0.06} fill="#ff6f91" fillOpacity={0.45} />
      <path
        d={`M${cx - r * 0.13} ${cy + r * 0.12}q${r * 0.065} ${r * 0.09} ${r * 0.13} 0q${r * 0.065} ${r * 0.09} ${r * 0.13} 0`}
        stroke={C.ink}
        strokeWidth={er * 0.75}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

function squishy({ cx, cy, rx, ry, color, eyes, squish, seed }: { cx: number; cy: number; rx: number; ry: number; color: string; eyes: string; squish: number; seed: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy + ry * (1 - squish) + 6} rx={rx * 1.05} ry={9} fill={C.ink} fillOpacity={0.08} />
      <path d={blobPath(cx, cy, rx, ry, squish, 0.03, seed)} fill={color} stroke={C.ink} strokeOpacity={0.12} strokeWidth={2} />
      <ellipse cx={cx - rx * 0.35} cy={cy - ry * 0.5} rx={rx * 0.26} ry={ry * 0.13} fill="#fff" fillOpacity={0.6} transform={`rotate(-20 ${cx - rx * 0.35} ${cy - ry * 0.5})`} />
      {face({ cx, cy: cy + ry * 0.05, r: Math.min(rx, ry), eyes })}
    </g>
  );
}

const pick = (type: string) => CATALOG.find((c) => c.type === type)!;

function Pile() {
  const w = 520;
  const h = 470;
  const mochi = pick("mochi");
  const frog = pick("frog");
  const star = pick("star");
  const cloud = pick("cloud");
  const heart = pick("heart");
  const peach = pick("peach");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* the mold: a printed half-shell with registration pins, behind the pile */}
      <g transform="translate(300 40)">
        <rect x={0} y={0} width={200} height={150} rx={18} fill="#e0f2fe" stroke={C.sky} strokeWidth={3} />
        <path d={blobPath(100, 80, 62, 50, 0.12)} fill="#bae6fd" stroke={C.sky} strokeWidth={2.5} strokeDasharray="7 6" />
        {[
          [20, 20],
          [180, 20],
          [20, 130],
          [180, 130],
        ].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r={7} fill="#fff" stroke={C.sky} strokeWidth={2.5} />
        ))}
      </g>
      {squishy({ cx: 145, cy: 190, rx: 96, ry: 84, color: cloud.color, eyes: "happy", squish: 0.1, seed: 2 })}
      {squishy({ cx: 400, cy: 300, rx: 84, ry: 72, color: star.color, eyes: "dot", squish: 0.14, seed: 4 })}
      {squishy({ cx: 110, cy: 372, rx: 88, ry: 66, color: frog.color, eyes: "dot", squish: 0.2, seed: 1 })}
      {squishy({ cx: 268, cy: 350, rx: 118, ry: 98, color: mochi.color, eyes: "dot", squish: 0.22, seed: 3 })}
      {squishy({ cx: 455, cy: 410, rx: 46, ry: 40, color: peach.color, eyes: "happy", squish: 0.2, seed: 5 })}
      <path
        d="M246 175c-14-22-48-14-48 12 0 24 48 46 48 46s48-22 48-46c0-26-34-34-48-12z"
        fill={heart.color}
        stroke={C.ink}
        strokeOpacity={0.12}
        strokeWidth={2}
        transform="rotate(-10 246 205)"
      />
      {/* sparkle */}
      <path d="M470 220l6 16 16 6-16 6-6 16-6-16-16-6 16-6z" fill={C.amber} />
      <path d="M40 60l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill={C.violet} fillOpacity={0.8} />
    </svg>
  );
}

/** The site mark: a pink mochi blob with a face. Same drawing as app/icon.svg. */
export function SquishyMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width={32} height={32} rx={8} fill={C.pink} />
      <path d="M16 6.5C22.6 6.5 26.5 11.4 26.5 17.2C26.5 22.6 22.4 25.5 16 25.5C9.6 25.5 5.5 22.6 5.5 17.2C5.5 11.4 9.4 6.5 16 6.5Z" fill="#ffd3e0" />
      <ellipse cx={11.6} cy={11.4} rx={2.6} ry={1.3} fill="#fff" fillOpacity={0.75} transform="rotate(-25 11.6 11.4)" />
      <circle cx={12.4} cy={16.4} r={1.5} fill={C.ink} />
      <circle cx={19.6} cy={16.4} r={1.5} fill={C.ink} />
      <ellipse cx={9.8} cy={19.3} rx={1.7} ry={1} fill="#ff6f91" fillOpacity={0.6} />
      <ellipse cx={22.2} cy={19.3} rx={1.7} ry={1} fill="#ff6f91" fillOpacity={0.6} />
      <path d="M14 19.2q1 1.4 2 0q1 1.4 2 0" stroke={C.ink} strokeWidth={1.1} fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ---- Render -------------------------------------------------------------------

const font = (f: string) => readFile(join(process.cwd(), "assets/fonts", f));

export async function renderOg(href: string) {
  const [black, medium, mono] = await Promise.all([
    font("Geist-Black.woff"),
    font("Geist-Medium.woff"),
    font("GeistMono-Medium.woff"),
  ]);
  const p = page(href);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: C.bg,
          backgroundImage: "radial-gradient(circle at 85% 30%, #fde2f0 0%, #fdf6fb 55%)",
          color: C.ink,
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 660, padding: "56px 0 48px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "Geist Mono", fontSize: 24, color: C.pink }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: C.pink }} />
            <span>{p.kicker}</span>
          </div>
          <div style={{ display: "flex", marginTop: 40, fontSize: 112, fontWeight: 900, letterSpacing: -5, lineHeight: 1 }}>
            <span>squishy</span>
            <span style={{ color: C.pink }}>.lab</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26, fontSize: 46, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.1 }}>
            <span>Build it. Squish it.</span>
            <span style={{ color: C.sky }}>Print the mold.</span>
          </div>
          <div style={{ marginTop: 24, fontSize: 28, fontWeight: 500, lineHeight: 1.35, color: C.muted, maxWidth: 560 }}>{p.blurb}</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "Geist Mono", fontSize: 22, color: C.muted }}>
            <SquishyMark size={36} />
            <span style={{ color: C.ink }}>{SITE_NAME}</span>
            <span>·</span>
            <span>squishy.vercel.app</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 56, paddingRight: 24 }}>
          <Pile />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Geist", data: black, weight: 900, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
