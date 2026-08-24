import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Merkle commitment over per-bucket extrema. Shared verbatim by workers
 * (browser + CLI) and the coordinator so roots can never drift.
 *
 * Leaf  = sha256(0x00 ‖ u32 LE bucket_index ‖ i64 LE max_score ‖ u64 LE max_seed)
 * Node  = sha256(0x01 ‖ left ‖ right)
 * An odd node at the end of a level is promoted unchanged (no duplication).
 * Domain-separation prefixes prevent leaf/node second-preimage confusion.
 *
 * Hashing uses a fixed binary layout — never JSON — so formatting can't
 * affect the root. Scores are i64 by protocol rule; exact bytes, no floats.
 */

export interface BucketLeaf {
  index: number; // u32 bucket index within the chunk
  maxScore: bigint; // i64
  maxSeed: bigint; // u64
}

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

export function encodeLeaf(leaf: BucketLeaf): Uint8Array {
  if (!Number.isInteger(leaf.index) || leaf.index < 0 || leaf.index > 0xffffffff) {
    throw new Error(`leaf index out of u32 range: ${leaf.index}`);
  }
  const buf = new ArrayBuffer(21);
  const view = new DataView(buf);
  view.setUint8(0, LEAF_PREFIX);
  view.setUint32(1, leaf.index, true);
  view.setBigInt64(5, leaf.maxScore, true);
  view.setBigUint64(13, leaf.maxSeed, true);
  return new Uint8Array(buf);
}

export function hashLeaf(leaf: BucketLeaf): Uint8Array {
  return sha256(encodeLeaf(leaf));
}

function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + 64);
  buf[0] = NODE_PREFIX;
  buf.set(left, 1);
  buf.set(right, 33);
  return sha256(buf);
}

/** Root over leaf hashes. Throws on zero leaves — an empty chunk is invalid. */
export function merkleRoot(leafHashes: Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) throw new Error("merkleRoot: no leaves");
  let level = leafHashes;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(hashNode(level[i]!, level[i + 1]!));
    }
    if (level.length % 2 === 1) next.push(level[level.length - 1]!);
    level = next;
  }
  return level[0]!;
}

/** Sibling hashes leaf→root for leafHashes[index]. Levels where the node is a
 * promoted odd tail contribute no sibling — verification derives the shape
 * from (index, leafCount), so the proof is just the hashes. */
export function merkleProof(leafHashes: Uint8Array[], index: number): Uint8Array[] {
  if (index < 0 || index >= leafHashes.length) throw new Error("proof index out of range");
  const proof: Uint8Array[] = [];
  let level = leafHashes;
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    const next: Uint8Array[] = [];
    for (let j = 0; j + 1 < level.length; j += 2) {
      next.push(hashNode(level[j]!, level[j + 1]!));
    }
    if (level.length % 2 === 1) next.push(level[level.length - 1]!);
    i = Math.floor(i / 2);
    level = next;
  }
  return proof;
}

/** Recompute the root from one leaf + proof; compare against the committed root. */
export function verifyProof(
  leaf: BucketLeaf,
  proof: Uint8Array[],
  leafCount: number,
  expectedRoot: Uint8Array
): boolean {
  if (leaf.index < 0 || leaf.index >= leafCount) return false;
  let hash = hashLeaf(leaf);
  let i = leaf.index;
  let width = leafCount;
  let p = 0;
  while (width > 1) {
    const isOddTail = i === width - 1 && width % 2 === 1;
    if (!isOddTail) {
      const sibling = proof[p++];
      if (!sibling) return false;
      hash = i % 2 === 0 ? hashNode(hash, sibling) : hashNode(sibling, hash);
    }
    i = Math.floor(i / 2);
    width = Math.ceil(width / 2);
  }
  if (p !== proof.length) return false; // trailing junk in proof is a forgery attempt
  return bytesEqual(hash, expectedRoot);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
