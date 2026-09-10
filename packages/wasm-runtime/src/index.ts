import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Loads and drives a Sieveworks worker WASM module. Used by browser Web
 * Workers AND the coordinator's verifier — one loader, one artifact, zero
 * drift. The artifact is identified by its sha256 (worker_spec_hash); pass
 * expectedHash to refuse a mismatched module before instantiation.
 */

export const SIEVE_ERR_SCORE = -0x8000000000000000n; // i64 min — error sentinel

/** Max bytes a mode-2 module may write per bucket (Spec 01 §2). */
export const RENDER_OUT_CAP = 64 * 1024;

export type WasmVerificationMode = "witness_extremum" | "output_hash" | "training";

interface WorkerExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  // extremum ABI (mode 0)
  evaluate_seed?: (seed: bigint, paramsPtr: number, paramsLen: number) => bigint;
  evaluate_range?: (
    start: bigint,
    end: bigint,
    paramsPtr: number,
    paramsLen: number,
    outPtr: number
  ) => number;
  // output ABI (mode 1)
  render_bucket?: (
    start: bigint,
    end: bigint,
    paramsPtr: number,
    paramsLen: number,
    outPtr: number,
    outCap: number
  ) => number;
  // candidate ABI (prize bounties — orthogonal to mode; capability derived
  // from export presence)
  evaluate_candidate?: (candPtr: number, candLen: number, paramsPtr: number, paramsLen: number) => bigint;
  candidate_max_len?: () => number;
  trace_candidate?: (candPtr: number, candLen: number, paramsPtr: number, paramsLen: number, outPtr: number, outCap: number) => number;
  // mode discriminator — optional; absent = 0 = witness_extremum, so every
  // pre-mode artifact keeps its hash and meaning
  verification_mode?: () => number;
  spec_version: () => number;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
}

const MODE_BY_CODE: Record<number, WasmVerificationMode> = {
  0: "witness_extremum",
  1: "output_hash",
  2: "training",
};

/** Exports each mode must provide (spec_version/malloc/free are universal).
 * Mode 0 additionally allows CANDIDATE-ONLY modules (prize bounties): a
 * module exporting evaluate_candidate but no range ABI loads fine — it just
 * can't serve coverage jobs (creation guards on supportsExtremum). */
const MODE_ABI: Record<WasmVerificationMode, string[]> = {
  witness_extremum: [], // checked specially below
  output_hash: ["render_bucket"],
  training: ["render_bucket", "evaluate_seed"], // placeholder; Spec 03 finalizes
};

export class SieveWasmError extends Error {}

export class SieveWorkerModule {
  private constructor(
    private readonly exports: WorkerExports,
    public readonly specHash: string,
    public readonly verificationMode: WasmVerificationMode
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
    const table = exports as unknown as Record<string, unknown>;
    // Mode is declared by the artifact itself (optional export). Absent = 0
    // = witness_extremum, so pre-mode artifacts keep their hash and meaning.
    const modeCode = typeof table["verification_mode"] === "function" ? Number(exports.verification_mode!()) : 0;
    const mode = MODE_BY_CODE[modeCode];
    if (mode === undefined) {
      throw new SieveWasmError(`unknown verification_mode ${modeCode}`);
    }
    for (const name of [...MODE_ABI[mode], "spec_version", "malloc", "free"]) {
      if (typeof table[name] !== "function") {
        throw new SieveWasmError(`worker module (mode ${mode}) missing required export: ${name}`);
      }
    }
    if (mode === "witness_extremum") {
      const hasExtremum = typeof table["evaluate_range"] === "function" && typeof table["evaluate_seed"] === "function";
      const hasCandidates = typeof table["evaluate_candidate"] === "function";
      if (!hasExtremum && !hasCandidates) {
        throw new SieveWasmError("worker module exports neither the extremum ABI nor evaluate_candidate");
      }
    }
    exports._initialize?.();
    return new SieveWorkerModule(exports, hash, mode);
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
    if (!this.exports.evaluate_seed) {
      throw new SieveWasmError(`evaluate_seed not exported (mode ${this.verificationMode})`);
    }
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    try {
      const score = this.exports.evaluate_seed(seed, params.ptr, params.len);
      if (score === SIEVE_ERR_SCORE) throw new SieveWasmError("evaluate_seed: invalid params");
      return score;
    } finally {
      this.exports.free(params.ptr);
    }
  }

  /** Does this artifact score arbitrary candidate blobs (prize bounties)? */
  get supportsCandidates(): boolean {
    return typeof this.exports.evaluate_candidate === "function";
  }

  /** Does this artifact serve range-enumeration (coverage) jobs? */
  get supportsExtremum(): boolean {
    return typeof this.exports.evaluate_range === "function" && typeof this.exports.evaluate_seed === "function";
  }

  candidateMaxLen(): number {
    return this.exports.candidate_max_len ? this.exports.candidate_max_len() : 65536;
  }

  /** Score one candidate blob (prize bounties). Deterministic; INT64_MIN =
   * invalid candidate/params. */
  evaluateCandidate(candidate: Uint8Array, paramsJson: string): bigint {
    if (!this.exports.evaluate_candidate) {
      throw new SieveWasmError("evaluate_candidate not exported");
    }
    if (candidate.length === 0 || candidate.length > this.candidateMaxLen()) {
      throw new SieveWasmError(`candidate length ${candidate.length} outside (0, ${this.candidateMaxLen()}]`);
    }
    const cand = this.writeBytes(candidate);
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    try {
      const score = this.exports.evaluate_candidate(cand.ptr, cand.len, params.ptr, params.len);
      if (score === SIEVE_ERR_SCORE) throw new SieveWasmError("evaluate_candidate: invalid candidate or params");
      return score;
    } finally {
      this.exports.free(params.ptr);
      this.exports.free(cand.ptr);
    }
  }

  /** Replay data for a candidate (module-defined format; the evo modules
   * emit a tick trace the browser canvas draws). Optional export. */
  traceCandidate(candidate: Uint8Array, paramsJson: string): Uint8Array {
    if (!this.exports.trace_candidate) throw new SieveWasmError("trace_candidate not exported");
    const cand = this.writeBytes(candidate);
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    const outPtr = this.exports.malloc(RENDER_OUT_CAP);
    if (outPtr === 0) throw new SieveWasmError("wasm malloc failed");
    try {
      const len = this.exports.trace_candidate(cand.ptr, cand.len, params.ptr, params.len, outPtr, RENDER_OUT_CAP);
      if (len <= 0) throw new SieveWasmError(`trace_candidate failed: rc=${len}`);
      return new Uint8Array(this.exports.memory.buffer.slice(outPtr, outPtr + len));
    } finally {
      this.exports.free(outPtr);
      this.exports.free(params.ptr);
      this.exports.free(cand.ptr);
    }
  }

  /** Produce a mode-2 bucket's output bytes. The module never hashes —
   * digesting is the host's job (bucketDigest16), one implementation for
   * browser and coordinator alike. */
  renderBucket(start: bigint, end: bigint, paramsJson: string): Uint8Array {
    if (!this.exports.render_bucket) {
      throw new SieveWasmError(`render_bucket not exported (mode ${this.verificationMode})`);
    }
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    const outPtr = this.exports.malloc(RENDER_OUT_CAP);
    if (outPtr === 0) throw new SieveWasmError("wasm malloc failed");
    try {
      const len = this.exports.render_bucket(start, end, params.ptr, params.len, outPtr, RENDER_OUT_CAP);
      if (len <= 0) throw new SieveWasmError(`render_bucket failed: rc=${len}`);
      if (len > RENDER_OUT_CAP) throw new SieveWasmError(`render_bucket wrote ${len} > cap ${RENDER_OUT_CAP}`);
      return new Uint8Array(this.exports.memory.buffer.slice(outPtr, outPtr + len));
    } finally {
      this.exports.free(outPtr);
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
    if (!this.exports.evaluate_range) {
      throw new SieveWasmError(`evaluate_range not exported (mode ${this.verificationMode})`);
    }
    const params = this.writeBytes(new TextEncoder().encode(paramsJson));
    const outPtr = this.exports.malloc(16);
    try {
      const rc = this.exports.evaluate_range!(start, end, params.ptr, params.len, outPtr);
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

/** Digest for a mode-2/3 Merkle leaf: sha256(salt16 ‖ bucket_bytes)[0..16].
 * salt16 is the job's UUID bytes at verification time (so identical outputs
 * are not resellable across jobs); the conformance gate uses all-zero salt.
 * ONE implementation for browser workers and the coordinator — same
 * zero-drift property as the module loader itself. */
export function bucketDigest16(salt16: Uint8Array, bucketBytes: Uint8Array): Uint8Array {
  if (salt16.length !== 16) throw new SieveWasmError(`bucketDigest16: salt must be 16 bytes, got ${salt16.length}`);
  const buf = new Uint8Array(16 + bucketBytes.length);
  buf.set(salt16, 0);
  buf.set(bucketBytes, 16);
  return sha256(buf).slice(0, 16);
}
