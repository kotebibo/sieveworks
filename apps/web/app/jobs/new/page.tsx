"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo, useState } from "react";
import { Button, fmt } from "@/components/ui";
import { WalletButton } from "@/lib/wallet";

// The economics panel: buyer sets budget, sees seeds bought, coverage, and
// duration BEFORE committing — answers "what does my money buy" visually.
const SEED_SPACE = 281_474_976_710_656; // 2^48, Minecraft structure seed space
const BROWSER_SEEDS_PER_SEC = 5000; // measured typical 4-thread browser

export default function NewJob() {
  const { connected } = useWallet();
  const [title, setTitle] = useState("");
  const [scorer, setScorer] = useState("biome_diversity");
  const [radius, setRadius] = useState(256);
  const [spaceB, setSpaceB] = useState(20_000_000);
  const [budget, setBudget] = useState(0.5); // SOL
  const [pricePerChunk, setPricePerChunk] = useState(0.00005); // SOL
  const [swarm, setSwarm] = useState(20); // assumed concurrent browsers

  const econ = useMemo(() => {
    const chunkSeeds = 100_000;
    const chunks = Math.ceil(spaceB / chunkSeeds);
    const affordableChunks = pricePerChunk > 0 ? Math.floor(budget / pricePerChunk) : 0;
    const paidSeeds = Math.min(chunks, affordableChunks) * chunkSeeds;
    const coverage = (spaceB / SEED_SPACE) * 100;
    const totalRate = swarm * BROWSER_SEEDS_PER_SEC;
    const durationSec = totalRate > 0 ? spaceB / totalRate : 0;
    return { chunks, affordableChunks, paidSeeds, coverage, durationSec };
  }, [spaceB, budget, pricePerChunk, swarm]);

  const durationLabel =
    econ.durationSec < 90 ? `${Math.round(econ.durationSec)}s`
    : econ.durationSec < 5400 ? `${Math.round(econ.durationSec / 60)}m`
    : `${(econ.durationSec / 3600).toFixed(1)}h`;

  const funded = econ.affordableChunks >= econ.chunks;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold">Post a bounty</h1>
      <p className="mt-1 text-sm text-[var(--text-dim)]">
        Define a search, set a budget, and see exactly what it buys before funding.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="panel p-4 space-y-4">
          <Field label="title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Most diverse spawn biomes"
              className="w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]" />
          </Field>
          <Field label="search">
            <select value={scorer} onChange={(e) => setScorer(e.target.value)}
              className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)] appearance-none">
              <option value="biome_diversity">biome_diversity — most distinct biomes near spawn</option>
              <option value="mushroom_fields">mushroom_fields — most mushroom terrain near spawn</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="radius (blocks)"><NumIn v={radius} set={setRadius} step={64} /></Field>
            <Field label="seeds to search"><NumIn v={spaceB} set={setSpaceB} step={1_000_000} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="budget (SOL)"><NumIn v={budget} set={setBudget} step={0.1} float /></Field>
            <Field label="price/chunk (SOL)"><NumIn v={pricePerChunk} set={setPricePerChunk} step={0.00001} float /></Field>
          </div>
          <Field label={`assumed swarm size: ${swarm} browsers`}>
            <input type="range" min={1} max={200} value={swarm} onChange={(e) => setSwarm(Number(e.target.value))}
              className="w-full accent-[var(--accent)]" />
          </Field>
        </div>

        <div className="panel p-4 grid-bg">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">what your budget buys</div>
          <dl className="mt-3 space-y-2 num text-sm">
            <Row k="work units (chunks)" v={fmt(econ.chunks)} />
            <Row k="seeds searched" v={fmt(spaceB)} />
            <Row k="coverage of 2⁴⁸ space" v={`${econ.coverage < 0.001 ? econ.coverage.toExponential(1) : econ.coverage.toFixed(4)}%`} />
            <Row k="est. duration" v={durationLabel} accent />
            <Row k="budget covers" v={funded ? "full search ✓" : `${fmt(econ.affordableChunks)} / ${fmt(econ.chunks)} chunks`} good={funded} bad={!funded} />
          </dl>
          <p className="mt-4 text-[11px] text-[var(--text-faint)] leading-relaxed">
            Sieveworks sells targeted search, not exhaustive: a budget buys coverage of a chosen
            region, not certainty over all 281 trillion seeds. Real seedfinding prefilters the space
            first.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        {connected ? (
          <Button variant="primary" disabled title="On-chain funding lands when the program is deployed">
            Fund &amp; post (on-chain — pending deploy)
          </Button>
        ) : (
          <>
            <WalletButton />
            <span className="text-xs text-[var(--text-dim)]">connect a wallet to fund the escrow</span>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-[var(--text-dim)]">
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}
function NumIn({ v, set, step, float }: { v: number; set: (n: number) => void; step: number; float?: boolean }) {
  return (
    <input type="number" value={v} step={step} min={0}
      onChange={(e) => set(float ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)}
      className="num w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]" />
  );
}
function Row({ k, v, accent, good, bad }: { k: string; v: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  const color = good ? "var(--verified)" : bad ? "var(--rejected)" : accent ? "var(--accent)" : "var(--text)";
  return (
    <div className="flex justify-between border-b border-[var(--border)] pb-1.5">
      <dt className="text-[var(--text-dim)]">{k}</dt>
      <dd style={{ color }}>{v}</dd>
    </div>
  );
}
