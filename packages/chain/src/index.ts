import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/**
 * Client for the Sieveworks Anchor program — shared by the web app (funder
 * signs initialize_job in the browser; worker signs claim) and the coordinator
 * (signs record_find, co-signs claim). We have no generated IDL (the program
 * was built with cargo-build-sbf, not the Anchor CLI), so instructions are
 * hand-encoded. That is less magic than it sounds:
 *
 *   - Anchor dispatches instructions by a fixed 8-byte discriminator:
 *     sha256("global:<instruction_name>")[0..8]. These are pure constants,
 *     precomputed below (provenance: node crypto against the literal string).
 *   - Arguments follow, borsh-encoded in declaration order. Borsh for our
 *     types is trivial: u64/i64 = 8 bytes little-endian, Pubkey = 32 raw
 *     bytes, [u8;16] = 16 raw bytes. No lengths, no tags.
 *   - Account metas must be listed in the exact order of the #[derive(Accounts)]
 *     struct fields, with is_signer/is_writable matching the constraints.
 *
 * Mirrors programs/sieveworks/src/lib.rs — update both together.
 */

export const PROGRAM_ID = new PublicKey("BPxLuXppjSMehhkibfRU646ZsrMMReFkMUKjmPuirWnf");

// sha256("global:<name>")[0..8] — precomputed, see header comment.
const DISC = {
  initialize_job: Uint8Array.from([137, 22, 138, 41, 76, 208, 114, 50]),
  record_find: Uint8Array.from([247, 136, 26, 112, 14, 245, 169, 83]),
  claim: Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]),
} as const;

// sha256("account:JobEscrow")[0..8] — Anchor account data starts with this.
const JOB_ESCROW_DISC = Uint8Array.from([189, 224, 160, 70, 105, 78, 115, 151]);

// ---------------------------------------------------------------------------
// job_id: our DB UUID as the raw 16 bytes. A PDA seed maxes at 32 bytes, so
// the UUID's hex string (36 chars) wouldn't fit — its bytes do.
// ---------------------------------------------------------------------------

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`not a uuid: ${uuid}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// PDA derivations — pure functions of the seeds, so anyone can derive the
// escrow/find/earnings address for a job without any lookup.
// ---------------------------------------------------------------------------

export function jobEscrowPda(jobId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("job"), Buffer.from(jobId)], PROGRAM_ID)[0];
}

export function findPda(jobId: Uint8Array, seed: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("find"), Buffer.from(jobId), Buffer.from(u64le(seed))],
    PROGRAM_ID
  )[0];
}

export function earningsPda(jobId: Uint8Array, worker: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("earn"), Buffer.from(jobId), worker.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function stakePda(worker: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("stake"), worker.toBuffer()], PROGRAM_ID)[0];
}

// ---------------------------------------------------------------------------
// borsh primitives
// ---------------------------------------------------------------------------

function u64le(v: bigint): Uint8Array {
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${v}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function i64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, v, true);
  return b;
}

function concat(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

// ---------------------------------------------------------------------------
// Instruction builders. Account order mirrors the program's Accounts structs.
// ---------------------------------------------------------------------------

/** Funder locks the budget into the job's escrow PDA. Funder signs + pays. */
export function initializeJobIx(args: {
  jobUuid: string;
  funder: PublicKey;
  coordinator: PublicKey;
  budgetLamports: bigint;
  pricePerChunkLamports: bigint;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.funder, isSigner: true, isWritable: true },
      { pubkey: jobEscrowPda(jobId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      DISC.initialize_job,
      jobId,
      u64le(args.budgetLamports),
      u64le(args.pricePerChunkLamports),
      args.coordinator.toBytes()
    ),
  });
}

/** Coordinator attributes a verified discovery on-chain. Coordinator signs +
 * pays the FindRecord's rent. Idempotent per (job, seed) by PDA init. */
export function recordFindIx(args: {
  jobUuid: string;
  coordinator: PublicKey;
  seed: bigint;
  score: bigint;
  finder: PublicKey;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: true },
      { pubkey: jobEscrowPda(jobId), isSigner: false, isWritable: false },
      { pubkey: findPda(jobId, args.seed), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(DISC.record_find, jobId, u64le(args.seed), i64le(args.score), args.finder.toBytes()),
  });
}

/** Worker claims cumulative earnings; worker AND coordinator sign (the
 * coordinator signature IS the payout authorization). Replay-safe: the program
 * pays cumulative − already_claimed, so an old voucher pays ≤ 0. */
export function claimIx(args: {
  jobUuid: string;
  worker: PublicKey;
  coordinator: PublicKey;
  cumulativeLamports: bigint;
  nonce: bigint;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.worker, isSigner: true, isWritable: true },
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: jobEscrowPda(jobId), isSigner: false, isWritable: true },
      { pubkey: earningsPda(jobId, args.worker), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(DISC.claim, jobId, u64le(args.cumulativeLamports), u64le(args.nonce)),
  });
}

// ---------------------------------------------------------------------------
// Account decoding (for the coordinator to verify a funding tx actually
// created the escrow it claims to have).
// ---------------------------------------------------------------------------

export interface JobEscrowAccount {
  jobId: Uint8Array;
  funder: PublicKey;
  coordinator: PublicKey;
  pricePerChunk: bigint;
  budget: bigint;
  totalPaid: bigint;
  bump: number;
}

/** Layout: 8B discriminator ‖ job_id[16] ‖ funder[32] ‖ coordinator[32] ‖
 * price u64 ‖ budget u64 ‖ total_paid u64 ‖ bump u8 = 113 bytes. */
export function decodeJobEscrow(data: Uint8Array): JobEscrowAccount {
  if (data.length < 113) throw new Error(`escrow account too short: ${data.length}`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== JOB_ESCROW_DISC[i]) throw new Error("not a JobEscrow account");
  }
  const dv = new DataView(data.buffer, data.byteOffset);
  return {
    jobId: data.slice(8, 24),
    funder: new PublicKey(data.slice(24, 56)),
    coordinator: new PublicKey(data.slice(56, 88)),
    pricePerChunk: dv.getBigUint64(88, true),
    budget: dv.getBigUint64(96, true),
    totalPaid: dv.getBigUint64(104, true),
    bump: data[112]!,
  };
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Explorer URL for a tx signature or address on the configured cluster. */
export function explorerUrl(kind: "tx" | "address", value: string, cluster = "devnet"): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind === "tx" ? "tx" : "address"}/${value}${suffix}`;
}
