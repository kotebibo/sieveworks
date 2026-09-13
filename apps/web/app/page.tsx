"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { fetchFinds, fetchJobResults, fetchStats, fetchSwarm, subscribeEvents, type GlobalStats } from "@/lib/api";
import { Wordmark } from "@/components/Wordmark";
import { Sieve } from "@/components/Sieve";
import { FlappyShowcase } from "@/components/FlappyShowcase";
import { Reveal } from "@/components/Reveal";
import { Magnetic } from "@/components/Magnetic";
import { HeroFallback } from "@/components/HeroFallback";
import { CountUp, fmt } from "@/components/ui";

// Full-screen scroll-driven 3D hero — WebGL, client-only, lazy (off the critical
// path). The static HeroFallback paints instantly so there's never a blank hero.
const ScrollExperience = dynamic(() => import("@/components/ScrollExperience").then((m) => m.ScrollExperience), { ssr: false, loading: () => <HeroFallback /> });

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
        if (s.job_id) {
          fetchJobResults(s.job_id).then((r) => {
            const best = r.results
              .filter((x) => x.verification_state === "passed" && x.extremum_score != null)
              .reduce<typeof r.results[number] | null>((a, x) => (a === null || BigInt(x.extremum_score!) > BigInt(a.extremum_score!) ? x : a), null);
            if (best?.extremum_score != null && best.witness_seed != null)
              setWitness((w) => w ?? { score: best.extremum_score!, seed: best.witness_seed! });
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
    <>
      {/* ============ 1 · scroll-driven 3D hero ============ */}
      <ScrollExperience />

      <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
        {/* ============ 2 · the reframe (why it can be trusted) ============ */}
        <section className="py-24 sm:py-32">
          <Reveal variant="up">
            <div className="barlabel text-[var(--accent)]">The idea</div>
            <h2 className="mt-3 font-display font-bold text-[clamp(28px,4.2vw,46px)] leading-[1.04] tracking-[-0.03em] max-w-[18ch]">
              Pay a stranger to compute — and <em className="not-italic text-[var(--accent)]">know</em> they didn't lie.
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <Reveal variant="left" className="panel p-6 sm:p-7">
              <div className="num text-[13px] text-[var(--text-faint)]">The old way</div>
              <p className="mt-3 text-[17px] leading-[1.55] text-[var(--text-dim)]">
                Ask <span className="text-[var(--text)]">“did you find it?”</span> — and a lie costs nothing to tell. So everyone runs the work
                two or three times and compares the answers. The buyer pays <span className="text-[var(--text)] num">200%+</span> for the privilege of not being cheated.
              </p>
            </Reveal>
            <Reveal variant="right" delay={90} className="panel panel-bright p-6 sm:p-7">
              <div className="num text-[13px]" style={{ color: "var(--accent)" }}>The Sieveworks way</div>
              <p className="mt-3 text-[17px] leading-[1.55] text-[var(--text)]">
                Change the question to <span style={{ color: "var(--accent)" }}>“what's the best result in this slice?”</span> Now the answer carries a
                <span className="font-semibold"> witness</span> — a single seed that must reproduce the score on demand. Nothing to fake, nothing to out-vote.
                A lie is caught in <span className="num">microseconds</span>.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ============ 3 · verification — four ways a lie dies ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <Reveal variant="up">
            <div className="barlabel text-[var(--accent)]">The proof</div>
            <h2 className="mt-3 font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em]">Four ways a lie dies.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[52ch]">
              Stacked together, they make cheating pointless — for about <span className="text-[var(--text)] num">0.9%</span> extra compute, not 200%.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LAYERS.map((l, i) => (
              <Reveal key={l.t} variant="scale" delay={i * 80} className="panel p-5 h-full">
                <div className="num text-[22px] font-semibold tracking-[-0.02em]" style={{ color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-3 font-semibold text-[16px]">{l.t}</div>
                <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--text-dim)]">{l.d}</p>
              </Reveal>
            ))}
          </div>
          <Reveal variant="fade" delay={120}>
            <p className="mt-6 text-[15px] text-[var(--text-dim)]">
              The full mechanism, with numbers, lives on <Link href="/how-it-works" className="text-[var(--accent)] hover:underline">how it works</Link>.
            </p>
          </Reveal>
        </section>

        {/* ============ 4 · live proof — it's real right now ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <Reveal variant="up">
            <div className="barlabel text-[var(--accent)]">Live right now</div>
            <h2 className="mt-3 font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em]">Not a mockup. A running network.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[54ch]">
              A real bounty being covered by real contributors on the left; a neural network teaching itself to fly, trained live in your browser, on the right.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 lg:grid-cols-[1.05fr_1fr]">
            <Reveal variant="left" className="panel overflow-hidden">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--border)] barlabel">
                <span className="w-1.5 h-1.5 rounded-full live-pulse" style={{ background: "var(--verified)" }} />
                <span className="truncate normal-case tracking-normal text-[var(--text-dim)]">{swarm.title ?? "no active job"}</span>
                <span className="num ml-auto shrink-0 text-[var(--text-dim)] normal-case tracking-normal">{cover}% covered</span>
              </div>
              <div className="p-3.5 sieve-sweep">
                {swarm.job_id ? <Link href={`/bounties/${swarm.job_id}`}><Sieve cells={swarm.cells} /></Link> : <Sieve cells="" />}
              </div>
              <div className="num px-3.5 py-2.5 border-t border-[var(--border)] text-[12px] flex items-center gap-3 overflow-x-auto scroll-thin whitespace-nowrap">
                <span className="shrink-0" style={{ color: "var(--verified)" }}>✓ witness</span>
                <span className="text-[var(--text-faint)]">max</span>
                <span className="text-[var(--text)]">{witness ? witness.score : "—"}</span>
                <span className="text-[var(--text-faint)]">← seed</span>
                <span className="text-[var(--text)]">{witness ? witness.seed : "—"}</span>
                <span className="text-[var(--text-faint)]">· rechecked in</span>
                <span className="text-[var(--text)]">0.4ms</span>
              </div>
            </Reveal>

            <Reveal variant="right" delay={90}>
              <FlappyShowcase />
            </Reveal>
          </div>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 border-t border-[var(--border)] pt-6">
            <Stat n={stats ? Number(stats.chunks_accepted) : 0} l="Chunks verified" />
            <Stat n={stats ? Number(stats.contributors) : 0} l="Contributors" />
            <Stat n={stats ? Number(stats.seeds_evaluated) : 0} l="Seeds total" />
            <Stat v="0.9%" l="Verify overhead" accent />
          </div>
        </section>

        {/* ============ 5 · the money, settled on Solana ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <Reveal variant="up">
            <div className="barlabel text-[var(--accent)]">The money</div>
            <h2 className="mt-3 font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em]">Real budgets, settled on Solana.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[54ch]">
              No trust in us required. The escrow, the record of who found what, and the payout all live on-chain.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {FLOW.map((s, i) => (
              <Reveal key={s.t} variant="up" delay={i * 90} className="relative panel p-6 h-full">
                <div className="num text-[13px] text-[var(--text-faint)]">Step {i + 1}</div>
                <div className="mt-2 font-semibold text-[17px]">{s.t}</div>
                <p className="mt-1.5 text-[14.5px] leading-[1.5] text-[var(--text-dim)]">{s.d}</p>
              </Reveal>
            ))}
          </div>
          <Reveal variant="fade" delay={100}>
            <p className="mt-6 text-[15px] text-[var(--text-dim)]">
              Program live on{" "}
              <a href="https://explorer.solana.com/address/BPxLuXppjSMehhkibfRU646ZsrMMReFkMUKjmPuirWnf?cluster=devnet" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                Solana devnet
              </a>
              . Every find attestation is a transaction you can open in the explorer.
            </p>
          </Reveal>
        </section>

        {/* ============ 6 · any search, not just one ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <Reveal variant="left">
              <div className="barlabel text-[var(--accent)]">The platform</div>
              <h2 className="mt-3 font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em] max-w-[16ch]">One search today. Any search tomorrow.</h2>
            </Reveal>
            <Reveal variant="right" delay={80}>
              <p className="text-[17px] leading-[1.55] text-[var(--text-dim)]">
                A <span className="text-[var(--text)]">module</span> is a tiny function that scores one candidate. Prime hunts, protein folds, model training,
                render farms — anything shaped like <span className="text-[var(--text)]">“find the best across a huge space”</span> runs on Sieveworks the moment
                its module exists. Write your own, or run one the community already shipped.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/modules" className="font-medium text-[14px] px-5 py-2.5 border border-[var(--border-bright)] hover:border-[var(--text)] transition-colors">Browse modules</Link>
                <Link href="/docs" className="font-medium text-[14px] px-5 py-2.5 border border-[var(--border-bright)] hover:border-[var(--text)] transition-colors">Write one</Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============ 7 · CTA ============ */}
        <Reveal variant="scale">
          <section className="border-t border-b border-[var(--border)] py-16 text-center">
            <h2 className="font-display font-extrabold text-[clamp(30px,4vw,46px)] tracking-[-0.03em]">It's live. Join the swarm.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)]">A browser tab is a worker. No install, no signup.</p>
            <div className="mt-7 flex gap-3 justify-center flex-wrap">
              <Magnetic><Link href="/contribute" data-cursor className="sheen inline-block font-medium text-[14px] px-6 py-3 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Start contributing</Link></Magnetic>
              <Magnetic><Link href="/bounties" data-cursor className="inline-block font-medium text-[14px] px-6 py-3 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">Post a search</Link></Magnetic>
            </div>
          </section>
        </Reveal>

        {/* ============ footer ============ */}
        <footer className="mt-16 mb-10">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <Wordmark />
                <span className="font-display font-extrabold text-[15px] tracking-[0.1em] uppercase">Sieveworks</span>
              </div>
              <p className="mt-3 text-[13.5px] text-[var(--text-dim)] max-w-[32ch]">
                Verifiable distributed compute. Pay strangers to run work; prove they actually ran it.
              </p>
            </div>
            <FooterCol title="Product" links={[["/bounties", "Bounties"], ["/contribute", "Contribute"], ["/modules", "Modules"], ["/how-it-works", "How it works"]]} />
            <FooterCol title="Builders" links={[["/docs", "Docs"], ["/docs#contract", "Module contract"], ["/docs#ai", "AI module prompt"], ["https://github.com/konstantinesolana/sieveworks", "GitHub"]]} />
            <FooterCol title="Network" links={[
              ["https://explorer.solana.com/address/BPxLuXppjSMehhkibfRU646ZsrMMReFkMUKjmPuirWnf?cluster=devnet", "Program on explorer"],
              ["https://x.com/bibo19_", "@bibo19_ on X"],
            ]} />
          </div>
          <div className="num mt-10 pt-5 border-t border-[var(--border)] text-[12px] text-[var(--text-faint)] flex flex-wrap gap-x-4 gap-y-1">
            <span>© 2026 Sieveworks</span><span>·</span><span>Solana devnet</span><span>·</span><span>built solo, in the open</span>
          </div>
        </footer>
      </div>
    </>
  );
}

const LAYERS = [
  { t: "Witness recheck", d: "The winning seed is re-run against the module. Score doesn't match? Rejected on the spot — about 0.4ms." },
  { t: "Honeypots", d: "Traps with known answers are salted into the work. Miss one and every chunk you sent is thrown out." },
  { t: "Merkle challenge", d: "Random buckets are recomputed against the root you committed. A doctored batch can't survive the audit." },
  { t: "Stake & slash", d: "Workers post a stake on-chain. Get caught cheating and it burns — lying costs more than it pays." },
];

const FLOW = [
  { t: "Funded", d: "Posting a bounty locks its budget in an escrow account on-chain. The money is provably there before any work leases." },
  { t: "Attested", d: "Every record-breaking find is written to Solana as a permanent, timestamped transaction — who found what, forever." },
  { t: "Claimed", d: "Workers withdraw earnings with a co-signed voucher. The math is replay-proof; nobody can double-spend a payout." },
];

function Stat({ v, n, l, accent }: { v?: string; n?: number; l: string; accent?: boolean }) {
  return (
    <div className="px-4 first:pl-0 py-1 border-r border-[var(--border)] last:border-r-0 min-w-0">
      <div className="num text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em] leading-none" style={accent ? { color: "var(--accent)" } : undefined}>
        {typeof n === "number" ? <CountUp value={n} format={fmt} /> : v}
      </div>
      <div className="barlabel mt-2">{l}</div>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="num text-[12px] text-[var(--text-faint)] mb-3">{title}</div>
      <ul className="space-y-2 text-[13.5px]">
        {links.map(([href, label]) => (
          <li key={href}>
            {href.startsWith("http")
              ? <a href={href} target="_blank" rel="noreferrer" className="text-[var(--text-dim)] hover:text-[var(--accent)]">{label}</a>
              : <Link href={href} className="text-[var(--text-dim)] hover:text-[var(--accent)]">{label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
