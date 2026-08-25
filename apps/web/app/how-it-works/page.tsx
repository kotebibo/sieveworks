import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Sieveworks verifies distributed search for under 1% overhead: extremum reframing, witness checks, honeypots, Merkle commit-and-challenge, and on-chain attribution.",
};

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-[820px] px-5 sm:px-7 py-14">
      <div className="barlabel mb-5" style={{ color: "var(--accent)", letterSpacing: "0.14em" }}>How it works</div>
      <h1 className="font-display font-extrabold text-[clamp(30px,4vw,46px)] leading-[1.02] tracking-[-0.03em]">
        Hard to find, easy to check.
      </h1>
      <p className="mt-4 text-[16.5px] text-[var(--text-dim)] max-w-[52ch]">
        Sieveworks serves one shape of problem: a compact input, a deterministic score, and a
        witness anyone can re-check in microseconds. Everything below follows from that.
      </p>

      <Block n="01" title="Extremum reframing">
        A job never asks a yes/no question. It asks: <em>what is the highest-scoring input in this
        range, and which one produces it?</em> Every chunk comes back as a specific claim with a
        witness — a seed that must actually reproduce the reported score. There is no fakeable
        “nothing found,” because the honest answer is always a positive claim.
      </Block>
      <Block n="02" title="Witness check — catches over-reporting">
        The coordinator re-runs the witness seed in the identical WebAssembly module the worker ran
        (pinned by content hash, so they can never drift) and requires an exact match. Inflate your
        score and you can’t produce a seed that backs it. ~0.4&nbsp;ms per submission.
      </Block>
      <Block n="03" title="Honeypots — catches under-reporting">
        The coordinator secretly knows the scores of some seeds scattered through the space. If a
        chunk contains a known seed scoring above the reported maximum, the range wasn’t searched.
        Nothing is injected into the assignment, so it’s invisible from the worker’s side.
      </Block>
      <Block n="04" title="Merkle commit-and-challenge">
        The worker commits to every 1,024-seed bucket with a single Merkle root, before it knows
        what will be audited. The coordinator then challenges random buckets and recomputes them.
        You can’t open a bucket you never computed — and a thousand colluding nodes fail the same
        check one does, because results are recomputed, not polled.
      </Block>
      <Block n="05" title="Stake, slash, and on-chain attribution">
        Workers post a bond before paid work; a caught lie burns it, making cheating negative
        expected value. Every verified record is re-checked deterministically and written on-chain,
        permanently attributed to whoever found it — credit no one can take back.
      </Block>

      <div className="mt-10 panel ticked p-5">
        <div className="barlabel mb-2">The number that matters</div>
        <p className="text-[15px] text-[var(--text-dim)]">
          Verification costs about <b className="text-[var(--text)] font-semibold">0.45% of the work it
          checks</b> at a 5% audit rate — and roughly 9% even if you audit <em>every</em> chunk. The
          industry alternative, running everything two or three times, costs 200%.
        </p>
      </div>

      <div className="mt-8 flex gap-3">
        <Link href="/contribute" className="font-medium text-[14px] px-5 py-[11px] text-[var(--bg)]" style={{ background: "var(--accent)" }}>Start contributing</Link>
        <Link href="/docs" className="font-medium text-[14px] px-5 py-[11px] border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)]">Read the docs</Link>
      </div>
    </div>
  );
}

function Block({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 grid grid-cols-[auto_1fr] gap-5">
      <div className="num text-[var(--accent)] text-[13px] pt-1">{n}</div>
      <div>
        <h2 className="font-display font-bold text-[20px] tracking-[-0.02em] mb-2">{title}</h2>
        <p className="text-[15px] text-[var(--text-dim)] leading-relaxed">{children}</p>
      </div>
    </section>
  );
}
