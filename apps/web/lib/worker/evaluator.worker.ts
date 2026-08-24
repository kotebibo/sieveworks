import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * One evaluation thread. Holds its own WASM instance (independent instances,
 * no SharedArrayBuffer — spec §10) and folds assigned bucket ranges.
 * Pure compute: no keys, no signing, no network — the trust boundary.
 */

interface InitMsg {
  type: "init";
  wasmBytes: ArrayBuffer;
  expectedHash: string;
}
interface EvalMsg {
  type: "eval";
  taskId: number;
  rangeStart: string; // u64 decimal
  rangeEnd: string;
  bucketSize: number;
  baseIndex: number; // bucket index of rangeStart within the chunk
  paramsJson: string;
}

let module_: SieveWorkerModule | null = null;

self.onmessage = async (e: MessageEvent<InitMsg | EvalMsg>) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      module_ = await SieveWorkerModule.load(new Uint8Array(msg.wasmBytes), msg.expectedHash);
      self.postMessage({ type: "ready", specVersion: module_.specVersion() });
    } catch (err) {
      self.postMessage({ type: "error", error: (err as Error).message });
    }
    return;
  }
  if (msg.type === "eval") {
    if (!module_) {
      self.postMessage({ type: "error", taskId: msg.taskId, error: "not initialized" });
      return;
    }
    try {
      const leaves: { index: number; maxScore: string; maxSeed: string }[] = [];
      const start = BigInt(msg.rangeStart);
      const end = BigInt(msg.rangeEnd);
      const bucket = BigInt(msg.bucketSize);
      let index = msg.baseIndex;
      for (let s = start; s < end; s += bucket, index++) {
        const e2 = s + bucket < end ? s + bucket : end;
        const { maxScore, maxSeed } = module_.evaluateRange(s, e2, msg.paramsJson);
        leaves.push({ index, maxScore: maxScore.toString(), maxSeed: maxSeed.toString() });
        self.postMessage({ type: "progress", taskId: msg.taskId, seedsDone: Number(e2 - s) });
      }
      self.postMessage({ type: "done", taskId: msg.taskId, leaves });
    } catch (err) {
      self.postMessage({ type: "error", taskId: msg.taskId, error: (err as Error).message });
    }
  }
};
