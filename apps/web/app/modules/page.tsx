"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { fetchSpecs, setSpecVisibility, uploadSpec, type UploadResult, type WorkerSpec } from "@/lib/api";
import { Mono, fmt } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Modules() {
  const { token, authed } = useAuth();
  const [specs, setSpecs] = useState<WorkerSpec[] | null>(null);
  const [query, setQuery] = useState("");

  const refresh = () => fetchSpecs(token).then((r) => setSpecs(r.specs)).catch(() => setSpecs([]));
  // re-list whenever auth changes so private modules appear/disappear
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const mine = specs?.filter((s) => s.mine) ?? [];
  const builtins = specs?.filter((s) => s.is_builtin) ?? [];
  const community = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (specs ?? [])
      .filter((s) => !s.is_builtin && !s.mine)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || (s.publisher ?? "").toLowerCase().includes(q));
  }, [specs, query]);

  return (
    <div className="mx-auto max-w-[1000px] px-5 sm:px-7 py-12">
      <h1 className="font-display font-extrabold text-[clamp(28px,3.6vw,40px)] leading-[1.04] tracking-[-0.03em]">
        Bring your own search.
      </h1>
      <p className="mt-3 text-[15.5px] text-[var(--text-dim)] max-w-[62ch]">
        A worker module defines what a search means: how to score one candidate in a numeric space.
        It's any WebAssembly module exporting three functions:{" "}
        <span className="num text-[var(--text)]">evaluate_range</span>,{" "}
        <span className="num text-[var(--text)]">evaluate_seed</span>,{" "}
        <span className="num text-[var(--text)]">spec_version</span>. Upload one and the coordinator
        content-hashes it, runs a conformance gate, and it's ready to fund bounties against. Publish it
        for the community, or keep it <span className="text-[var(--text)]">private</span>: visible only to you until you post a bounty with it.
      </p>
      <p className="mt-2.5 text-[13.5px] text-[var(--text-faint)] max-w-[62ch]">
        Work is dealt out in <span className="text-[var(--text-dim)]">chunks</span>: a chunk is a unit
        of compute, a fixed range of candidates one contributor evaluates and gets paid for. Nothing
        game-specific about it.
      </p>

      <UploadPanel onDone={refresh} />

      {/* ---- your modules (only when signed in and you have some) ---- */}
      {authed && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-bold text-[18px] tracking-[-0.02em]">Your modules</h2>
            <span className="barlabel">{mine.length} {mine.length === 1 ? "module" : "modules"}</span>
          </div>
          {specs === null ? (
            <div className="skeleton h-20" />
          ) : mine.length === 0 ? (
            <div className="panel p-4 text-[13px] text-[var(--text-dim)]">
              You haven't published a module yet. Upload one above — choose <span className="text-[var(--text)]">private</span> to
              keep it to yourself while you iterate, then flip it public when it's ready.
            </div>
          ) : (
            <div className="space-y-3">
              {mine.map((s) => <ModuleCard key={s.hash} s={s} token={token} onChanged={refresh} />)}
            </div>
          )}
        </section>
      )}

      {/* ---- community (public, published by others) ---- */}
      <section className="mt-12">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 mb-3">
          <h2 className="font-display font-bold text-[18px] tracking-[-0.02em]">Community modules</h2>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="search name, description, publisher…"
            className="num text-[13px] w-full sm:w-72 border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[var(--text)] placeholder:text-[var(--text-faint)]" />
        </div>
        {specs === null ? (
          <div className="skeleton h-20" />
        ) : community.length === 0 ? (
          <div className="panel p-4 text-[13px] text-[var(--text-faint)]">
            {query ? "No modules match that search." : "No community modules published yet — be the first."}
          </div>
        ) : (
          <div className="space-y-3">
            {community.map((s) => <ModuleCard key={s.hash} s={s} token={token} onChanged={refresh} />)}
          </div>
        )}
      </section>

      {/* ---- built-in reference modules ---- */}
      <section className="mt-12">
        <h2 className="font-display font-bold text-[18px] tracking-[-0.02em] mb-3">Built-in reference modules</h2>
        <div className="space-y-3">
          {specs === null && <div className="skeleton h-20" />}
          {builtins.map((s) => <ModuleCard key={s.hash} s={s} token={token} onChanged={refresh} />)}
        </div>
      </section>

      <p className="mt-10 text-xs text-[var(--text-faint)]">
        Want to write one? The 3-function contract and a build template are in the{" "}
        <Link href="/docs" className="text-[var(--text-dim)] hover:text-[var(--text)] underline">docs</Link>.
      </p>
    </div>
  );
}

function ModuleCard({ s, token, onChanged }: { s: WorkerSpec; token: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const r = await setSpecVisibility(s.hash, !s.is_private, token);
      if (r.ok) onChanged();
      else setErr(r.error ?? "failed");
    } catch (e) {
      setErr(String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="panel ticked p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display font-bold text-[16px]">{s.name}</span>
          {s.is_builtin && <span className="barlabel" style={{ color: "var(--accent)" }}>built-in</span>}
          {s.is_private && (
            <span className="barlabel inline-flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
              <LockIcon /> private
            </span>
          )}
          <span className="barlabel" style={{ color: "var(--verified)" }}>✓ conformant</span>
        </div>
        {s.description && <p className="text-[14px] text-[var(--text-dim)] mt-1.5 max-w-[64ch]">{s.description}</p>}
        <div className="num text-xs text-[var(--text-dim)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>{s.spec_version}</span>
          <span className="inline-flex gap-1">hash <Mono value={s.hash} head={10} tail={6} /></span>
          <span>{fmt(s.open_jobs)} open {s.open_jobs === 1 ? "bounty" : "bounties"}</span>
          {s.is_builtin ? (
            <span>by Sieveworks</span>
          ) : s.mine ? (
            <span style={{ color: "var(--accent)" }}>by you</span>
          ) : s.publisher ? (
            <span className="inline-flex gap-1">by <Mono value={s.publisher} kind="address" /></span>
          ) : null}
        </div>
        {err && <p className="num text-xs mt-2" style={{ color: "var(--rejected)" }}>✕ {err}</p>}
      </div>

      <div className="shrink-0 self-start flex items-center gap-2">
        {s.mine && !s.is_builtin && (
          <button onClick={toggle} disabled={busy}
            className="whitespace-nowrap text-[12px] px-3 py-2 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text)] disabled:opacity-50">
            {busy ? "…" : s.is_private ? "Make public" : "Make private"}
          </button>
        )}
        <Link href={`/bounties/new?spec=${s.hash}`}
          className="whitespace-nowrap font-medium text-[13px] px-4 py-2 border border-[var(--border-bright)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
          Post a bounty →
        </Link>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function UploadPanel({ onDone }: { onDone: () => void }) {
  const { authed, token, wallet, signIn, signingIn } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState("{}");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !name || !token) return;
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.append("name", name);
    form.append("description", description);
    form.append("example_params", params);
    form.append("visibility", visibility);
    form.append("wasm", file);
    try {
      const r = await uploadSpec(form, token);
      setResult(r);
      if (r.ok) { setName(""); setDescription(""); onDone(); }
    } catch (e) {
      setResult({ ok: false, reason: String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <div className="panel ticked p-4 mt-8">
        <div className="num text-[12px] text-[var(--text-dim)] mb-2">Publish a worker module (.wasm)</div>
        <p className="text-[13px] text-[var(--text-dim)]">
          Sign in with your wallet to publish a module — it'll be attributed to you, and you choose
          whether it's public or private.
        </p>
        <button onClick={signIn} disabled={signingIn}
          className="mt-3 font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {wallet ? (signingIn ? "signing…" : "Sign in to publish") : "Connect wallet to publish"}
        </button>
      </div>
    );
  }

  return (
    <div className="panel ticked p-4 mt-8">
      <div className="num text-[12px] text-[var(--text-dim)] mb-3">Publish a worker module (.wasm)</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <input placeholder="module name" value={name} onChange={(e) => setName(e.target.value)}
          className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm" />
        <input type="file" accept=".wasm,application/wasm" ref={fileRef}
          className="text-sm text-[var(--text-dim)] file:mr-3 file:border file:border-[var(--border-bright)] file:bg-transparent file:text-[var(--text)] file:px-3 file:py-1 file:text-xs" />
        <input placeholder="description" value={description} onChange={(e) => setDescription(e.target.value)}
          className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm sm:col-span-2" />
        <label className="text-xs text-[var(--text-dim)] sm:col-span-2">
          example params (JSON — passed to the module)
          <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={2}
            className="num mt-1 w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]" />
        </label>
      </div>

      {/* visibility selector */}
      <fieldset className="mt-3">
        <div className="barlabel mb-2">Visibility</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <VisOption sel={visibility === "public"} onClick={() => setVisibility("public")}
            title="Public" desc="Listed in the community registry for anyone to see and fund." />
          <VisOption sel={visibility === "private"} onClick={() => setVisibility("private")}
            title="Private" desc="Only you can see it. Hidden until you post a bounty with it." icon={<LockIcon />} />
        </div>
      </fieldset>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button onClick={submit} disabled={busy}
          className="font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {busy ? "running conformance gate…" : "Upload & test"}
        </button>
        {result && (
          <span className="num text-xs" style={{ color: result.ok ? "var(--verified)" : "var(--rejected)" }}>
            {result.ok
              ? `✓ conformant · registered ${result.is_private ? "(private)" : "(public)"} as ${result.hash?.slice(0, 12)}…`
              : `✕ rejected: ${result.reason}`}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-faint)]">
        The gate runs your module in a sandboxed thread: checks the 3 exports, runs it twice for
        determinism, and verifies evaluate_seed reproduces each bucket's max. Non-deterministic or
        malformed modules are rejected.
      </p>
    </div>
  );
}

function VisOption({ sel, onClick, title, desc, icon }: { sel: boolean; onClick: () => void; title: string; desc: string; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left p-3 border transition-colors"
      style={{ borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "var(--accent-ghost)" : "transparent" }}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: sel ? "var(--accent)" : "var(--text)" }}>
        {icon}{title}
      </div>
      <div className="text-[11px] text-[var(--text-dim)] mt-1">{desc}</div>
    </button>
  );
}
