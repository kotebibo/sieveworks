"use client";

import { use, useEffect, useRef, useState } from "react";
import { fetchJob, fetchJobOutputs, subscribeEvents, type JobDetail } from "@/lib/api";
import { Panel } from "@/components/console";
import { Badge, Mono, Progress, Skeleton, fmt } from "@/components/ui";

/**
 * The render view: verified tiles assemble into the image as the swarm
 * delivers them — distributed compute you can literally watch. Palette 0 =
 * inside the set (deep ink); 1..255 ramp cream → amber (Daylight).
 */
export default function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [tiles, setTiles] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painted = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchJob(id).then(setDetail).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!detail) return;
    const grid = Number(detail.job.params?.grid ?? 4096);
    const tile = Number(detail.job.params?.tile ?? 64);
    const perSide = Math.floor(grid / tile);

    const paint = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { outputs } = await fetchJobOutputs(id).catch(() => ({ outputs: [] }));
      let painted_now = 0;
      for (const o of outputs) {
        if (painted.current.has(o.unit)) continue;
        const bytes = Uint8Array.from(atob(o.bytes_b64), (c) => c.charCodeAt(0));
        if (bytes.length !== tile * tile) continue;
        const unit = Number(o.unit);
        const tx = unit % perSide;
        const ty = Math.floor(unit / perSide);
        const img = ctx.createImageData(tile, tile);
        for (let i = 0; i < bytes.length; i++) {
          const v = bytes[i]!;
          // Daylight ramp: in-set = deep ink; escapes glow cream → amber →
          // ember, vivid against the light frame (amber is the render color).
          const t = v / 255;
          img.data[i * 4 + 0] = v === 0 ? 27 : Math.round(255 - 40 * t);
          img.data[i * 4 + 1] = v === 0 ? 34 : Math.round(244 - 150 * t);
          img.data[i * 4 + 2] = v === 0 ? 51 : Math.round(214 - 200 * t);
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, tx * tile, ty * tile);
        painted.current.add(o.unit);
        painted_now++;
      }
      if (painted_now > 0) setTiles(painted.current.size);
    };

    void paint();
    return subscribeEvents((_e, data) => {
      if ((data as { job_id?: string })?.job_id === id) void paint();
    });
  }, [detail, id]);

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const grid = Number(detail.job.params?.grid ?? 4096);
  const tile = Number(detail.job.params?.tile ?? 64);
  const totalTiles = Math.floor(grid / tile) ** 2;

  return (
    <div className="mx-auto max-w-[1100px] space-y-3">
      <div className="panel ticked px-4 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight">{String(detail.job.title)}</h1>
        <p className="num mt-1 text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
          <span>distributed render · {grid}×{grid} px · {fmt(totalTiles)} tiles</span>
          <span className="inline-flex gap-1">spec <Mono value={String(detail.job.worker_spec_hash)} head={10} tail={0} /></span>
          <Badge state={String(detail.job.status)} />
        </p>
        <div className="mt-3 max-w-md"><Progress done={tiles} total={totalTiles} /></div>
        <p className="num mt-1 text-xs text-[var(--text-dim)]">
          <span className="text-[var(--accent)]">{fmt(tiles)}</span>/{fmt(totalTiles)} tiles verified & delivered
        </p>
      </div>

      <Panel label="◢ swarm render" right={`${fmt(tiles)} / ${fmt(totalTiles)}`}>
        <div className="overflow-auto scroll-thin flex justify-center rounded-xl bg-[var(--panel-2)] p-3">
          <canvas
            ref={canvasRef}
            width={grid}
            height={grid}
            style={{ maxWidth: "100%", imageRendering: "pixelated", borderRadius: 8 }}
          />
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          Every tile you see was committed to a Merkle root, spot-verified by
          recomputation, and digest-checked on delivery. Missing tiles are
          still being computed by the swarm.
        </p>
      </Panel>
    </div>
  );
}
