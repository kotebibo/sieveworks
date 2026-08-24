import { describe, expect, it } from "vitest";
import {
  type BucketLeaf,
  encodeLeaf,
  hashLeaf,
  merkleProof,
  merkleRoot,
  toHex,
  verifyProof,
} from "../src/index.js";

function makeLeaves(n: number): BucketLeaf[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    maxScore: BigInt(i * 7 - 3), // exercises negative i64 scores
    maxSeed: (1n << 40n) + BigInt(i) * 1_000_003n,
  }));
}

describe("leaf encoding", () => {
  it("is the fixed 21-byte layout: prefix ‖ u32 LE ‖ i64 LE ‖ u64 LE", () => {
    const bytes = encodeLeaf({ index: 1, maxScore: -2n, maxSeed: 3n });
    expect(bytes.length).toBe(21);
    expect(bytes[0]).toBe(0x00);
    expect([...bytes.slice(1, 5)]).toEqual([1, 0, 0, 0]);
    expect([...bytes.slice(5, 13)]).toEqual([254, 255, 255, 255, 255, 255, 255, 255]);
    expect([...bytes.slice(13)]).toEqual([3, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("rejects out-of-range indices", () => {
    expect(() => encodeLeaf({ index: -1, maxScore: 0n, maxSeed: 0n })).toThrow();
    expect(() => encodeLeaf({ index: 2 ** 32, maxScore: 0n, maxSeed: 0n })).toThrow();
  });
});

describe("root + proofs", () => {
  for (const n of [1, 2, 3, 5, 8, 1000, 1025]) {
    it(`every proof verifies for ${n} leaves (including odd shapes)`, () => {
      const leaves = makeLeaves(n);
      const hashes = leaves.map(hashLeaf);
      const root = merkleRoot(hashes);
      const sample = n <= 8 ? leaves : [leaves[0]!, leaves[511]!, leaves[n - 1]!];
      for (const leaf of sample) {
        const proof = merkleProof(hashes, leaf.index);
        expect(verifyProof(leaf, proof, n, root)).toBe(true);
      }
    });
  }

  it("rejects a tampered score, seed, index, and trailing-junk proofs", () => {
    const leaves = makeLeaves(8);
    const hashes = leaves.map(hashLeaf);
    const root = merkleRoot(hashes);
    const proof = merkleProof(hashes, 3);
    const leaf = leaves[3]!;
    expect(verifyProof({ ...leaf, maxScore: leaf.maxScore + 1n }, proof, 8, root)).toBe(false);
    expect(verifyProof({ ...leaf, maxSeed: leaf.maxSeed + 1n }, proof, 8, root)).toBe(false);
    expect(verifyProof({ ...leaf, index: 4 }, proof, 8, root)).toBe(false);
    expect(verifyProof(leaf, [...proof, proof[0]!], 8, root)).toBe(false);
  });

  it("root is stable — fixed vector guards the encoding forever", () => {
    const root = merkleRoot(makeLeaves(4).map(hashLeaf));
    // If this vector ever changes, worker and coordinator have diverged.
    expect(toHex(root)).toMatchSnapshot();
  });

  it("throws on zero leaves", () => {
    expect(() => merkleRoot([])).toThrow();
  });
});
