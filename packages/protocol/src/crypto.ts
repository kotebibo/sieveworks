import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { resultSigningBytes, type ResultSubmission } from "./schemas.js";

/**
 * Worker identity = Solana wallet. The wallet_address IS the base58 ed25519
 * public key; every submission is signed over resultSigningBytes (canonical
 * JSON, signature field excluded). No sessions, no tokens.
 */

export type UnsignedResult = Omit<ResultSubmission, "signature">;

/** Sign with a 64-byte Solana secret key (seed ‖ pubkey) or a 32-byte seed. */
export function signResult(unsigned: UnsignedResult, secretKey: Uint8Array): string {
  const seed = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey;
  return bs58.encode(ed25519.sign(resultSigningBytes(unsigned), seed));
}

export function verifyResultSignature(submission: ResultSubmission, walletAddress: string): boolean {
  try {
    const pubkey = bs58.decode(walletAddress);
    if (pubkey.length !== 32) return false;
    const { signature, ...unsigned } = submission;
    return ed25519.verify(bs58.decode(signature), resultSigningBytes(unsigned), pubkey);
  } catch {
    return false;
  }
}

export function walletFromSecretKey(secretKey: Uint8Array): string {
  const seed = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey;
  return bs58.encode(ed25519.getPublicKey(seed));
}

/** Verify an arbitrary UTF-8 message was signed by a wallet — the primitive
 * behind Sign-In With Solana. Signing a message is free and off-chain. */
export function signMessage(message: string, secretKey: Uint8Array): string {
  const seed = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey;
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), seed));
}

export function verifyWalletSignature(message: string, signatureBase58: string, walletAddress: string): boolean {
  try {
    const pubkey = bs58.decode(walletAddress);
    if (pubkey.length !== 32) return false;
    return ed25519.verify(bs58.decode(signatureBase58), new TextEncoder().encode(message), pubkey);
  } catch {
    return false;
  }
}
