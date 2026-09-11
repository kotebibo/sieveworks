import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  PROGRAM_ID,
  claimIx,
  decodeJobEscrow,
  jobEscrowPda,
  recordFindIx,
  uuidToBytes,
  closeJobIx,
  slashIx,
  unstakeIx,
  stakePda,
  decodeWorkerStake,
  initLineageIx,
  assertChunkIx,
  confirmChunkIx,
  rejectChunkIx,
  lineagePda,
  assertionPda,
  decodeTrainingLineage,
  decodeChunkAssertion,
  type JobEscrowAccount,
  type TrainingLineageAccount,
  type ChunkAssertionAccount,
} from "@sieveworks/chain";
import { env } from "./env.js";

/**
 * The coordinator's payment rail. The coordinator holds the authority keypair
 * each job's escrow registers at initialize_job: only this key can attest
 * finds (record_find) and authorize payouts (co-sign claim). Its decisions are
 * all independently re-verifiable off-chain via the audit endpoint — the chain
 * trusts this key because the funder chose to register it, not because the
 * chain verifies the work itself.
 *
 * Everything degrades gracefully: without SOLANA_COORDINATOR_KEYPAIR the rail
 * reports disabled and callers skip chain work (off-chain bookkeeping is the
 * source of truth for accrual either way; the chain settles it).
 */

let connection: Connection | null = null;
let authority: Keypair | null = null;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;
  if (!env.SOLANA_COORDINATOR_KEYPAIR) return;
  try {
    const raw = JSON.parse(env.SOLANA_COORDINATOR_KEYPAIR) as number[];
    authority = Keypair.fromSecretKey(Uint8Array.from(raw));
    connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  } catch (err) {
    console.error("[chain] bad SOLANA_COORDINATOR_KEYPAIR — chain rail disabled:", err);
    authority = null;
    connection = null;
  }
}

export function chainEnabled(): boolean {
  init();
  return authority !== null && connection !== null;
}

export function coordinatorPubkey(): PublicKey | null {
  init();
  return authority?.publicKey ?? null;
}

export function getChainInfo(): {
  enabled: boolean;
  cluster: string;
  program_id: string;
  coordinator: string | null;
} {
  init();
  return {
    enabled: chainEnabled(),
    cluster: env.SOLANA_CLUSTER,
    program_id: PROGRAM_ID.toBase58(),
    coordinator: authority?.publicKey.toBase58() ?? null,
  };
}

/** Fetch and decode a job's escrow PDA, or null if it doesn't exist. */
export async function fetchJobEscrow(jobUuid: string): Promise<JobEscrowAccount | null> {
  init();
  if (!connection) return null;
  const pda = jobEscrowPda(uuidToBytes(jobUuid));
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return decodeJobEscrow(new Uint8Array(info.data));
}

/** Attest a verified record on-chain. Returns the tx signature, or null when
 * the rail is disabled. Throws on chain errors — callers decide the policy
 * (verification treats it as retryable-later and never blocks the pipeline). */
export async function attestFind(args: {
  jobUuid: string;
  seed: bigint;
  score: bigint;
  finder: string; // base58 wallet
}): Promise<string | null> {
  init();
  if (!connection || !authority) return null;
  const ix = recordFindIx({
    jobUuid: args.jobUuid,
    coordinator: authority.publicKey,
    seed: args.seed,
    score: args.score,
    finder: new PublicKey(args.finder),
  });
  const tx = new Transaction().add(ix);
  return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

/** Co-sign and submit a worker's claim transaction. The worker built and
 * partially signed `serialized`; we verify its contents upstream (routes) —
 * here we only add the authority signature and send. */
export async function coSignAndSendClaim(serialized: Uint8Array): Promise<string> {
  init();
  if (!connection || !authority) throw new Error("chain rail disabled");
  const tx = Transaction.from(serialized);
  tx.partialSign(authority);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Build the close_job instruction we EXPECT — byte-exact verification
 * before co-signing a funder's escrow reclaim (program requires both). */
export function expectedCloseIx(args: { jobUuid: string; funder: string }) {
  init();
  if (!authority) throw new Error("chain rail disabled");
  return closeJobIx({
    jobUuid: args.jobUuid,
    funder: new PublicKey(args.funder),
    coordinator: authority.publicKey,
  });
}

/** Build the claim instruction we EXPECT for a voucher — used to verify the
 * worker-submitted transaction byte-for-byte before co-signing. */
export function expectedClaimIx(args: {
  jobUuid: string;
  worker: string;
  cumulativeLamports: bigint;
  nonce: bigint;
}) {
  init();
  if (!authority) throw new Error("chain rail disabled");
  return claimIx({
    jobUuid: args.jobUuid,
    worker: new PublicKey(args.worker),
    coordinator: authority.publicKey,
    cumulativeLamports: args.cumulativeLamports,
    nonce: args.nonce,
  });
}

/** Co-sign and submit a worker's unstake transaction. Same mechanism as a
 * claim (verify upstream, add the authority signature, send) — the route only
 * calls this once its books confirm the worker has no outstanding work. */
export async function coSignAndSendUnstake(serialized: Uint8Array): Promise<string> {
  return coSignAndSendClaim(serialized);
}

/** Build the unstake instruction we EXPECT — byte-exact check before co-signing
 * a bond withdrawal (program now requires the coordinator as co-signer). */
export function expectedUnstakeIx(args: { worker: string }) {
  init();
  if (!authority) throw new Error("chain rail disabled");
  return unstakeIx({ worker: new PublicKey(args.worker), coordinator: authority.publicKey });
}

/** Read a worker's on-chain stake (active bond amount + state). Returns null
 * when the account doesn't exist (never staked) or the chain rail is off. */
export async function fetchStake(worker: string): Promise<{ amount: bigint; state: number } | null> {
  init();
  if (!connection) return null;
  try {
    const acc = await connection.getAccountInfo(stakePda(new PublicKey(worker)));
    if (!acc) return null;
    const s = decodeWorkerStake(new Uint8Array(acc.data));
    return { amount: s.amount, state: s.state };
  } catch {
    return null;
  }
}

/** Burn a caught cheat's bond (coordinator-signed slash → incinerator). Fire
 * safely: any failure is logged, never throws into the pipeline. */
export async function slashStake(jobUuid: string, worker: string, amountLamports: bigint): Promise<string | null> {
  init();
  if (!connection || !authority) return null;
  try {
    const ix = slashIx({ jobUuid, coordinator: authority.publicKey, worker: new PublicKey(worker), amountLamports });
    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  } catch (err) {
    console.error(`[chain] slash failed for ${worker}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Training fraud-proof rail (Spec 03b, Tier 1). The coordinator (holding the
// authority key) drives all four instructions. assert/confirm/reject THROW on
// failure so the caller can react per-chunk; fetch* return null when absent.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Seed a lineage's on-chain origin anchor (once per lineage at funding).
 * Fire-safe: idempotent-ish (a second init fails cleanly if it already exists),
 * so it logs and returns null rather than throwing into job creation. */
export async function initLineageChain(jobUuid: string, lineageIdx: number, originDigest: Uint8Array): Promise<string | null> {
  init();
  if (!connection || !authority) return null;
  try {
    const ix = initLineageIx({ jobUuid, lineageIdx, originDigest, coordinator: authority.publicKey });
    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  } catch (err) {
    console.error(`[chain] init_lineage failed (${jobUuid}#${lineageIdx}):`, err);
    return null;
  }
}

/** Assert a delivered chunk on-chain (enters the challenge window). Throws on
 * failure — the caller decides whether the chunk can proceed. */
export async function assertChunkChain(args: {
  jobUuid: string; lineageIdx: number; genStart: bigint; asserter: string;
  merkleRoot: Uint8Array; dStart: Uint8Array; dEnd: Uint8Array; nBuckets: number; windowSlots: bigint;
}): Promise<string> {
  init();
  if (!connection || !authority) throw new Error("chain rail disabled");
  const ix = assertChunkIx({
    jobUuid: args.jobUuid, lineageIdx: args.lineageIdx, genStart: args.genStart,
    asserter: new PublicKey(args.asserter), merkleRoot: args.merkleRoot,
    dStart: args.dStart, dEnd: args.dEnd, nBuckets: args.nBuckets, windowSlots: args.windowSlots,
    coordinator: authority.publicKey,
  });
  const tx = new Transaction().add(ix);
  return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

/** Confirm a chunk after its window (advances the lineage anchor). Throws on
 * failure (e.g. WindowNotElapsed) so the sweep can retry later. */
export async function confirmChunkChain(jobUuid: string, lineageIdx: number, genStart: bigint): Promise<string> {
  init();
  if (!connection || !authority) throw new Error("chain rail disabled");
  const ix = confirmChunkIx({ jobUuid, lineageIdx, genStart, coordinator: authority.publicKey });
  const tx = new Transaction().add(ix);
  return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

/** Reject a proven-fabricated chunk, recording the fraud transcript on-chain. */
export async function rejectChunkChain(args: {
  jobUuid: string; lineageIdx: number; genStart: bigint; badIndex: number;
  providedStartDigest: Uint8Array; claimedTrueDigest: Uint8Array;
}): Promise<string> {
  init();
  if (!connection || !authority) throw new Error("chain rail disabled");
  const ix = rejectChunkIx({ ...args, coordinator: authority.publicKey });
  const tx = new Transaction().add(ix);
  return await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

/** Current confirmed slot, or null if the rail is off. Used to decide whether
 * a chunk's challenge window has elapsed before attempting confirm. */
export async function currentSlot(): Promise<number | null> {
  init();
  if (!connection) return null;
  try { return await connection.getSlot("confirmed"); } catch { return null; }
}

export async function fetchLineageAnchor(jobUuid: string, lineageIdx: number): Promise<TrainingLineageAccount | null> {
  init();
  if (!connection || !UUID_RE.test(jobUuid)) return null;
  try {
    const acc = await connection.getAccountInfo(lineagePda(uuidToBytes(jobUuid), lineageIdx));
    return acc ? decodeTrainingLineage(new Uint8Array(acc.data)) : null;
  } catch { return null; }
}

export async function fetchAssertion(jobUuid: string, lineageIdx: number, genStart: bigint): Promise<ChunkAssertionAccount | null> {
  init();
  if (!connection || !UUID_RE.test(jobUuid)) return null;
  try {
    const acc = await connection.getAccountInfo(assertionPda(uuidToBytes(jobUuid), lineageIdx, genStart));
    return acc ? decodeChunkAssertion(new Uint8Array(acc.data)) : null;
  } catch { return null; }
}
