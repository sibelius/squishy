"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, EYE_STYLES, getEntry, MOUTH_STYLES, PATTERN_LABELS, type EyeStyle, type MouthStyle, type PatternId } from "@/lib/catalog";
import type { ShapeParams, SquishyType } from "@/lib/sdf";
import { MATERIALS } from "@/lib/softbody";
import { DEFAULT_MOLD, bounds, type MoldParams, type MoldResult } from "@/lib/mold";
import { download, mergeMeshes, toSTL } from "@/lib/stl";
import type { Tool } from "./SquishyBody";
import type { Look } from "@/lib/squishyMaterial";
import { buildPaperTemplate, downloadSVG, paperKind, paperShape, printSVG, type PaperTemplate } from "@/lib/paper";

const Scene = dynamic(() => import("./Scene"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm opacity-60">Warming up the squish engine…</div> });

interface Design {
  type: SquishyType;
  color: string;
  secondary: string;
  pattern: PatternId;
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush: boolean;
  material: string;
  stretchX: number;
  stretchY: number;
  stretchZ: number;
  puff: number;
  sizeMm: number;
}

const designFor = (type: SquishyType, prev?: Design): Design => {
  const e = getEntry(type);
  return {
    type,
    color: e.color,
    secondary: e.secondary,
    pattern: e.pattern,
    eyes: e.eyes,
    mouth: e.mouth,
    blush: true,
    material: e.material,
    stretchX: 1,
    stretchY: 1,
    stretchZ: 1,
    puff: 1,
    sizeMm: prev?.sizeMm ?? 60,
  };
};

const STORAGE = "squishy-studio-v1";

export default function Studio() {
  const [design, setDesign] = useState<Design>(() => designFor("mochi"));
  const [tab, setTab] = useState<"build" | "mold" | "paper">("build");
  const [paperView, setPaperView] = useState<"3d" | "template">("template");
  const [paperLabel, setPaperLabel] = useState("Butter");
  const [paper, setPaper] = useState<PaperTemplate | null>(null);
  const [tool, setTool] = useState<Tool>("poke");
  const [fingerSize, setFingerSize] = useState(0.2);
  const [squeezeAt, setSqueezeAt] = useState(0);
  const [pressing, setPressing] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);

  const [moldParams, setMoldParams] = useState<MoldParams>(DEFAULT_MOLD);
  const [mold, setMold] = useState<MoldResult | null>(null);
  const [moldKey, setMoldKey] = useState("");
  const [progress, setProgress] = useState<{ t: number; label: string } | null>(null);
  const [moldError, setMoldError] = useState<string | null>(null);
  const [explode, setExplode] = useState(0.6);
  const [moldLayout, setMoldLayout] = useState<"open" | "closed">("open");
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);

  // restore / persist design
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDesign((d) => ({ ...d, ...JSON.parse(raw) }));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(design));
    } catch {}
  }, [design]);

  const entry = getEntry(design.type);
  const set = <K extends keyof Design>(k: K, v: Design[K]) => setDesign((d) => ({ ...d, [k]: v }));

  const shape: ShapeParams = useMemo(
    () => ({ type: design.type, stretchX: design.stretchX, stretchY: design.stretchY, stretchZ: design.stretchZ, puff: design.puff }),
    [design.type, design.stretchX, design.stretchY, design.stretchZ, design.puff],
  );
  const look: Look = useMemo(
    () => ({
      color: design.color,
      secondary: design.secondary,
      pattern: design.pattern,
      eyes: design.eyes,
      mouth: design.mouth,
      blush: design.blush,
      face: entry.face,
      glossy: design.material === "jelly",
    }),
    [design, entry],
  );

  const kind = paperKind(design.type);
  const inPaper = tab === "paper" && kind !== null;
  const sceneShape = useMemo(() => (inPaper ? paperShape(shape) : shape), [inPaper, shape]);
  const sceneLook: Look = useMemo(() => (inPaper ? { ...look, glossy: false, paper: kind === "box" ? 2 : 1 } : look), [inPaper, look, kind]);

  // (re)build the printable template while the paper tab is open
  useEffect(() => {
    if (!inPaper) return;
    const id = setTimeout(() => {
      try {
        setPaper(buildPaperTemplate(shape, look, design.sizeMm, paperLabel, entry.label));
      } catch (err) {
        console.error(err);
        setPaper(null);
      }
    }, 120);
    return () => clearTimeout(id);
  }, [inPaper, shape, look, design.sizeMm, paperLabel, entry.label]);

  const fullMold: MoldParams = useMemo(() => ({ ...moldParams, sizeMm: design.sizeMm }), [moldParams, design.sizeMm]);
  const currentKey = JSON.stringify([shape, fullMold]);
  const moldStale = !mold || moldKey !== currentKey;

  const generate = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../lib/mold.worker.ts", import.meta.url));
    }
    const w = workerRef.current;
    const id = ++jobRef.current;
    const key = currentKey;
    setProgress({ t: 0, label: "Starting" });
    setMoldError(null);
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.id !== jobRef.current) return;
      if (msg.type === "progress") setProgress({ t: msg.t, label: msg.label });
      else if (msg.type === "done") {
        setMold(msg.result);
        setMoldKey(key);
        setProgress(null);
      } else if (msg.type === "error") {
        setMoldError(msg.message);
        setProgress(null);
      }
    };
    w.postMessage({ id, shape, mold: fullMold });
  }, [currentKey, shape, fullMold]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // auto-generate when entering the mold tab
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "mold" && moldStale && !progress) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const dims = useMemo(() => {
    if (!mold) return null;
    return mold.parts.map((p) => {
      const b = bounds(p.print.positions);
      return { name: p.name, x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2], tris: p.print.indices.length / 3 };
    });
  }, [mold]);

  const dl = (which: "all" | "master" | number) => {
    if (!mold) return;
    const base = `squishy-${design.type}`;
    if (which === "master") download(toSTL(mold.master, `${base}-master`), `${base}-master.stl`);
    else if (which === "all") download(toSTL(mergeMeshes(mold.parts.map((p) => p.print)), `${base}-mold`), `${base}-mold-plate.stl`);
    else {
      const p = mold.parts[which];
      download(toSTL(p.print, `${base}-${p.name}`), `${base}-${p.name}.stl`);
    }
  };

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#fdf6fb] text-[#3b2f3f] md:flex-row">
      {/* 3D viewport */}
      <div className="relative min-h-0 flex-1">
        <Scene
          view={tab === "mold" && mold ? "mold" : "play"}
          shape={sceneShape}
          look={sceneLook}
          material={inPaper ? "paper" : design.material}
          tool={tool}
          fingerSize={fingerSize}
          squeezeAt={squeezeAt}
          mold={mold}
          explode={explode}
          moldLayout={moldLayout}
          sizeMm={design.sizeMm}
          background="#fdf6fb"
          onPress={setPressing}
        />

        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
          <div className="pointer-events-auto">
            <h1 className="text-xl font-black tracking-tight md:text-2xl">
              squishy<span className="text-pink-500">.lab</span>
            </h1>
            <p className="text-xs opacity-60">build · squish · print the mold</p>
          </div>
          <button
            className="pointer-events-auto rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur md:hidden"
            onClick={() => setPanelOpen((o) => !o)}
          >
            {panelOpen ? "Hide panel" : "Show panel"}
          </button>
        </header>

        {tab === "paper" && paperView === "template" && paper && (
          <div className="absolute inset-0 overflow-auto bg-[#f3eef3] p-4 pt-20 pb-20">
            <div
              className="mx-auto w-full max-w-[720px] bg-white shadow-xl [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: paper.svg }}
            />
          </div>
        )}

        {tab === "paper" && kind && (
          <div className="absolute inset-x-0 top-16 flex justify-center px-3">
            <div className="flex gap-1 rounded-2xl bg-white/90 p-1.5 text-sm shadow-lg backdrop-blur">
              {(["template", "3d"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPaperView(v)}
                  className={`rounded-xl px-3 py-2 font-semibold transition ${paperView === v ? "bg-amber-500 text-white shadow" : "hover:bg-amber-50"}`}
                >
                  {v === "template" ? "📄 Printable template" : "🧸 3D paper squishy"}
                </button>
              ))}
            </div>
          </div>
        )}

        {(tab === "build" || (tab === "paper" && paperView === "3d")) && (
          <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3">
            <p className={`text-xs transition-opacity ${pressing ? "opacity-0" : "opacity-60"}`}>
              Touch the squishy · hold to press deeper · use two fingers for a double squish · drag the background to spin
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-white/85 p-1.5 shadow-lg backdrop-blur">
              {(["poke", "squash", "pull"] as Tool[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold capitalize transition ${tool === t ? "bg-pink-500 text-white shadow" : "hover:bg-pink-50"}`}
                >
                  {t === "poke" ? "👆 Poke" : t === "squash" ? "✋ Squash" : "🤏 Pull"}
                </button>
              ))}
              <label className="flex items-center gap-2 px-2 text-xs">
                size
                <input type="range" min={0.1} max={0.4} step={0.01} value={fingerSize} onChange={(e) => setFingerSize(+e.target.value)} className="w-20 accent-pink-500" />
              </label>
              <button onClick={() => setSqueezeAt(performance.now())} className="rounded-xl bg-violet-500 px-3 py-2 text-sm font-bold text-white shadow hover:bg-violet-600">
                Squeeze!
              </button>
            </div>
          </div>
        )}

        {tab === "mold" && mold && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-white/85 p-1.5 text-sm shadow-lg backdrop-blur">
              {(["open", "closed"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setMoldLayout(l)}
                  className={`rounded-xl px-3 py-2 font-semibold transition ${moldLayout === l ? "bg-sky-500 text-white shadow" : "hover:bg-sky-50"}`}
                >
                  {l === "open" ? "Print layout" : "Assembled"}
                </button>
              ))}
              {moldLayout === "closed" && mold.parts.length > 1 && (
                <label className="flex items-center gap-2 px-2">
                  explode
                  <input type="range" min={0} max={1.5} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} className="w-32 accent-sky-500" />
                </label>
              )}
            </div>
          </div>
        )}

        {progress && (
          <div className="absolute inset-x-0 top-20 mx-auto w-64 rounded-2xl bg-white/90 p-3 text-center text-sm shadow-lg">
            <div>{progress.label}…</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
              <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round(progress.t * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* side panel */}
      <aside
        className={`${panelOpen ? "max-h-[42dvh]" : "max-h-0"} w-full shrink-0 overflow-y-auto border-t border-pink-100 bg-white/90 backdrop-blur transition-all md:max-h-none md:w-[360px] md:border-l md:border-t-0`}
      >
        <div className="sticky top-0 z-10 flex gap-1 border-b border-pink-100 bg-white/95 p-2">
          {(["build", "mold", "paper"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${tab === t ? { build: "bg-pink-500 text-white", mold: "bg-sky-500 text-white", paper: "bg-amber-500 text-white" }[t] : "hover:bg-gray-50"}`}
            >
              {{ build: "🎨 Build", mold: "🧱 3D mold", paper: "📄 Paper" }[t]}
            </button>
          ))}
        </div>

        {tab === "paper" ? (
          <div className="space-y-5 p-4">
            {!kind ? (
              <p className="rounded-xl bg-amber-50 p-3 text-sm">
                The {entry.label.toLowerCase()} doesn&apos;t have a paper version (the hole doesn&apos;t work in paper). Pick another type in <b>Build</b>.
              </p>
            ) : (
              <>
                <Section title={kind === "box" ? "Paper box (fold-up net)" : "Paper pillow (front + back)"}>
                  <p className="text-xs leading-relaxed opacity-70">
                    {kind === "box"
                      ? "A foldable net, like a papercraft cube: cut it out, fold the dashed lines, glue the tabs and stuff it before closing."
                      : "The classic paper squishy: print the front and back, tape over them, cut them out, tape them together and stuff."}{" "}
                    Your colors, face and pattern from Build are printed on it.
                  </p>
                </Section>
                <Section title="Size">
                  <Slider label="Squishy width (mm)" value={design.sizeMm} min={30} max={180} step={1} digits={0} onChange={(v) => set("sizeMm", v)} />
                  {paper && (
                    <p className={`text-xs ${paper.widthMm > 210 || paper.heightMm > 297 ? "text-amber-600" : "opacity-60"}`}>
                      Sheet: {paper.widthMm.toFixed(0)} × {paper.heightMm.toFixed(0)} mm
                      {paper.widthMm > 210 || paper.heightMm > 297 ? " (bigger than A4, so print on A3 or tile it)" : " (fits on A4 / Letter)"}
                    </p>
                  )}
                </Section>
                {kind === "box" && (
                  <Section title="Label">
                    <input
                      value={paperLabel}
                      onChange={(e) => setPaperLabel(e.target.value.slice(0, 14))}
                      placeholder="BUTTER"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  </Section>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={!paper}
                    onClick={() => paper && printSVG(paper.svg, `${entry.label} paper squishy`)}
                    className="rounded-2xl bg-amber-500 py-3 font-bold text-white shadow hover:bg-amber-600 disabled:opacity-50"
                  >
                    🖨 Print
                  </button>
                  <button
                    disabled={!paper}
                    onClick={() => paper && downloadSVG(paper.svg, `paper-squishy-${design.type}.svg`)}
                    className="rounded-2xl border border-amber-300 py-3 font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    ⬇ SVG
                  </button>
                </div>
                <p className="text-xs opacity-60">Print at 100% / &quot;actual size&quot; (turn off &quot;fit to page&quot;) and check the 20 mm scale bar.</p>
              </>
            )}
          </div>
        ) : tab === "build" ? (
          <div className="space-y-5 p-4">
            <Section title="Squishy type">
              <div className="grid grid-cols-4 gap-2">
                {CATALOG.map((c) => (
                  <button
                    key={c.type}
                    onClick={() => setDesign((d) => designFor(c.type, d))}
                    className={`flex flex-col items-center rounded-xl border p-2 text-[11px] transition ${design.type === c.type ? "border-pink-400 bg-pink-50 shadow-sm" : "border-transparent hover:bg-gray-50"}`}
                  >
                    <span className="text-2xl leading-none">{c.emoji}</span>
                    <span className="mt-1 font-medium">{c.label}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Colors">
              <div className="flex items-center gap-4">
                <ColorInput label="Main" value={design.color} onChange={(v) => set("color", v)} />
                <ColorInput label="Accent" value={design.secondary} onChange={(v) => set("secondary", v)} />
              </div>
              <Chips
                value={design.pattern}
                options={entry.patterns.map((p) => ({ value: p, label: PATTERN_LABELS[p] }))}
                onChange={(v) => set("pattern", v)}
              />
            </Section>

            <Section title="Face">
              <Row label="Eyes">
                <Chips value={design.eyes} options={EYE_STYLES.map((e) => ({ value: e, label: e }))} onChange={(v) => set("eyes", v)} />
              </Row>
              <Row label="Mouth">
                <Chips value={design.mouth} options={MOUTH_STYLES.map((e) => ({ value: e, label: e }))} onChange={(v) => set("mouth", v)} />
              </Row>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={design.blush} onChange={(e) => set("blush", e.target.checked)} className="accent-pink-500" />
                Blushy cheeks
              </label>
            </Section>

            <Section title="Shape">
              <Slider label="Width" value={design.stretchX} min={0.7} max={1.4} onChange={(v) => set("stretchX", v)} />
              <Slider label="Height" value={design.stretchY} min={0.6} max={1.4} onChange={(v) => set("stretchY", v)} />
              <Slider label="Depth" value={design.stretchZ} min={0.6} max={1.4} onChange={(v) => set("stretchZ", v)} />
              {["heart", "star", "toast"].includes(design.type) && (
                <Slider label="Puffiness" value={design.puff} min={0.5} max={1.6} onChange={(v) => set("puff", v)} />
              )}
            </Section>

            <Section title="Material feel">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(MATERIALS).map(([k, m]) => (
                  <button
                    key={k}
                    onClick={() => set("material", k)}
                    className={`rounded-xl border p-2 text-left transition ${design.material === k ? "border-pink-400 bg-pink-50" : "border-gray-100 hover:bg-gray-50"}`}
                  >
                    <div className="text-sm font-semibold">{m.label}</div>
                    <div className="text-[11px] opacity-60">{m.hint}</div>
                  </button>
                ))}
              </div>
            </Section>

            <button onClick={() => setTab("mold")} className="w-full rounded-2xl bg-sky-500 py-3 font-bold text-white shadow hover:bg-sky-600">
              Make a printable mold →
            </button>
            <button onClick={() => setTab("paper")} className="w-full rounded-2xl bg-amber-500 py-3 font-bold text-white shadow hover:bg-amber-600">
              Make a paper squishy →
            </button>
          </div>
        ) : (
          <div className="space-y-5 p-4">
            <Section title="Size">
              <Slider label="Squishy width (mm)" value={design.sizeMm} min={30} max={120} step={1} digits={0} onChange={(v) => set("sizeMm", v)} />
            </Section>

            <Section title="Mold style">
              <Chips
                value={moldParams.style}
                options={[
                  { value: "two-part", label: "2-part (closed)" },
                  { value: "open", label: "1-part (open top)" },
                ]}
                onChange={(v) => setMoldParams((m) => ({ ...m, style: v }))}
              />
              {moldParams.style === "two-part" && (
                <Row label="Split">
                  <Chips
                    value={moldParams.parting}
                    options={[
                      { value: "front-back", label: "front / back" },
                      { value: "top-bottom", label: "top / bottom" },
                    ]}
                    onChange={(v) => setMoldParams((m) => ({ ...m, parting: v }))}
                  />
                </Row>
              )}
            </Section>

            <Section title="Details">
              <Slider label="Wall thickness (mm)" value={moldParams.wall} min={3} max={15} step={0.5} digits={1} onChange={(v) => setMoldParams((m) => ({ ...m, wall: v }))} />
              {moldParams.style === "two-part" && (
                <>
                  <Slider label="Pour hole Ø (mm)" value={moldParams.sprueDiameter} min={4} max={16} step={0.5} digits={1} onChange={(v) => setMoldParams((m) => ({ ...m, sprueDiameter: v }))} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={moldParams.vent} onChange={(e) => setMoldParams((m) => ({ ...m, vent: e.target.checked }))} className="accent-sky-500" />
                    Air vent
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={moldParams.keys} onChange={(e) => setMoldParams((m) => ({ ...m, keys: e.target.checked }))} className="accent-sky-500" />
                    Registration keys
                  </label>
                  {moldParams.keys && (
                    <>
                      <Slider label="Key radius (mm)" value={moldParams.keyRadius} min={2} max={6} step={0.5} digits={1} onChange={(v) => setMoldParams((m) => ({ ...m, keyRadius: v }))} />
                      <Slider label="Key clearance (mm)" value={moldParams.clearance} min={0} max={0.8} step={0.05} digits={2} onChange={(v) => setMoldParams((m) => ({ ...m, clearance: v }))} />
                    </>
                  )}
                </>
              )}
              <Row label="Quality">
                <Chips
                  value={moldParams.resolution}
                  options={[
                    { value: 1.2, label: "draft" },
                    { value: 0.7, label: "normal" },
                    { value: 0.45, label: "fine" },
                  ]}
                  onChange={(v) => setMoldParams((m) => ({ ...m, resolution: v }))}
                />
              </Row>
            </Section>

            <button
              onClick={generate}
              disabled={!!progress}
              className={`w-full rounded-2xl py-3 font-bold text-white shadow transition ${moldStale ? "bg-sky-500 hover:bg-sky-600" : "bg-sky-300"} disabled:opacity-60`}
            >
              {progress ? "Generating…" : mold ? (moldStale ? "Regenerate mold" : "Mold up to date ✓") : "Generate mold"}
            </button>
            {moldError && <p className="text-sm text-red-500">{moldError}</p>}

            {mold && dims && (
              <Section title="Download STL">
                <div className="space-y-2">
                  {dims.map((d, i) => (
                    <button key={d.name} onClick={() => dl(i)} className="flex w-full items-center justify-between rounded-xl border border-sky-100 px-3 py-2 text-left text-sm hover:bg-sky-50">
                      <span className="font-semibold">⬇ {d.name}.stl</span>
                      <span className="text-xs opacity-60">
                        {d.x.toFixed(0)}×{d.y.toFixed(0)}×{d.z.toFixed(0)} mm
                      </span>
                    </button>
                  ))}
                  {dims.length > 1 && (
                    <button onClick={() => dl("all")} className="flex w-full items-center justify-between rounded-xl border border-sky-100 px-3 py-2 text-sm hover:bg-sky-50">
                      <span className="font-semibold">⬇ all parts on one plate</span>
                    </button>
                  )}
                  <button onClick={() => dl("master")} className="flex w-full items-center justify-between rounded-xl border border-pink-100 px-3 py-2 text-left text-sm hover:bg-pink-50">
                    <span className="font-semibold">⬇ master (the squishy itself)</span>
                    <span className="text-xs opacity-60">for TPU / resin</span>
                  </button>
                </div>
                {moldStale && <p className="text-xs text-amber-600">Design changed since the last generation, so regenerate before downloading.</p>}
              </Section>
            )}

            <Section title="How to cast">
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed opacity-80">
                <li>Print the mold parts in PLA or PETG, cavity facing up (no supports needed), 0.12–0.2 mm layers.</li>
                <li>Sand or smooth the cavity, then brush on mold release (or seal it with XTC-3D).</li>
                <li>Close the halves (the keys align them) and clamp or tape them shut.</li>
                <li>Pour soft platinum silicone (Shore 00-10 to 00-30) or slow-rise PU foam through the pour hole until it comes out the vent.</li>
                <li>Cure, demold, and paint the face with silicone-based paint (Psycho Paint) or use a pigmented pour.</li>
              </ol>
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-bold uppercase tracking-wider opacity-50">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs opacity-60">{label}</div>
      {children}
    </div>
  );
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${value === o.value ? "border-pink-400 bg-pink-500 text-white" : "border-gray-200 hover:bg-gray-50"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step = 0.01, digits = 2, onChange }: { label: string; value: number; min: number; max: number; step?: number; digits?: number; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1">
      <div className="flex justify-between text-xs">
        <span className="opacity-60">{label}</span>
        <span className="font-mono">{value.toFixed(digits)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-pink-500" />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent p-0" />
      {label}
    </label>
  );
}
