import { sql } from "./db.js";
import { env } from "./env.js";

/**
 * Notifications: an in-app feed row is written for every event; if the
 * recipient has added an email and enabled that notification type, we also
 * send an email. Email delivery is behind a sender interface — a no-op logger
 * by default, Resend when RESEND_API_KEY is set — so delivery is one env var,
 * not a rewrite (same pattern as PaymentRail).
 */

export type NotifyKind = "record_found" | "bounty_complete" | "verified" | "module_registered";

interface EmailSender {
  readonly kind: string;
  send(to: string, subject: string, text: string): Promise<void>;
}

class LogSender implements EmailSender {
  readonly kind = "log";
  async send(to: string, subject: string): Promise<void> {
    console.log(`[notify] (no email provider) would send to ${to}: ${subject}`);
  }
}

class ResendSender implements EmailSender {
  readonly kind = "resend";
  constructor(private readonly apiKey: string) {}
  async send(to: string, subject: string, text: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to, subject, text }),
    });
    if (!res.ok) console.error(`[notify] resend failed ${res.status}: ${await res.text()}`);
  }
}

const sender: EmailSender = env.RESEND_API_KEY ? new ResendSender(env.RESEND_API_KEY) : new LogSender();

/** Record a notification for a wallet and email it if opted in. */
export async function notify(
  wallet: string,
  kind: NotifyKind,
  title: string,
  body: string,
  link?: string
): Promise<void> {
  if (!wallet || wallet === "coordinator-admin") return;
  const [n] = await sql<{ id: string }[]>`
    insert into notifications (wallet, kind, title, body, link)
    values (${wallet}, ${kind}, ${title}, ${body ?? null}, ${link ?? null})
    returning id`;

  const prefKey = kind === "record_found" ? "records" : kind === "bounty_complete" ? "bounty_complete" : "verified";
  const [u] = await sql<{ email: string | null; notify_prefs: Record<string, boolean> }[]>`
    select email, notify_prefs from users where wallet_address = ${wallet}`;
  if (u?.email && u.notify_prefs?.[prefKey] !== false) {
    const url = link ? `${env.WEB_URL}${link}` : env.WEB_URL;
    await sender.send(u.email, `Sieveworks: ${title}`, `${body}\n\n${url}`);
    await sql`update notifications set emailed_at = now() where id = ${n!.id}`;
  }
}

export const notifySender = sender.kind;
