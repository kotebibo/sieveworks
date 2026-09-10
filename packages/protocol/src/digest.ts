/**
 * Digest-leaf wire mapping (verification modes output_hash / training).
 *
 * The Merkle leaf payload is 16 bytes. In extremum mode they mean
 * (i64 max_score, u64 max_seed); in digest modes they are the first 16
 * bytes of sha256(job_id_bytes ‖ bucket_bytes), carried over the existing
 * wire fields. The score half MUST be read SIGNED (two's complement) —
 * i64String rejects values above I64_MAX, and a random digest half read
 * unsigned exceeds it ~50% of the time. The seed half is read unsigned
 * (u64String accepts the full range). encodeLeaf's setBigInt64/setBigUint64
 * round-trip both exactly.
 */

export interface DigestWire {
  /** i64 decimal string — digest bytes 0..8, signed LE */
  score: string;
  /** u64 decimal string — digest bytes 8..16, unsigned LE */
  seed: string;
}

export function digest16ToWire(digest16: Uint8Array): DigestWire {
  if (digest16.length !== 16) throw new Error(`digest16ToWire: expected 16 bytes, got ${digest16.length}`);
  const view = new DataView(digest16.buffer, digest16.byteOffset, 16);
  return {
    score: view.getBigInt64(0, true).toString(),
    seed: view.getBigUint64(8, true).toString(),
  };
}

export function wireToDigest16(wire: DigestWire): Uint8Array {
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  view.setBigInt64(0, BigInt(wire.score), true);
  view.setBigUint64(8, BigInt(wire.seed), true);
  return out;
}
