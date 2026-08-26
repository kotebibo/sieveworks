"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchFinds, fetchJobResults, fetchStats, fetchSwarm, subscribeEvents, type GlobalStats } from "@/lib/api";
import { Sieve } from "@/components/Sieve";
import { Mono, fmt } from "@/components/ui";

export default function Home() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [swarm, setSwarm] = useState<{ job_id: string | null; title: string | null; cells: string }>({ job_id: null, title: null, cells: "" });
  const [witness, setWitness] = useState<{ score: string; seed: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      fetchStats().then(setStats).catch(() => {});
      fetchFinds().then((r) => {
        const rec = r.finds.find((f) => f.is_record) ?? r.finds[0];
        if (rec) setWitness({ score: rec.score, seed: rec.seed });
      }).catch(() => {});
      fetchSwarm().then((s) => {
        setSwarm(s);
        // fall back to the active job's best verified result as the shown witness
        if (s.job_id) {
          fetchJobResults(s.job_id).then((r) => {
            const best = r.results
              .filter((x) => x.verification_state === "passed")
              .reduce<typeof r.results[number] | null>((a, x) => (a === null || BigInt(x.extremum_score) > BigInt(a.extremum_score) ? x : a), null);
            if (best) setWitness((w) => w ?? { score: best.extremum_score, seed: best.witness_seed });
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    refresh();
    return subscribeEvents(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 350);
    });
  }, []);

  const cover = swarm.cells.length
    ? ((Array.from(swarm.cells).filter((c) => c === "a").length / swarm.cells.length) * 100).toFixed(2)
    : "0.00";

  return (
    <div className="mx-auto max-w-[1180px] px-5 sm:px-7">
      {/* ---------- hero ---------- */}
      <section className="pt-14 sm:pt-[68px] grid grid-cols-1 gap-10 lg:grid-cols-[1.02fr_1fr] items-start">
        <div>
          <div className="barlabel flex items-center gap-2.5 mb-5" style={{ color: "var(--accent)", letterSpacing: "0.14em" }}>
            <span className="inline-block w-[22px] h-px" style={{ background: "var(--accent)" }} />
            Verifiable distributed search
          </div>
          <h1 className="font-display font-extrabold leading-[0.98] tracking-[-0.035em] text-[clamp(38px,5.1vw,62px)]">
            Pay strangers<br />to search.<br /><span className="text-[var(--text-dim)]">Prove they did.</span>
          </h1>
          <p className="mt-5 text-[16.5px] text-[var(--text-dim)] max-w-[44ch]">
            Fund a search. Contributors run pieces of it in a browser tab and get paid per verified
            chunk. Every result carries a witness we can re-check in microseconds — so{" "}
            <strong className="text-[var(--text)] font-medium">proving the work costs under 1%</strong> of
            doing it, not the 200% you pay to run everything three times.
          </p>
          <div className="mt-7 flex gap-3 flex-wrap">
            <Link href="/contribute" className="font-medium text-[14px] px-5 py-[11px] text-[var(--bg)]" style={{ background: "var(--accent)" }}>
              Start contributing
            </Link>
            <Link href="/bounties" className="font-medium text-[14px] px-5 py-[11px] border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)]">
              Post a search
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 border-t border-[var(--border)]">
            <HeroStat v={stats ? fmt(stats.chunks_accepted) : "0"} l="Chunks verified" />
            <HeroStat v={stats ? String(stats.contributors) : "0"} l="Contributors" />
            <HeroStat v={stats ? fmt(Number(stats.seeds_evaluated)) : "0"} l="Seeds total" />
            <HeroStat v="0.45%" l="Verify overhead" accent />
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--border)] barlabel">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--verified)" }} />
              {swarm.title ? swarm.title : "no active job"}
              <span className="num ml-auto text-[var(--text-dim)] normal-case tracking-normal">{cover}% covered</span>
            </div>
            <div className="p-3.5">
              {swarm.job_id ? (
                <Link href={`/bounties/${swarm.job_id}`}><Sieve cells={swarm.cells} /></Link>
              ) : (
                <Sieve cells="" />
              )}
            </div>
            <div className="flex flex-wrap gap-4 px-3.5 py-2.5 border-t border-[var(--border)] barlabel normal-case tracking-normal">
              <Leg c="var(--cell-empty)" t="unclaimed" />
              <Leg c="transparent" t="searching" border />
              <Leg c="var(--verified)" t="verified" />
              <Leg c="var(--accent)" t="record" />
              <Leg c="var(--rejected)" t="rejected" />
            </div>
          </div>
          <div className="panel mt-3.5 px-3.5 py-3 num text-[12px] flex items-center gap-3 overflow-hidden whitespace-nowrap">
            <span style={{ color: "var(--verified)" }}>✓ witness</span>
            <span className="text-[var(--text-faint)]">max</span>
            <span className="text-[var(--text)]">{witness ? witness.score : "—"}</span>
            <span className="text-[var(--text-faint)]">←</span>
            <span className="text-[var(--text-faint)]">seed</span>
            <span className="text-[var(--text)]">{witness ? witness.seed : "—"}</span>
            <span className="text-[var(--text-faint)]">·</span>
            <span className="text-[var(--text-faint)]">rechecked in</span>
            <span className="text-[var(--text)]">0.4ms</span>
          </div>
        </div>
      </section>

      {/* ---------- the reframe (the thesis) ---------- */}
      <section className="pt-24">
        <div className="max-w-[60ch] mb-10">
          <h2 className="font-display font-bold text-[clamp(26px,3.2vw,36px)] leading-[1.06] tracking-[-0.028em]">
            The fix wasn't cryptography.<br />It was asking a different question.
          </h2>
          <p className="mt-3.5 text-[16px] text-[var(--text-dim)]">
            Paying anonymous people to search something has one hard problem: the most common honest
            answer is also the cheapest lie.
          </p>
        </div>
        <div className="grid md:grid-cols-2 border border-[var(--border)]">
          <div className="p-6 md:border-r border-[var(--border)] bg-[var(--panel)]">
            <div className="barlabel mb-3.5 flex items-center gap-2" style={{ color: "var(--rejected)", letterSpacing: "0.12em" }}>✕ unverifiable</div>
            <div className="font-display font-bold text-[19px] tracking-[-0.02em] mb-2.5">“Did you find it in this range?”</div>
            <p className="text-[14.5px] text-[var(--text-dim)] mb-4">
              A negative answer leaves no artifact. Nothing to check, nothing to recompute, no way to
              tell an hour of work from an instant reply.
            </p>
            <div className="num text-[12.5px] px-3.5 py-3 border border-dashed border-[var(--border-bright)] text-[var(--text-dim)]">
              worker → <b className="text-[var(--text)] font-medium">"nothing here"</b><br />cost to fake: <b className="text-[var(--text)] font-medium">0.00s</b>
            </div>
            <p className="text-[13px] text-[var(--text-dim)] mt-3.5">
              Everyone else answers this by running every chunk two or three times and comparing.{" "}
              <b className="text-[var(--text)] font-semibold">The buyer pays 200% extra</b> for the privilege of not being robbed.
            </p>
          </div>
          <div className="p-6">
            <div className="barlabel mb-3.5 flex items-center gap-2" style={{ color: "var(--verified)", letterSpacing: "0.12em" }}>✓ verifiable</div>
            <div className="font-display font-bold text-[19px] tracking-[-0.02em] mb-2.5">“What's the best thing in this range?”</div>
            <p className="text-[14.5px] text-[var(--text-dim)] mb-4">
              Now the honest answer is a specific claim with a witness attached — a seed that has to
              actually produce the score you reported.
            </p>
            <div className="num text-[12.5px] px-3.5 py-3 border border-dashed border-[var(--border-bright)] text-[var(--text-dim)]">
              worker → <b className="text-[var(--text)] font-medium">max 47 · seed 8829371</b><br />cost to check: <b className="text-[var(--text)] font-medium">0.7ms</b>
            </div>
            <p className="text-[13px] text-[var(--text-dim)] mt-3.5">
              There is no “nothing” left to fake, and <b className="text-[var(--text)] font-semibold">nothing to outvote</b> — results get
              recomputed, not polled. A thousand colluding nodes fail the same check one does.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- lifecycle ---------- */}
      <section className="pt-24">
        <div className="max-w-[60ch] mb-10">
          <h2 className="font-display font-bold text-[clamp(26px,3.2vw,36px)] leading-[1.06] tracking-[-0.028em]">What happens to a chunk</h2>
          <p className="mt-3.5 text-[16px] text-[var(--text-dim)]">
            Four layers, every chunk, not just the interesting ones. Under-reporting and
            over-reporting are caught from opposite directions.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t border-l border-[var(--border)]">
          <Step state="Leased" dot="var(--accent-dim)" h="A range goes out"
            p="A contributor takes 100,000 seeds. Abandon it and the lease expires — the range goes back in the pool."
            cost="no install · browser tab" />
          <Step state="Submitted" dot="var(--accent)" h="A witness comes back"
            p="The best score found, the seed that produced it, and a Merkle root over every 1,024-seed bucket along the way."
            cost="signed by the worker's wallet" />
          <Step state="Checked" dot="var(--verified)" h="Four ways to catch a lie"
            p="Regenerate the witness. Compare against seeds we already know. Open random buckets and recompute them. Slash the stake if any fails."
            cost="0.4ms + 1ms + 155ms expected" />
          <Step state="Settled" dot="var(--verified)" h="Paid, and credited"
            p="Earnings accrue per verified chunk. Beat the record and the find is written on-chain, permanently, to your wallet."
            cost="credit no one can take back" />
        </div>
      </section>

      <footer className="mt-24 border-t border-[var(--border)] py-7 mb-16">
        <div className="num text-[11.5px] text-[var(--text-faint)] flex flex-wrap gap-4 items-center tracking-wide">
          <span>SIEVEWORKS</span><span>·</span><span>Solana devnet</span><span>·</span>
          <a href="https://github.com/konstantinesolana/sieveworks" className="hover:text-[var(--text)]">open source</a>
          <span>·</span><Link href="/how-it-works" className="hover:text-[var(--text)]">how it works</Link>
          <span>·</span><Link href="/docs" className="hover:text-[var(--text)]">docs</Link>
        </div>
      </footer>
    </div>
  );
}

function HeroStat({ v, l, accent }: { v: string; l: string; accent?: boolean }) {
  return (
    <div className="py-4 pr-4 border-r border-[var(--border)] last:border-r-0 min-w-0">
      <div className="num text-[18px] sm:text-[20px] font-medium tracking-[-0.02em] truncate" style={accent ? { color: "var(--accent)" } : undefined}>{v}</div>
      <div className="barlabel mt-1 truncate">{l}</div>
    </div>
  );
}

function Leg({ c, t, border }: { c: string; t: string; border?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="w-2 h-2 inline-block" style={{ background: c, border: border ? "1px solid var(--accent-dim)" : undefined }} /> {t}
    </span>
  );
}

function Step({ state, dot, h, p, cost }: { state: string; dot: string; h: string; p: string; cost: string }) {
  return (
    <div className="p-[22px] pb-[26px] border-r border-b border-[var(--border)]">
      <div className="barlabel flex items-center gap-2 mb-4" style={{ letterSpacing: "0.12em" }}>
        <span className="w-[7px] h-[7px] block" style={{ background: dot }} /> {state}
      </div>
      <h3 className="font-display font-bold text-[16px] tracking-[-0.015em] mb-2">{h}</h3>
      <p className="text-[14px] text-[var(--text-dim)]">{p}</p>
      <div className="num text-[11.5px] mt-3.5" style={{ color: "var(--accent)" }}>{cost}</div>
    </div>
  );
}
