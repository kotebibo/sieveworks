/* Landing — the live swarm view becomes the hero on Day 6. Until real SSE
 * data flows, we show honest zeros (spec §11: never fabricated activity). */
export default function Home() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        An exchange for verifiable search
      </h1>
      <p className="mt-2 text-[var(--muted)] max-w-xl text-sm">
        Fund a brute-force search. Contributors run chunks on their own hardware
        and get paid per verified chunk on Solana. Every discovery is
        permanently attributed on-chain to whoever found it.
      </p>
      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["active contributors", "0"],
          ["global seeds/sec", "0"],
          ["chunks verified", "0"],
          ["finds attributed", "0"],
        ].map(([label, value]) => (
          <div key={label} className="border border-[var(--border)] p-3">
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="num mt-1 text-xl">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
