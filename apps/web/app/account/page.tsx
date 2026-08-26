"use client";

import { useEffect, useState } from "react";
import { fetchMe, fetchNotifications, updateMe, type Me, type Notification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Mono } from "@/components/ui";

const PREFS: [string, string][] = [
  ["records", "When I set a new record"],
  ["bounty_complete", "When a bounty I posted completes"],
  ["verified", "When my submissions are verified (noisy)"],
];

export default function Account() {
  const { authed, token, wallet, signIn, signingIn, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchMe(token).then((m) => {
      setMe(m);
      setEmail(m.user.email ?? "");
      setPrefs(m.user.notify_prefs ?? {});
    }).catch(() => {});
    fetchNotifications(token).then((r) => setNotes(r.notifications)).catch(() => {});
  }, [token]);

  if (!authed) {
    return (
      <div className="mx-auto max-w-[720px] px-5 sm:px-7 py-16 text-center">
        <h1 className="font-display text-xl font-bold">Account</h1>
        <p className="mt-2 text-sm text-[var(--text-dim)]">Sign in with your wallet to manage your account.</p>
        <button onClick={signIn} disabled={signingIn}
          className="mt-4 font-medium text-[14px] px-5 py-2.5 text-[var(--bg)]" style={{ background: "var(--accent)" }}>
          {wallet ? (signingIn ? "signing…" : "Sign in") : "Connect wallet"}
        </button>
      </div>
    );
  }

  const save = async () => {
    if (!token) return;
    await updateMe(token, { email: email || null, notify_prefs: prefs });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-[720px] px-5 sm:px-7 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight">Account</h1>
        <button onClick={signOut} className="num text-xs px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--rejected)] hover:border-[var(--rejected)]">sign out</button>
      </div>
      <p className="num mt-1 text-xs text-[var(--text-dim)]">
        signed in as <Mono value={wallet!} kind="address" head={6} tail={6} />
      </p>

      <section className="panel ticked p-4 mt-6">
        <div className="barlabel mb-3">Email notifications (optional)</div>
        <p className="text-[13px] text-[var(--text-dim)] mb-3">
          Add an email and we'll notify you about the events below. Your wallet stays your login —
          the email is only a contact channel.
        </p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="w-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-sm" />
        <div className="mt-3 space-y-2">
          {PREFS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
              <input type="checkbox" checked={prefs[k] !== false} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })}
                className="accent-[var(--accent)]" disabled={!email} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} className="font-medium text-[13px] px-4 py-2 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Save</button>
          {saved && <span className="num text-xs" style={{ color: "var(--verified)" }}>saved ✓</span>}
        </div>
      </section>

      <section className="panel mt-4">
        <div className="border-b border-[var(--border)] px-4 py-2 barlabel">Notifications</div>
        <ul className="divide-y divide-[var(--border)]">
          {notes.length === 0 && <li className="px-4 py-3 text-xs text-[var(--text-faint)]">nothing yet</li>}
          {notes.map((n) => (
            <li key={n.id} className="px-4 py-2.5">
              <a href={n.link ?? "#"} className="block">
                <div className="text-[13px] font-medium">{n.title}</div>
                {n.body && <div className="text-[12px] text-[var(--text-dim)] mt-0.5">{n.body}</div>}
                <div className="num text-[10px] text-[var(--text-faint)] mt-1">{n.created_at.slice(0, 19).replace("T", " ")}</div>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
