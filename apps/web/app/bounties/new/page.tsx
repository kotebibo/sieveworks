"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { createJobReq, fetchSpecs, type WorkerSpec } from "@/lib/api";
import { fmt } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const SEED_SPACE = 281_474_976_710_656; // 2^48 reference
const BROWSER_SEEDS_PER_SEC = 5000;

function NewBountyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { authed, token, wallet, signIn, signingIn } = useAuth();
  const [specs, setSpecs] = useState<WorkerSpec[]>([]);
  const [specHash, setSpecHash] = useState(params.get("spec") ?? "");
  const [title, setTitle] = useState("");
  const [paramsJson, setParamsJson] = useState("{}");
  const [spaceStart, setSpaceStart] = useState("0");
  const [spaceEnd, setSpaceEnd] = useState("20000000");
  const [seedsPerSec, setSeedsPerSec] = useState(3333);
  const [swarm, setSwarm] = useState(20);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSpecs().then((r) => {
      setSpecs(r.specs);
      if (!specHash && r.specs[0]) selectSpec(r.specs[0]);
      else {
        const s = r.specs.find((x) => x.hash === specHash);
        if (s) selectSpec(s);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSpec(s: WorkerSpec) {
    setSpecHash(s.hash);
    setParamsJson(JSON.stringify(s.example_params, null, 0));
    if (s.default_range_start) setSpaceStart(s.default_range_start);
    if (s.default_range_end) setSpaceEnd(s.default_range_end);
  }

  const spec = specs.find((s) => s.hash === specHash);
  const space = Math.max(0, Number(spaceEnd) - Number(spaceStart));

  const econ = useMemo(() => {
    const chunkSeeds = 100_000;
    const chunks = Math.ceil(space / chunkSeeds);
    const coverage = (space / SEED_SPACE) * 100;
    const totalRate = swarm * BROWSER_SEEDS_PER_SEC;
    const durationSec = totalRate > 0 ? space / totalRate : 0;
    return { chunks, coverage, durationSec };
  }, [space, swarm]);

  const durationLabel = econ.durationSec < 90 ? `${Math.round(econ.durationSec)}s`
    : econ.durationSec < 5400 ? `${Math.round(econ.durationSec / 60)}m`
    : `${(econ.durationSec / 3600).toFixed(1)}h`;

  async function post() {
    setError(null);
    if (!token) { setError("sign in first"); return; }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(paramsJson); } catch { setError("params must be valid JSON"); return; }
    setPosting(true);
    const r = await createJobReq({
      title: title || `${spec?.name} search`,
      worker_spec_hash: specHash,
      game: spec?.name ?? "compute",
      params: parsed,
      search_space_start: spaceStart,
      search_space_end: spaceEnd,
      seeds_per_sec: seedsPerSec,
    }, token);
    setPosting(false);
    if (r.job_id) router.push(`/bounties/${r.job_id}`);
    else setError(typeof r.error === "string" ? r.error : "failed to post");
  }

  return (
    <div className="mx-auto max-w-[1000px] px-5 sm:px-7 py-12">
      <h1 className="font-display font-extrabold text-[clamp(26px,3.4vw,38px)] tracking-[-0.03em]">Post a bounty</h1>
      <p className="mt-2 text-[15px] text-[var(--text-dim)]">
        Pick a worker module, define the numeric range to search, and see what your budget buys.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="panel ticked p-4 space-y-4">
          <Field label="worker module">
            <select value={specHash} onChange={(e) => { const s = specs.find((x) => x.hash === e.target.value); if (s) selectSpec(s); }}
              className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]">
              {specs.map((s) => <option key={s.hash} value={s.hash}>{s.name}</option>)}
            </select>
          </Field>
          {spec?.description && <p className="text-xs text-[var(--text-dim)] -mt-2">{spec.description}</p>}
          <Field label="title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${spec?.name ?? ""} search`}
            className="w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm" /></Field>
          <Field label="params (JSON, passed to the module)">
            <textarea value={paramsJson} onChange={(e) => setParamsJson(e.target.value)} rows={2}
              className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="range start"><input value={spaceStart} onChange={(e) => setSpaceStart(e.target.value)}
              className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm" /></Field>
            <Field label="range end (exclusive)"><input value={spaceEnd} onChange={(e) => setSpaceEnd(e.target.value)}
              className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm" /></Field>
          </div>
          <Field label={`assumed swarm: ${swarm} browsers`}>
            <input type="range" min={1} max={200} value={swarm} onChange={(e) => setSwarm(Number(e.target.value))}
              className="w-full accent-[var(--accent)]" />
          </Field>
        </div>

        <div className="panel ticked p-4" style={{ backgroundImage: "radial-gradient(var(--mesh) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          <div className="barlabel">what your search covers</div>
          <dl className="mt-3 space-y-2 num text-sm">
            <Row k="work units (chunks)" v={fmt(econ.chunks)} />
            <Row k="seeds searched" v={fmt(space)} />
            <Row k="coverage of 2⁴⁸" v={`${econ.coverage < 0.001 ? econ.coverage.toExponential(1) : econ.coverage.toFixed(4)}%`} />
            <Row k="est. duration" v={durationLabel} accent />
          </dl>
          <p className="mt-4 text-[11px] text-[var(--text-faint)] leading-relaxed">
            Sieveworks sells targeted search, not exhaustive: a budget buys coverage of a chosen
            region. Payments settle on-chain (devnet); funding is enabled once the program is deployed.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        {authed ? (
          <button onClick={post} disabled={posting || !specHash}
            className="font-medium text-[14px] px-5 py-2.5 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {posting ? "posting…" : "Post bounty"}
          </button>
        ) : (
          <button onClick={signIn} disabled={signingIn}
            className="font-medium text-[14px] px-5 py-2.5 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {wallet ? (signingIn ? "signing…" : "Sign in to post") : "Connect wallet to post"}
          </button>
        )}
        {error && <span className="num text-xs" style={{ color: "var(--rejected)" }}>{error}</span>}
      </div>
    </div>
  );
}

export default function NewBounty() {
  return <Suspense fallback={<div className="mx-auto max-w-[1000px] px-7 py-12 skeleton h-40" />}><NewBountyInner /></Suspense>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs text-[var(--text-dim)]"><span className="block mb-1">{label}</span>{children}</label>;
}
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between border-b border-[var(--border)] pb-1.5">
      <dt className="text-[var(--text-dim)]">{k}</dt>
      <dd style={accent ? { color: "var(--accent)" } : undefined}>{v}</dd>
    </div>
  );
}
