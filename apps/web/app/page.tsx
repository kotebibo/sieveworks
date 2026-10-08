"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchFinds, fetchJobResults, fetchStats, fetchSwarm, subscribeEvents, type GlobalStats } from "@/lib/api";
import { Wordmark } from "@/components/Wordmark";
import { Sieve } from "@/components/Sieve";
import { FlappyShowcase } from "@/components/FlappyShowcase";
import { Reveal } from "@/components/Reveal";
import { Magnetic } from "@/components/Magnetic";
import { Hero } from "@/components/Hero";
import { SearchJob } from "@/components/SearchJob";
import { WhyBetter } from "@/components/WhyBetter";
import { HeroFlow } from "@/components/HeroFlow";
import { Defenses } from "@/components/Defenses";
import { CountUp, fmt } from "@/components/ui";

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
      {/* ============ 1 · hero — plain statement + the 3-step mechanism ============ */}
      <Hero stats={stats} />

      {/* ============ 2 · what's a search job ============ */}
      <SearchJob />

      {/* ============ 4 · why not just rent a datacenter ============ */}
      <WhyBetter />

      {/* ============ 5 · how the money + trust flow ============ */}
      <section className="py-20 sm:py-24 border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
          <Reveal variant="up">
            <h2 className="font-display font-bold text-[clamp(27px,3.8vw,40px)] tracking-[-0.025em]">How the money and trust flow.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[58ch]">Fund a job, a crowd sieves it, every result is proven, and workers get paid. All settled on Solana.</p>
          </Reveal>
          <Reveal variant="fade" delay={80} className="mt-10"><HeroFlow /></Reveal>
          <Reveal variant="fade" delay={120}>
            <p className="mt-7 text-[15px] text-[var(--text-dim)]">
              Program live on <a href="https://explorer.solana.com/address/BPxLuXppjSMehhkibfRU646ZsrMMReFkMUKjmPuirWnf?cluster=devnet" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">Solana devnet</a>. Every find attestation is a transaction you can open in the explorer.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
        {/* ============ 6 · verification — four ways a lie dies ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <Defenses />
          <Reveal variant="fade" delay={120}>
            <p className="mt-6 text-[15px] text-[var(--text-dim)]">
              The full mechanism, with numbers, lives on <Link href="/how-it-works" className="text-[var(--accent)] hover:underline">how it works</Link>.
            </p>
          </Reveal>
        </section>

        {/* ============ 4 · live proof — it's real right now ============ */}
        <section className="py-20 sm:py-24 border-t border-[var(--border)]">
          <Reveal variant="up">
            <h2 className="font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em]">Live right now, on Solana.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[54ch]">
              Left: a real bounty, covered by real contributors. Right: a network teaching itself to fly, live in your browser.
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

        {/* ============ 8 · CTA — both sides ============ */}
        <Reveal variant="scale">
          <section className="border-t border-b border-[var(--border)] py-16 text-center">
            <h2 className="font-display font-extrabold text-[clamp(28px,4vw,44px)] tracking-[-0.03em] max-w-[22ch] mx-auto">Put a crowd to work. Or let your computer earn.</h2>
            <p className="mt-3 text-[16px] text-[var(--text-dim)]">Two sides, one network. Both live on Solana right now.</p>
            <div className="mt-7 flex gap-3 justify-center flex-wrap">
              <Magnetic><Link href="/bounties/new" data-cursor className="sheen inline-block font-medium text-[14px] px-6 py-3 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Post a job</Link></Magnetic>
              <Magnetic><Link href="/contribute" data-cursor className="inline-block font-medium text-[14px] px-6 py-3 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">Earn with your computer</Link></Magnetic>
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
              <p className="mt-3 text-[13.5px] text-[var(--text-dim)] max-w-[34ch]">
                A compute network you can trust: a crowd runs your work, and every result is proven, settled on Solana.
              </p>
            </div>
            <FooterCol title="Product" links={[["/bounties", "Bounties"], ["/contribute", "Contribute"], ["/modules", "Modules"], ["/how-it-works", "How it works"]]} />
            <FooterCol title="Builders" links={[["/docs", "Docs"], ["/docs#contract", "Module contract"], ["/docs#ai", "AI module prompt"], ["https://github.com/kotebibo/sieveworks", "GitHub"]]} />
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
