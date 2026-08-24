import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signResult, verifyResultSignature, walletFromSecretKey } from "../src/index.js";

const unsigned = {
  chunk_id: "3b2417cc-5c3f-4a3b-9d6e-2f24d1c0a111",
  worker_spec_hash: "a".repeat(64),
  extremum_score: "23",
  witness_seed: "77777",
  merkle_root: "b".repeat(64),
  buckets_count: 96,
  seeds_evaluated: "98304",
  duration_ms: 30150,
  nonce: "0123456789abcdef",
};

describe("result signing", () => {
  it("round-trips: sign with secret, verify with wallet address", () => {
    const secret = Uint8Array.from(randomBytes(32));
    const wallet = walletFromSecretKey(secret);
    const signature = signResult(unsigned, secret);
    expect(verifyResultSignature({ ...unsigned, signature }, wallet)).toBe(true);
  });

  it("rejects a tampered field, wrong wallet, and 64-byte key mismatch", () => {
    const secret = Uint8Array.from(randomBytes(32));
    const wallet = walletFromSecretKey(secret);
    const signature = signResult(unsigned, secret);
    expect(
      verifyResultSignature({ ...unsigned, extremum_score: "24", signature }, wallet)
    ).toBe(false);
    const other = walletFromSecretKey(Uint8Array.from(randomBytes(32)));
    expect(verifyResultSignature({ ...unsigned, signature }, other)).toBe(false);
    expect(verifyResultSignature({ ...unsigned, signature }, "not-base58!!!")).toBe(false);
  });
});
