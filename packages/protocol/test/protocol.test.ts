import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  ChunkAssignment,
  i64String,
  ResultSubmission,
  resultSigningBytes,
  u64String,
} from "../src/index.js";

describe("canonicalJson", () => {
  it("sorts keys and strips whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: "x", c: [2, 3] } })).toBe(
      '{"a":{"c":[2,3],"d":"x"},"b":1}'
    );
  });

  it("drops undefined object values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects floats, NaN, and unsafe integers", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: 2 ** 53 })).toThrow();
  });

  it("is stable regardless of insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("numeric codecs", () => {
  it("u64String accepts bounds and rejects overflow/leading zeros/negatives", () => {
    expect(u64String.safeParse("0").success).toBe(true);
    expect(u64String.safeParse("18446744073709551615").success).toBe(true);
    expect(u64String.safeParse("18446744073709551616").success).toBe(false);
    expect(u64String.safeParse("01").success).toBe(false);
    expect(u64String.safeParse("-1").success).toBe(false);
  });

  it("i64String accepts bounds and rejects -0 and overflow", () => {
    expect(i64String.safeParse("-9223372036854775808").success).toBe(true);
    expect(i64String.safeParse("9223372036854775807").success).toBe(true);
    expect(i64String.safeParse("9223372036854775808").success).toBe(false);
    expect(i64String.safeParse("-0").success).toBe(false);
  });
});

const validAssignment = {
  chunk_id: "3b2417cc-5c3f-4a3b-9d6e-2f24d1c0a111",
  job_id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  worker_spec_hash: "a".repeat(64),
  range_start: "0",
  range_end: "1048576",
  bucket_size: 1024,
  params: { version_pin: "1.21.1" },
  lease_expires_at: "2026-08-24T12:00:00Z",
  nonce: "0123456789abcdef",
};

describe("ChunkAssignment", () => {
  it("parses a valid assignment", () => {
    expect(ChunkAssignment.safeParse(validAssignment).success).toBe(true);
  });

  it("REQUIRES bucket_size — no silent default", () => {
    const { bucket_size, ...rest } = validAssignment;
    expect(ChunkAssignment.safeParse(rest).success).toBe(false);
  });

  it("rejects empty or inverted ranges", () => {
    expect(
      ChunkAssignment.safeParse({ ...validAssignment, range_end: "0" }).success
    ).toBe(false);
  });
});

describe("ResultSubmission signing bytes", () => {
  const submission = {
    chunk_id: validAssignment.chunk_id,
    worker_spec_hash: validAssignment.worker_spec_hash,
    extremum_score: "23",
    witness_seed: "77777",
    merkle_root: "b".repeat(64),
    buckets_count: 1024,
    seeds_evaluated: "1048576",
    duration_ms: 4200,
    nonce: validAssignment.nonce,
  };

  it("validates with a signature attached", () => {
    const parsed = ResultSubmission.safeParse({ ...submission, signature: "1".repeat(88) });
    expect(parsed.success).toBe(true);
  });

  it("signing bytes exclude the signature and are order-independent", () => {
    const a = resultSigningBytes(submission);
    const reordered = Object.fromEntries(Object.entries(submission).reverse());
    const b = resultSigningBytes(reordered as typeof submission);
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
    expect(Buffer.from(a).toString()).not.toContain("signature");
  });
});
