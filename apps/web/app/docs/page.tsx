import { CopyBlock } from "@/components/CopyBlock";

export default function Docs() {
  return (
    <div className="mx-auto max-w-3xl prose-invert">
      <h1 className="font-display font-extrabold text-[clamp(28px,3.4vw,38px)] tracking-[-0.025em]">How Sieveworks works</h1>

      <nav className="mt-6 panel p-4">
        <div className="num text-[12px] text-[var(--text-faint)] mb-2.5">On this page</div>
        <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[14.5px] list-decimal list-inside marker:text-[var(--text-faint)]">
          <li><a href="#idea" className="text-[var(--text-dim)] hover:text-[var(--accent)]">The idea</a></li>
          <li><a href="#safety" className="text-[var(--text-dim)] hover:text-[var(--accent)]">For contributors: trust &amp; safety</a></li>
          <li><a href="#verification" className="text-[var(--text-dim)] hover:text-[var(--accent)]">How results are verified</a></li>
          <li><a href="#contract" className="text-[var(--text-dim)] hover:text-[var(--accent)]">Write your own module: the contract</a></li>
          <li><a href="#determinism" className="text-[var(--text-dim)] hover:text-[var(--accent)]">Determinism rules</a></li>
          <li><a href="#build" className="text-[var(--text-dim)] hover:text-[var(--accent)]">Structure, build, upload</a></li>
          <li><a href="#ai" className="text-[var(--text-dim)] hover:text-[var(--accent)]">Let an AI write it for you</a></li>
        </ol>
      </nav>

      <Section id="idea" title="The idea">
        <p>
          Sieveworks is an exchange for <b>verifiable search</b>: problems that are hard to find but
          easy to check. A funder posts a budget; contributors search chunks of the space on their
          own hardware and get paid per verified chunk. Every discovery is attributed on-chain to
          whoever found it.
        </p>
      </Section>

      <Section id="safety" title="For contributors: trust &amp; safety">
        <ul className="list-disc pl-5 space-y-2.5">
          <li><b>Nothing is installed.</b> The browser worker runs in sandboxed WebAssembly — no filesystem, no network beyond this page, no persistence. The same sandbox that protects you on every website.</li>
          <li><b>Your keys never leave the page.</b> A local worker key is generated in your browser and signs your submissions. Connecting a wallet only registers a payout address — signing never happens inside the sandbox.</li>
          <li><b>The native CLI is reproducible.</b> Its build is content-hashed; you can rebuild and compare. Distributed via <span className="num">npx @sieveworks/worker</span> — no unsigned executable.</li>
        </ul>
      </Section>

      <Section id="verification" title="How results are verified (no redundant execution)">
        <ol className="list-decimal pl-5 space-y-2.5">
          <li><b>Extremum reframing</b> — every chunk answers "what's the best seed here, and its score?" with a witness. There is no fakeable "found nothing."</li>
          <li><b>Witness check</b> — the coordinator re-runs your witness seed in the identical WASM; the score must match exactly.</li>
          <li><b>Honeypots</b> — the coordinator secretly knows some seeds' scores; claiming below a known seed is caught.</li>
          <li><b>Merkle challenge</b> — you commit to per-bucket results with one root; the coordinator challenges random buckets and recomputes them. You can't open a bucket you never computed.</li>
          <li><b>Stake &amp; slash</b> — a small bond makes cheating negative expected value.</li>
        </ol>
        <p className="mt-3 text-[var(--text-dim)]">
          Verification costs under 1% of the work it checks. The coordinator verifies with the exact
          same WASM artifact workers run, pinned by content hash — worker/verifier drift is
          impossible by construction. Every decision is independently re-verifiable via the audit
          endpoint.
        </p>
      </Section>

      <Section id="contract" title="Write your own module: the contract">
        <p>
          A worker module defines a search: candidates are 64-bit integers ("seeds"), and your module
          says how good each one is. It's one WebAssembly module, no dependencies on the platform,
          exporting exactly this C-level ABI:
        </p>
        <pre className="num text-[13.5px] leading-[1.6] bg-[var(--panel-2)] p-4 my-3 overflow-x-auto scroll-thin border border-[var(--border)]">{`int64_t evaluate_seed(uint64_t seed, const char* params_json, int32_t params_len);
    // score one candidate. Higher = better. Return INT64_MIN only for bad params.

int32_t evaluate_range(uint64_t start, uint64_t end,
                       const char* params_json, int32_t params_len, uint8_t* out);
    // scan [start, end) ASCENDING, track the max. Ties: keep the LOWEST seed.
    // write 16 bytes to out: [0..7] int64 max_score LE, [8..15] uint64 max_seed LE.
    // return 0 on success.

const char* spec_version(void);   // static string, e.g. "myworker/0.1.0"
// plus malloc/free (Emscripten provides them). No other imports: no I/O, ever.`}</pre>
        <p className="mt-3">
          The invariant everything rests on:{" "}
          <b>evaluate_range must equal folding evaluate_seed over the same range.</b> The platform
          verifies your claims by re-running single seeds, so the two paths must agree exactly. Params
          arrive as a JSON string (not NUL-terminated; use the length): the job's params field,
          verbatim.
        </p>
      </Section>

      <Section id="determinism" title="Determinism rules (the conformance gate enforces these)">
        <ul className="list-disc pl-5 space-y-2.5">
          <li>No clock, no randomness, no threads, no uninitialized memory, no I/O. Identical inputs must produce identical outputs on every machine.</li>
          <li>Prefer integer arithmetic. If you need floats: IEEE-754 doubles only, and the build must use <span className="num">-ffp-contract=off</span> (no fused multiply-add).</li>
          <li>Keep <span className="num">evaluate_seed</span> fast (microseconds if you can). Cheap single-seed re-checks are what make verification cost under 1%.</li>
        </ul>
        <p className="mt-3 text-[var(--text-dim)]">
          On upload the gate instantiates your module in a sandbox, checks the exports, runs a range
          twice (byte-identical or rejected), and confirms{" "}
          <span className="num">evaluate_seed(max_seed) == max_score</span>. Pass and it's registered,
          content-addressed by sha256; jobs pin that exact hash and the coordinator verifies with the
          same artifact workers run.
        </p>
      </Section>

      <Section id="build" title="Structure, build, upload">
        <ol className="list-decimal pl-5 space-y-2.5">
          <li><b>One self-contained C file</b> (vendor any algorithm code into it). A minimal skeleton: parse params, write <span className="num">score_one(seed)</span>, and use the standard fold loop for <span className="num">evaluate_range</span>.</li>
          <li><b>Build with Emscripten:</b></li>
        </ol>
        <pre className="num text-[13.5px] leading-[1.6] bg-[var(--panel-2)] p-4 my-3 overflow-x-auto scroll-thin border border-[var(--border)]">{`emcc mymodule.c -O2 -ffp-contract=off -sSTANDALONE_WASM --no-entry \\
  -sALLOW_MEMORY_GROWTH \\
  -sEXPORTED_FUNCTIONS=_evaluate_seed,_evaluate_range,_spec_version,_malloc,_free \\
  -o mymodule.wasm`}</pre>
        <ol className="list-decimal pl-5 space-y-2.5 mt-2" start={3}>
          <li><b>Sanity-test locally:</b> run the same range twice (outputs must be byte-identical) and check <span className="num">evaluate_seed(max_seed) == max_score</span> on a few random ranges.</li>
          <li><b>Upload on the Modules page:</b> sign in with your wallet, pick a name, a description, and example params JSON, choose public or private, and submit. The conformance gate runs immediately; on pass your module is live and fundable.</li>
        </ol>
      </Section>

      <Section id="ai" title="Or let an AI write it for you">
        <p className="mb-2">
          Paste this prompt into any capable AI (Claude, ChatGPT, etc.), fill in the marked block with
          your task, and you'll get a buildable module. Everything below the edit block is the exact
          platform contract — leave it unchanged.
        </p>
        <CopyBlock label="sieveworks-module-prompt.txt" text={AI_PROMPT} collapsible />
      </Section>
    </div>
  );
}

const AI_PROMPT = `Build a worker module for Sieveworks (sievework.com), a verifiable distributed
compute platform. Deliverable: ONE self-contained C file that compiles to
WebAssembly with the exact build command below, plus a short sanity-test plan.

=========== EDIT ONLY THIS BLOCK ===========
TASK: <one sentence: what are we searching for?
       e.g. "seeds whose sha256(seed_as_decimal_string + salt) has many leading zero bits">
SCORING: <what makes a candidate good, as a 64-bit signed integer, higher = better;
          define it precisely, e.g. "score = count of leading zero bits, 0..256">
PARAMS: <the JSON keys a job will pass, e.g. {"salt": "abc"} - describe each key's
         type and meaning; the module must parse them from a raw JSON string>
=========== END EDIT BLOCK =================

HARD CONTRACT - do not deviate from any of this:

1. Candidates are uint64_t values called seeds. Scores are int64_t, higher = better.

2. Export exactly these functions (C ABI, compiled with Emscripten):
   int64_t evaluate_seed(uint64_t seed, const char* params_json, int32_t params_len);
     - Score one seed. params_json is NOT NUL-terminated; respect params_len.
     - Return INT64_MIN only to signal invalid params. Never for a valid seed.
   int32_t evaluate_range(uint64_t start, uint64_t end,
                          const char* params_json, int32_t params_len, uint8_t* out);
     - Scan every seed in [start, end) in ASCENDING order, tracking the maximum
       score. On ties keep the LOWEST seed.
     - Write exactly 16 bytes to out: bytes 0-7 = int64 max_score little-endian,
       bytes 8-15 = uint64 max_seed little-endian. Return 0 on success, nonzero on error.
   const char* spec_version(void);
     - Return a static NUL-terminated string like "mymodule/0.1.0".

3. THE CORE INVARIANT: evaluate_range(start, end, ...) must produce exactly the
   result of calling evaluate_seed on every seed in the range and folding with
   (max score, lowest seed wins ties). The platform re-checks single seeds
   against your range claims; any disagreement means the module is rejected.

4. Absolute determinism: no time, no randomness, no threads, no I/O, no reads of
   uninitialized memory, no imports beyond what Emscripten emits for malloc/free.
   Identical inputs must give identical outputs on every machine, forever.

5. Prefer pure integer arithmetic. If floating point is truly unavoidable, use
   IEEE-754 double only, no fast-math, no fused ops (build uses -ffp-contract=off).

6. Keep evaluate_seed fast - microseconds per call if possible. Vendor any
   algorithm code (hashing etc.) directly into the file; no external libraries.

7. Parse the params JSON with a small hand-rolled parser for the specific keys in
   the PARAMS block (no JSON library). Handle missing/malformed keys by returning
   the error values above.

BUILD COMMAND (must compile cleanly with this, no modifications):
emcc mymodule.c -O2 -ffp-contract=off -sSTANDALONE_WASM --no-entry \\
  -sALLOW_MEMORY_GROWTH \\
  -sEXPORTED_FUNCTIONS=_evaluate_seed,_evaluate_range,_spec_version,_malloc,_free \\
  -o mymodule.wasm

DELIVER:
1. The complete C file.
2. The build command above, unchanged.
3. A sanity-test plan: run one range twice and confirm byte-identical output;
   for 3 random ranges confirm evaluate_seed(max_seed) == max_score.
Then upload mymodule.wasm at sievework.com/modules - the conformance gate runs
these same checks and registers the module if they pass.`;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-20 text-[15.5px] leading-[1.7] text-[var(--text)]">
      <h2 className="font-display font-bold text-[21px] tracking-[-0.015em] mb-4">
        <a href={`#${id}`} className="hover:text-[var(--accent)]">{title}</a>
      </h2>
      {children}
    </section>
  );
}
