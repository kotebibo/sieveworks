export default function Docs() {
  return (
    <div className="mx-auto max-w-3xl prose-invert">
      <h1 className="text-lg font-semibold">How Sieveworks works</h1>

      <Section title="The idea">
        <p>
          Sieveworks is an exchange for <b>verifiable search</b>: problems that are hard to find but
          easy to check. A funder posts a budget; contributors search chunks of the space on their
          own hardware and get paid per verified chunk. Every discovery is attributed on-chain to
          whoever found it.
        </p>
      </Section>

      <Section title="For contributors — trust &amp; safety">
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Nothing is installed.</b> The browser worker runs in sandboxed WebAssembly — no filesystem, no network beyond this page, no persistence. The same sandbox that protects you on every website.</li>
          <li><b>Your keys never leave the page.</b> A local worker key is generated in your browser and signs your submissions. Connecting a wallet only registers a payout address — signing never happens inside the sandbox.</li>
          <li><b>The native CLI is reproducible.</b> Its build is content-hashed; you can rebuild and compare. Distributed via <span className="num">npx @sieveworks/worker</span> — no unsigned executable.</li>
        </ul>
      </Section>

      <Section title="How results are verified (no redundant execution)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li><b>Extremum reframing</b> — every chunk answers "what's the best seed here, and its score?" with a witness. There is no fakeable "found nothing."</li>
          <li><b>Witness check</b> — the coordinator re-runs your witness seed in the identical WASM; the score must match exactly.</li>
          <li><b>Honeypots</b> — the coordinator secretly knows some seeds' scores; claiming below a known seed is caught.</li>
          <li><b>Merkle challenge</b> — you commit to per-bucket results with one root; the coordinator challenges random buckets and recomputes them. You can't open a bucket you never computed.</li>
          <li><b>Stake &amp; slash</b> — a small bond makes cheating negative expected value.</li>
        </ol>
        <p className="mt-2 text-[var(--text-dim)]">
          Verification costs under 1% of the work it checks. The coordinator verifies with the exact
          same WASM artifact workers run, pinned by content hash — worker/verifier drift is
          impossible by construction. Every decision is independently re-verifiable via the audit
          endpoint.
        </p>
      </Section>

      <Section title="For new communities — writing a worker">
        <p>
          The platform is game-agnostic. A worker is a WASM module exporting three functions:
        </p>
        <pre className="num text-xs bg-[var(--panel-2)] p-3 overflow-x-auto border border-[var(--border)]">{`evaluate_range(start, end, params) -> per-bucket (max_score, max_seed)
evaluate_seed(seed, params)        -> score      // the verification primitive
spec_version()                     -> string`}</pre>
        <p>
          Both must be deterministic and pure. Jobs pin your module by its sha256; the coordinator
          verifies against that exact artifact. Minecraft is our launch vertical and reference
          implementation — nothing in the protocol knows what Minecraft is.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 text-sm leading-relaxed text-[var(--text)]">
      <h2 className="text-[11px] uppercase tracking-wider text-[var(--accent)] mb-2">{title}</h2>
      {children}
    </section>
  );
}
