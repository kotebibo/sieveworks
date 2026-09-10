"use client";

import { use, useEffect, useState } from "react";
import {
  fetchJob,
  fetchJobCandidates,
  fetchJobLineages,
  fetchJobOutputs,
  fetchModuleViz,
  specArtifactUrl,
  subscribeEvents,
  type JobDetail,
} from "@/lib/api";
import { VizFrame } from "@/components/VizFrame";
import { Panel } from "@/components/console";
import { Badge, Mono, Skeleton } from "@/components/ui";

/**
 * Runs a module's OWN author-supplied visualization against a job's live
 * output — in a locked-down sandbox (see VizFrame). The page's only job is
 * to fetch the pieces (viz code, wasm URL, the job's data) and hand them in;
 * it never executes author code itself.
 */
export default function VizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [vizJs, setVizJs] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<unknown>(null);

  useEffect(() => {
    fetchJob(id).then((d) => {
      setDetail(d);
      fetchModuleViz(String(d.job.worker_spec_hash)).then(setVizJs).catch(() => setVizJs(null));
    }).catch(() => {});
  }, [id]);

  // Pull whatever the job exposes and hand it to the viz as `data`. The author
  // decides how to draw it (and may call module.trace/score/render on it).
  useEffect(() => {
    if (!detail) return;
    const kind = String(detail.job.bounty_kind ?? "coverage");
    const load = async () => {
      if (kind === "training") {
        const { lineages } = await fetchJobLineages(id).catch(() => ({ lineages: [] }));
        const best = [...lineages].sort((a, b) => Number(b.best_score ?? 0) - Number(a.best_score ?? 0))[0];
        setData({ kind, lineages, best_genome_b64: best?.best_genome_b64 ?? null, best_score: best?.best_score ?? null });
      } else if (kind === "prize") {
        const { candidates, revealed } = await fetchJobCandidates(id).catch(() => ({ candidates: [], revealed: false }));
        setData({ kind, candidates, revealed, best_genome_b64: revealed ? candidates[0]?.candidate_b64 ?? null : null });
      } else {
        const out = await fetchJobOutputs(id).catch(() => ({ outputs: [] }));
        setData({ kind, outputs: out.outputs });
      }
    };
    void load();
    return subscribeEvents((_e, d) => {
      if ((d as { job_id?: string })?.job_id === id) void load();
    });
  }, [detail, id]);

  if (!detail) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-3">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3">
      <div className="panel px-4 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight">{String(detail.job.title)}</h1>
        <p className="num mt-1 text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
          <span>module visualization · {String(detail.job.bounty_kind ?? "coverage")}</span>
          <span className="inline-flex gap-1">spec <Mono value={String(detail.job.worker_spec_hash)} head={10} tail={0} /></span>
          <Badge state={String(detail.job.status)} />
        </p>
      </div>

      <Panel label="◢ module visualization (sandboxed)">
        {vizJs === undefined ? (
          <Skeleton className="h-[420px] w-full" />
        ) : vizJs ? (
          <VizFrame
            vizJs={vizJs}
            wasmUrl={specArtifactUrl(String(detail.job.worker_spec_hash))}
            params={detail.job.params}
            data={data}
            height={420}
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-sm text-[var(--text-faint)]">
            This module ships no visualization. Authors can add one — see the docs.
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          Author-supplied code, run in a locked-down iframe with no access to
          your wallet, storage, or the network — it can only draw.
        </p>
      </Panel>
    </div>
  );
}
