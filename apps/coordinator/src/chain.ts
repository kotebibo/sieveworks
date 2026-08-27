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
  type JobEscrowAccount,
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
