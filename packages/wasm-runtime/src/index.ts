import { sha256 } from "@noble/hashes/sha2.js";
import { WORKER_ABI } from "@sieveworks/protocol";

/**
 * Loads and drives a Sieveworks worker WASM module. Used by browser Web
 * Workers AND the coordinator's verifier — one loader, one artifact, zero
 * drift. The artifact is identified by its sha256 (worker_spec_hash); pass
 * expectedHash to refuse a mismatched module before instantiation.
 */

export const SIEVE_ERR_SCORE = -0x8000000000000000n; // i64 min — error sentinel

interface WorkerExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  evaluate_seed: (seed: bigint, paramsPtr: number, paramsLen: number) => bigint;
  evaluate_range: (
    start: bigint,
    end: bigint,
    paramsPtr: number,
    paramsLen: number,
    outPtr: number
  ) => number;
  spec_version: () => number;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
}

export class SieveWasmError extends Error {}

export class SieveWorkerModule {
  private constructor(
    private readonly exports: WorkerExports,
    public readonly specHash: string
  ) {}

  /** Instantiate from raw .wasm bytes. Verifies sha256 against expectedHash
   * when given, stubs any WASI imports (the module does no I/O), and asserts
   * the worker ABI is present. */
  static async load(wasmBytes: Uint8Array, expectedHash?: string): Promise<SieveWorkerModule> {
    const hash = toHex(sha256(wasmBytes));
    if (expectedHash !== undefined && hash !== expectedHash) {
      throw new SieveWasmError(
        `worker_spec_hash mismatch: artifact is ${hash}, expected ${expectedHash}`
      );
    }
    const module = await WebAssembly.compile(wasmBytes as BufferSource);
    const imports: Record<string, Record<string, unknown>> = {};
    for (const im of WebAssembly.Module.imports(module)) {
      if (im.kind !== "function") continue;
      imports[im.module] ??= {};
      imports[im.module]![im.name] =
        im.name === "proc_exit"
          ? (code: number) => {
              throw new SieveWasmError(`wasm called proc_exit(${code})`);
            }
          : () => 0;
    }
    const instance = await WebAssembly.instantiate(module, imports as WebAssembly.Imports);
    const exports = instance.exports as unknown as WorkerExports;
    for (const name of WORKER_ABI) {
      if (typeof (exports as unknown as Record<string, unknown>)[name] !== "function") {
        throw new SieveWasmError(`worker module missing required export: ${name}`);
      }
    }
    exports._initialize?.();
    return new SieveWorkerModule(exports, hash);
  }

  specVersion(): string {
    const ptr = this.exports.spec_version();
    const mem = new Uint8Array(this.exports.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return new TextDecoder().decode(mem.slice(ptr, end));
  }

  /** Score one seed. Throws on the error sentinel (bad params). */
  evaluateSeed(seed: bigint, paramsJson: string): bigint {
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    try {
      const score = this.exports.evaluate_seed(seed, params.ptr, params.len);
      if (score === SIEVE_ERR_SCORE) throw new SieveWasmError("evaluate_seed: invalid params");
      return score;
    } finally {
      this.exports.free(params.ptr);
    }
  }

  /** Fold [start, end) to its extremum. Ties resolve to the lowest seed (the
   * module guarantees it; the protocol depends on it). */
  evaluateRange(
    start: bigint,
    end: bigint,
    paramsJson: string
  ): { maxScore: bigint; maxSeed: bigint } {
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    const outPtr = this.exports.malloc(16);
    try {
      const rc = this.exports.evaluate_range(start, end, params.ptr, params.len, outPtr);
      if (rc !== 0) throw new SieveWasmError(`evaluate_range failed: rc=${rc}`);
      const view = new DataView(this.exports.memory.buffer, outPtr, 16);
      return {
        maxScore: view.getBigInt64(0, true),
        maxSeed: view.getBigUint64(8, true),
      };
    } finally {
      this.exports.free(outPtr);
      this.exports.free(params.ptr);
    }
  }

  private writeBytes(bytes: Uint8Array): { ptr: number; len: number } {
    const ptr = this.exports.malloc(bytes.length);
    if (ptr === 0) throw new SieveWasmError("wasm malloc failed");
    new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    return { ptr, len: bytes.length };
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
