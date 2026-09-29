/// <reference lib="webworker" />
import { generateMold, type MoldParams } from "./mold";
import type { ShapeParams } from "./sdf";

self.onmessage = (e: MessageEvent<{ id: number; shape: ShapeParams; mold: MoldParams }>) => {
  const { id, shape, mold } = e.data;
  try {
    const result = generateMold(shape, mold, (t, label) => self.postMessage({ id, type: "progress", t, label }));
    const transfer: Transferable[] = [];
    for (const p of result.parts)
      transfer.push(p.print.positions.buffer, p.print.indices.buffer, p.preview.positions.buffer);
    transfer.push(result.master.positions.buffer, result.master.indices.buffer);
    // preview + print share the index buffer; clone preview indices so both can be transferred safely
    for (const p of result.parts) p.preview = { positions: p.preview.positions, indices: p.preview.indices.slice() };
    self.postMessage({ id, type: "done", result }, { transfer });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String(err) });
  }
};
