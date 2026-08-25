import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

/** Run the conformance gate in a throwaway thread with a hard timeout — a
 * malicious module that hangs is terminated and rejected, never wedging the
 * server. Returns the gate verdict plus the artifact's content hash. */
export interface ConformanceResult {
  ok: boolean;
  hash: string;
  reason?: string;
  spec_version?: string;
  sample?: unknown;
  buckets_checked?: number;
}

const GATE_TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS ?? 12000);

export async function runConformanceGate(wasm: Uint8Array, paramsJson: string): Promise<ConformanceResult> {
  const hash = createHash("sha256").update(wasm).digest("hex");
  const worker = new Worker(new URL("./conformanceThread.js", import.meta.url), {
    workerData: { wasmBase64: Buffer.from(wasm).toString("base64"), paramsJson },
  });
  try {
    const verdict = await new Promise<Omit<ConformanceResult, "hash">>((resolve, reject) => {
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve({ ok: false, reason: `gate timed out after ${GATE_TIMEOUT_MS}ms — module too slow or looping` });
      }, GATE_TIMEOUT_MS);
      worker.once("message", (m: Omit<ConformanceResult, "hash">) => { clearTimeout(timer); resolve(m); });
      worker.once("error", (e) => { clearTimeout(timer); reject(e); });
    });
    return { ...verdict, hash };
  } catch (e) {
    return { ok: false, hash, reason: `gate crashed: ${(e as Error).message}` };
  } finally {
    void worker.terminate();
  }
}
