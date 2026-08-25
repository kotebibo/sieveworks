/**
 * PaymentRail — the seam between verification and settlement (spec §9).
 *
 * The verification pipeline never talks to a chain directly; it calls a
 * PaymentRail. Today the only active rail is OffChain: earnings accrue in
 * Postgres exactly as they do now, and finds are recorded off-chain. The
 * OnChain rail (Anchor program: record_find + claim vouchers) is written but
 * DISABLED until the program is deployed and PAYMENT_RAIL=onchain — swapping
 * settlement is config, not a rewrite.
 */

export interface FindAttribution {
  jobId: string;
  seed: string; // u64 decimal
  score: string; // i64 decimal
  finderWallet: string;
}

export interface PaymentRail {
  readonly kind: "offchain" | "onchain";
  /** Attribute a verified record. Returns a tx signature when on-chain. */
  recordFind(find: FindAttribution): Promise<{ txSignature: string | null }>;
}

/** Default rail: attribution lives in the `finds` table (written by the
 * pipeline); nothing hits a chain. tx_signature stays null until on-chain. */
export class OffChainRail implements PaymentRail {
  readonly kind = "offchain" as const;
  async recordFind(_find: FindAttribution): Promise<{ txSignature: string | null }> {
    return { txSignature: null };
  }
}

/**
 * On-chain rail — calls the deployed Anchor program's record_find and settles
 * claims. Intentionally throws until wired: it must not be selectable before
 * the program is deployed and reviewed. Deployment is gated on explicit
 * approval, so this stays dormant.
 */
export class OnChainRail implements PaymentRail {
  readonly kind = "onchain" as const;
  async recordFind(_find: FindAttribution): Promise<{ txSignature: string | null }> {
    throw new Error("OnChainRail not enabled: Anchor program is written but not deployed");
  }
}

export function createPaymentRail(): PaymentRail {
  return process.env.PAYMENT_RAIL === "onchain" ? new OnChainRail() : new OffChainRail();
}
