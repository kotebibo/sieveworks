import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyWalletSignature } from "@sieveworks/protocol";
import { sql } from "./db.js";
import { env } from "./env.js";

/**
 * Wallet-native auth (Sign-In With Solana). Identity IS the wallet; "logging
 * in" means signing a server nonce — free, off-chain, no transaction. On
 * success we mint a short JWT session so the user doesn't re-sign per action.
 * The worker protocol is separate: workers sign each submission statelessly
 * and never log in.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_S = 24 * 60 * 60;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Sign-In With Solana requires the first line to name the requesting *origin*
 * (host[:port]), and the wallet refuses to sign unless it matches the page's
 * own origin. The client sends its host; we allow only our own origins and fall
 * back to the canonical one, so a caller can never inject an arbitrary domain
 * into the signed message. */
export function safeDomain(domain?: string): string {
  if (
    domain &&
    domain.length <= 100 &&
    (/^localhost(:\d+)?$/.test(domain) ||
      /^(?:[a-z0-9-]+\.)*sievework\.com$/.test(domain) ||
      /^[a-z0-9-]+\.vercel\.app$/.test(domain))
  ) {
    return domain;
  }
  return "www.sievework.com";
}

/** The exact human-readable message the wallet signs. Domain + nonce + time
 * bind it against phishing and replay. */
export function signInMessage(domain: string, wallet: string, nonce: string, issuedAt: string): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to Sieveworks. This request will not trigger a transaction or cost any fees.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export async function issueNonce(wallet: string, domain?: string): Promise<{ nonce: string; message: string } | null> {
  if (!base58.test(wallet)) return null;
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = signInMessage(safeDomain(domain), wallet, nonce, issuedAt);
  const expires = new Date(Date.now() + NONCE_TTL_MS).toISOString();
  await sql`
    insert into auth_nonces (wallet, nonce, expires_at) values (${wallet}, ${nonce}, ${expires})
    on conflict (wallet) do update set nonce = excluded.nonce, expires_at = excluded.expires_at`;
  return { nonce, message };
}

/** Verify a signature over the given message and that the message carries the
 * expected wallet + a live nonce. Returns a session JWT on success. */
export async function completeSignIn(wallet: string, message: string, signature: string): Promise<string | null> {
  if (!base58.test(wallet)) return null;
  const [row] = await sql<{ nonce: string; expires_at: string }[]>`
    select nonce, expires_at from auth_nonces where wallet = ${wallet}`;
  if (!row || new Date(row.expires_at) < new Date()) return null;
  if (!message.includes(`Nonce: ${row.nonce}`) || !message.includes(wallet)) return null;
  if (!verifyWalletSignature(message, signature, wallet)) return null;
  await sql`delete from auth_nonces where wallet = ${wallet}`; // one-time
  // ensure a user row exists
  await sql`
    insert into users (wallet_address) values (${wallet})
    on conflict (wallet_address) do nothing`;
  return signSession(wallet);
}

// ---- minimal HS256 JWT (no external dep) ----
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
export function signSession(wallet: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ sub: wallet, iat: now, exp: now + SESSION_TTL_S }));
  const sig = b64url(createHmac("sha256", env.AUTH_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}
export function verifySession(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  const expected = b64url(createHmac("sha256", env.AUTH_SECRET).update(`${h}.${b}`).digest());
  const a = Buffer.from(s), e = Buffer.from(expected);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as { sub: string; exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Extract the authenticated wallet from the Authorization header, or null. */
export function authedWallet(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return verifySession(h.slice(7));
}

/** Guard: 401 unless a valid session. Returns the wallet, or sends 401. */
export function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  const wallet = authedWallet(req);
  if (!wallet) {
    reply.code(401).send({ error: "sign in required" });
    return null;
  }
  return wallet;
}
