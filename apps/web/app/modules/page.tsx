"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchSpecs, uploadSpec, type UploadResult, type WorkerSpec } from "@/lib/api";
import { Mono, fmt } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Modules() {
  const [specs, setSpecs] = useState<WorkerSpec[] | null>(null);
  const refresh = () => fetchSpecs().then((r) => setSpecs(r.specs)).catch(() => setSpecs([]));
  useEffect(() => { refresh(); }, []);

  return (
    <div className="mx-auto max-w-[1000px] px-5 sm:px-7 py-12">
      <div className="barlabel mb-4" style={{ color: "var(--accent)", letterSpacing: "0.14em" }}>Worker modules</div>
      <h1 className="font-display font-extrabold text-[clamp(28px,3.6vw,40px)] leading-[1.04] tracking-[-0.03em]">
        Bring your own search.
      </h1>
      <p className="mt-3 text-[15.5px] text-[var(--text-dim)] max-w-[58ch]">
        Sieveworks doesn't know what Minecraft is. A worker is any WebAssembly module exporting three
        functions — <span className="num text-[var(--text)]">evaluate_range</span>,{" "}
        <span className="num text-[var(--text)]">evaluate_seed</span>,{" "}
        <span className="num text-[var(--text)]">spec_version</span>. Upload one and the coordinator
        content-hashes it, runs a conformance gate, and it's ready to fund bounties against. The gate
        proves it's deterministic and honours the witness invariant — the same checks verification relies on.
      </p>

      <UploadPanel onDone={refresh} />

      <h2 className="font-display font-bold text-[18px] tracking-[-0.02em] mt-10 mb-3">Registered modules</h2>
      <div className="space-y-3">
        {specs === null && <div className="skeleton h-20" />}
        {specs?.map((s) => (
          <div key={s.hash} className="panel ticked p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display font-bold text-[16px]">{s.name}</span>
                {s.is_builtin && <span className="barlabel" style={{ color: "var(--accent)" }}>built-in</span>}
                <span className="barlabel" style={{ color: "var(--verified)" }}>✓ conformant</span>
              </div>
              {s.description && <p className="text-[14px] text-[var(--text-dim)] mt-1.5 max-w-[64ch]">{s.description}</p>}
              <div className="num text-xs text-[var(--text-dim)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>{s.spec_version}</span>
                <span className="inline-flex gap-1">hash <Mono value={s.hash} head={10} tail={6} /></span>
                <span>{fmt(s.open_jobs)} open {s.open_jobs === 1 ? "bounty" : "bounties"}</span>
                {s.is_builtin ? (
                  <span>by Sieveworks</span>
                ) : s.publisher ? (
                  <span className="inline-flex gap-1">by <Mono value={s.publisher} kind="address" /></span>
                ) : null}
              </div>
            </div>
            <Link href={`/bounties/new?spec=${s.hash}`}
              className="shrink-0 self-start whitespace-nowrap font-medium text-[13px] px-4 py-2 border border-[var(--border-bright)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
              Post a bounty →
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-[var(--text-faint)]">
        Want to write one? The 3-function contract and a build template are in the{" "}
        <Link href="/docs" className="text-[var(--text-dim)] hover:text-[var(--text)] underline">docs</Link>.
      </p>
    </div>
  );
}

function UploadPanel({ onDone }: { onDone: () => void }) {
  const { authed, token, wallet, signIn, signingIn } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState("{}");
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
        <div className="barlabel mb-2">Upload a worker module (.wasm)</div>
        <p className="text-[13px] text-[var(--text-dim)]">
          Sign in with your wallet to publish a module — it'll be attributed to you as the publisher.
        </p>
        <button onClick={signIn} disabled={signingIn}
          className="mt-3 font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {wallet ? (signingIn ? "signing…" : "Sign in to upload") : "Connect wallet to upload"}
        </button>
      </div>
    );
  }

  return (
    <div className="panel ticked p-4 mt-8">
      <div className="barlabel mb-3">Upload a worker module (.wasm)</div>
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
      <div className="mt-3 flex items-center gap-3">
        <button onClick={submit} disabled={busy}
          className="font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {busy ? "running conformance gate…" : "Upload & test"}
        </button>
        {result && (
          <span className="num text-xs" style={{ color: result.ok ? "var(--verified)" : "var(--rejected)" }}>
            {result.ok
              ? `✓ conformant · registered as ${result.hash?.slice(0, 12)}…`
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
