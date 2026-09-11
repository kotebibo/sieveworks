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
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
// The program's fixed coordinator authority (const COORDINATOR_AUTHORITY in
// lib.rs) — co-signs unstake and signs the training fraud-proof instructions.
export const COORDINATOR_AUTHORITY = new PublicKey("5FBPoodnH48YbYeLEcahFjxXWWhiX5nUJ8yJry4aMKhE");

// sha256("global:<name>")[0..8] — precomputed, see header comment.
const DISC = {
  initialize_job: Uint8Array.from([137, 22, 138, 41, 76, 208, 114, 50]),
  record_find: Uint8Array.from([247, 136, 26, 112, 14, 245, 169, 83]),
  claim: Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]),
  close_job: Uint8Array.from([90, 100, 180, 200, 200, 163, 120, 182]),
  stake: Uint8Array.from([206, 176, 202, 18, 200, 209, 179, 108]),
  unstake: Uint8Array.from([90, 95, 107, 42, 205, 124, 50, 225]),
  slash: Uint8Array.from([204, 141, 18, 161, 8, 177, 92, 142]),
  init_lineage: Uint8Array.from([205, 230, 211, 243, 126, 112, 255, 192]),
  assert_chunk: Uint8Array.from([98, 80, 183, 254, 206, 234, 181, 205]),
  confirm_chunk: Uint8Array.from([202, 181, 5, 173, 160, 249, 99, 250]),
  reject_chunk: Uint8Array.from([188, 58, 243, 81, 154, 155, 226, 212]),
} as const;

// sha256("account:<Name>")[0..8] — Anchor account data starts with this.
const JOB_ESCROW_DISC = Uint8Array.from([189, 224, 160, 70, 105, 78, 115, 151]);
const TRAINING_LINEAGE_DISC = Uint8Array.from([218, 39, 249, 250, 125, 123, 89, 141]);
const CHUNK_ASSERTION_DISC = Uint8Array.from([151, 191, 219, 101, 249, 75, 60, 101]);

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

export function lineagePda(jobId: Uint8Array, lineageIdx: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lin"), Buffer.from(jobId), Buffer.from(u32le(lineageIdx))],
    PROGRAM_ID
  )[0];
}

export function assertionPda(jobId: Uint8Array, lineageIdx: number, genStart: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("assert"), Buffer.from(jobId), Buffer.from(u32le(lineageIdx)), Buffer.from(u64le(genStart))],
    PROGRAM_ID
  )[0];
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

function u32le(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function u16le(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`u16 out of range: ${v}`);
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
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

/** Close a job's escrow: returns EVERY remaining lamport to the funder.
 * Requires BOTH the funder and the coordinator as signers (program upgrade
 * 2026-09: the coordinator co-signs only when its books say the job is
 * settled — a prize funder can no longer sweep the pot mid-competition).
 * Account order mirrors the CloseJob struct: funder, coordinator, escrow. */
export function closeJobIx(args: {
  jobUuid: string;
  funder: PublicKey;
  coordinator: PublicKey;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.funder, isSigner: true, isWritable: true },
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: jobEscrowPda(jobId), isSigner: false, isWritable: true },
    ],
    data: concat(DISC.close_job, jobId),
  });
}

/** Stake a worker bond (one global account per worker; top-ups add to it).
 * init_if_needed on the program side, so the first call creates it. */
export function stakeIx(args: { worker: PublicKey; amountLamports: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.worker, isSigner: true, isWritable: true },
      { pubkey: stakePda(args.worker), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(DISC.stake, u64le(args.amountLamports)),
  });
}

/** Withdraw the whole bond. Requires BOTH the worker and the coordinator as
 * signers (program upgrade 2026-09, the unstake-lock): the coordinator only
 * co-signs when its books show no outstanding lease/challenge, so a caught
 * cheat can't pull the bond ahead of a slash. The cooldown still applies.
 * Account order mirrors the Unstake struct: worker, coordinator, stake PDA. */
export function unstakeIx(args: { worker: PublicKey; coordinator: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.worker, isSigner: true, isWritable: true },
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: stakePda(args.worker), isSigner: false, isWritable: true },
    ],
    data: concat(DISC.unstake),
  });
}

/** Slash a caught cheat's bond — BURNED to the incinerator, never to us or
 * the funder (see the program comment). Coordinator-signed; job context only
 * supplies the coordinator-authority check. */
export function slashIx(args: {
  jobUuid: string;
  coordinator: PublicKey;
  worker: PublicKey;
  amountLamports: bigint;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: jobEscrowPda(jobId), isSigner: false, isWritable: false },
      { pubkey: stakePda(args.worker), isSigner: false, isWritable: true },
      { pubkey: INCINERATOR, isSigner: false, isWritable: true },
    ],
    data: concat(DISC.slash, jobId, u64le(args.amountLamports)),
  });
}

// ---------------------------------------------------------------------------
// Training fraud-proof scaffold (Spec 03b, Tier 1). The coordinator is the
// fixed authority for all four; assert_chunk additionally needs the worker.
// ---------------------------------------------------------------------------

/** Coordinator seeds a lineage's on-chain origin anchor (digest of init_state). */
export function initLineageIx(args: {
  jobUuid: string;
  lineageIdx: number;
  originDigest: Uint8Array; // 16 bytes
  coordinator: PublicKey;
}): TransactionInstruction {
  if (args.originDigest.length !== 16) throw new Error("originDigest must be 16 bytes");
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: true },
      { pubkey: lineagePda(jobId, args.lineageIdx), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(DISC.init_lineage, jobId, u32le(args.lineageIdx), args.originDigest),
  });
}

/** Coordinator asserts a worker's completed chunk on-chain (coordinator signs +
 * pays rent; `asserter` = the worker's payout wallet, the slash target). The
 * program enforces d_start == the lineage anchor (no forged origin). */
export function assertChunkIx(args: {
  jobUuid: string;
  lineageIdx: number;
  genStart: bigint;
  asserter: PublicKey;
  merkleRoot: Uint8Array; // 32 bytes
  dStart: Uint8Array; // 16 bytes
  dEnd: Uint8Array; // 16 bytes
  nBuckets: number;
  windowSlots: bigint;
  coordinator: PublicKey;
}): TransactionInstruction {
  if (args.merkleRoot.length !== 32) throw new Error("merkleRoot must be 32 bytes");
  if (args.dStart.length !== 16 || args.dEnd.length !== 16) throw new Error("digests must be 16 bytes");
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: true },
      { pubkey: lineagePda(jobId, args.lineageIdx), isSigner: false, isWritable: false },
      { pubkey: assertionPda(jobId, args.lineageIdx, args.genStart), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      DISC.assert_chunk, jobId, u32le(args.lineageIdx), u64le(args.genStart),
      args.asserter.toBuffer(), args.merkleRoot, args.dStart, args.dEnd,
      u16le(args.nBuckets), u64le(args.windowSlots)
    ),
  });
}

/** Coordinator confirms a chunk after its window: advances the lineage anchor. */
export function confirmChunkIx(args: {
  jobUuid: string;
  lineageIdx: number;
  genStart: bigint;
  coordinator: PublicKey;
}): TransactionInstruction {
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: lineagePda(jobId, args.lineageIdx), isSigner: false, isWritable: true },
      { pubkey: assertionPda(jobId, args.lineageIdx, args.genStart), isSigner: false, isWritable: true },
    ],
    data: concat(DISC.confirm_chunk, jobId, u32le(args.lineageIdx), u64le(args.genStart)),
  });
}

/** Coordinator rejects a proven-fabricated chunk, recording the fraud
 * transcript on-chain (bad_index + provided-start + claimed-true digests). */
export function rejectChunkIx(args: {
  jobUuid: string;
  lineageIdx: number;
  genStart: bigint;
  badIndex: number;
  providedStartDigest: Uint8Array; // 16 bytes
  claimedTrueDigest: Uint8Array; // 16 bytes
  coordinator: PublicKey;
}): TransactionInstruction {
  if (args.providedStartDigest.length !== 16 || args.claimedTrueDigest.length !== 16) {
    throw new Error("digests must be 16 bytes");
  }
  const jobId = uuidToBytes(args.jobUuid);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: args.coordinator, isSigner: true, isWritable: false },
      { pubkey: assertionPda(jobId, args.lineageIdx, args.genStart), isSigner: false, isWritable: true },
    ],
    data: concat(
      DISC.reject_chunk, jobId, u32le(args.lineageIdx), u64le(args.genStart),
      u16le(args.badIndex), args.providedStartDigest, args.claimedTrueDigest
    ),
  });
}

export interface WorkerStakeAccount { worker: PublicKey; amount: bigint; state: number; }
/** Decode a WorkerStake account (8-byte anchor disc, then worker/amount/state). */
export function decodeWorkerStake(data: Uint8Array): WorkerStakeAccount {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    worker: new PublicKey(data.slice(8, 40)),
    amount: dv.getBigUint64(40, true),
    state: data[48]!,
  };
}

export interface TrainingLineageAccount {
  jobId: Uint8Array;
  lineageIdx: number;
  coordinator: PublicKey;
  confirmedStateDigest: Uint8Array; // 16 bytes
  generationsConfirmed: bigint;
  bump: number;
}
/** Decode a TrainingLineage: disc(8) ‖ job_id[16] ‖ idx u32 ‖ coord[32] ‖
 * digest[16] ‖ generations u64 ‖ bump. */
export function decodeTrainingLineage(data: Uint8Array): TrainingLineageAccount {
  for (let i = 0; i < 8; i++) if (data[i] !== TRAINING_LINEAGE_DISC[i]) throw new Error("not a TrainingLineage account");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    jobId: data.slice(8, 24),
    lineageIdx: dv.getUint32(24, true),
    coordinator: new PublicKey(data.slice(28, 60)),
    confirmedStateDigest: data.slice(60, 76),
    generationsConfirmed: dv.getBigUint64(76, true),
    bump: data[84]!,
  };
}

export interface ChunkAssertionAccount {
  jobId: Uint8Array;
  lineageIdx: number;
  genStart: bigint;
  asserter: PublicKey;
  coordinator: PublicKey;
  merkleRoot: Uint8Array; // 32 bytes
  dStart: Uint8Array; // 16 bytes
  dEnd: Uint8Array; // 16 bytes
  nBuckets: number;
  openedSlot: bigint;
  windowSlots: bigint;
  status: number; // 0 Unconfirmed, 1 Confirmed, 2 Rejected
  bump: number;
}
/** Decode a ChunkAssertion. Layout mirrors the #[account] struct field order. */
export function decodeChunkAssertion(data: Uint8Array): ChunkAssertionAccount {
  for (let i = 0; i < 8; i++) if (data[i] !== CHUNK_ASSERTION_DISC[i]) throw new Error("not a ChunkAssertion account");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    jobId: data.slice(8, 24),
    lineageIdx: dv.getUint32(24, true),
    genStart: dv.getBigUint64(28, true),
    asserter: new PublicKey(data.slice(36, 68)),
    coordinator: new PublicKey(data.slice(68, 100)),
    merkleRoot: data.slice(100, 132),
    dStart: data.slice(132, 148),
    dEnd: data.slice(148, 164),
    nBuckets: dv.getUint16(164, true),
    openedSlot: dv.getBigUint64(166, true),
    windowSlots: dv.getBigUint64(174, true),
    status: data[182]!,
    bump: data[183]!,
  };
}
