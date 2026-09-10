"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Runs an author-supplied visualization in a LOCKED-DOWN iframe.
 *
 * Security model (the module author is untrusted):
 *   - sandbox="allow-scripts" WITHOUT allow-same-origin → the frame is a
 *     null/opaque origin. It cannot read the parent's localStorage (where the
 *     worker key lives), cookies, wallet, or DOM. Cross-origin access throws.
 *   - CSP inside the frame: default-src 'none', connect-src 'none' → no
 *     network of any kind. img/style limited to inline. Only inline script
 *     runs (needed for the harness + author code).
 *   - The author code receives data ONLY via postMessage and draws to its own
 *     canvas. Nothing it can do reaches the parent page or the network.
 *   - WASM instantiates INSIDE the sandbox with every import stubbed (no I/O),
 *     so an author viz can trace/score/render its own module for rich visuals
 *     without any capability leaking out.
 *
 * Author contract (documented in /docs): the viz defines
 *   globalThis.render = ({ ctx, width, height, t, data, params, module }) => {}
 * and optionally globalThis.setup = ({ width, height, params, module }) => {}.
 * `module` exposes trace(bytes), score(bytes), render(start,end) over the
 * job's pinned WASM. `data` is whatever the job surfaces (outputs / lineages).
 */

// The in-sandbox harness. NO backticks inside (this whole thing is a template
// literal); strings use single/double quotes only.
const HARNESS = `
'use strict';
var Mod = null, DATA = null, PARAMS = {}, started = false, frame = 0;
var cvs = document.getElementById('c'), ctx = cvs.getContext('2d');

function err(m){ try{ parent.postMessage({__viz:'error', message:String(m)}, '*'); }catch(e){} }
window.onerror = function(m){ err(m); return true; };

// ---- minimal no-import WASM host (mirrors @sieveworks/wasm-runtime) ----
function loadModule(bytes){
  var mod = new WebAssembly.Module(bytes);
  var imports = {};
  WebAssembly.Module.imports(mod).forEach(function(im){
    if (im.kind !== 'function') return;
    imports[im.module] = imports[im.module] || {};
    imports[im.module][im.name] = (im.name === 'proc_exit')
      ? function(c){ throw new Error('proc_exit('+c+')'); } : function(){ return 0; };
  });
  var inst = new WebAssembly.Instance(mod, imports);
  var e = inst.exports;
  if (e._initialize) e._initialize();
  function mem(){ return e.memory.buffer; }
  function write(u8){ var p = e.malloc(u8.length); new Uint8Array(mem()).set(u8, p); return {p:p, n:u8.length}; }
  function readParams(pj){ return write(new TextEncoder().encode(pj)); }
  // author-facing helpers over the standard exports
  return {
    exports: e,
    trace: function(candBytes){
      var c = write(candBytes), pr = readParams(JSON.stringify(PARAMS)), cap = 65536, out = e.malloc(cap);
      try {
        var len = e.trace_candidate(c.p, c.n, pr.p, pr.n, out, cap);
        if (len <= 0) throw new Error('trace_candidate rc='+len);
        return new Uint8Array(mem().slice(out, out+len));
      } finally { e.free(out); e.free(pr.p); e.free(c.p); }
    },
    score: function(candBytes){
      var c = write(candBytes), pr = readParams(JSON.stringify(PARAMS));
      try { return e.evaluate_candidate(c.p, c.n, pr.p, pr.n); }
      finally { e.free(pr.p); e.free(c.p); }
    },
    render: function(start, end){
      var pr = readParams(JSON.stringify(PARAMS)), cap = 65536, out = e.malloc(cap);
      try {
        var len = e.render_bucket(BigInt(start), BigInt(end), pr.p, pr.n, out, cap);
        if (len <= 0) throw new Error('render_bucket rc='+len);
        return new Uint8Array(mem().slice(out, out+len));
      } finally { e.free(out); e.free(pr.p); }
    }
  };
}

function loop(){
  requestAnimationFrame(loop);
  if (!started || typeof globalThis.render !== 'function') return;
  try {
    globalThis.render({ ctx: ctx, width: cvs.width, height: cvs.height,
      t: frame, data: DATA, params: PARAMS, module: Mod });
    frame++;
  } catch(e){ err(e && e.message || e); started = false; }
}

window.addEventListener('message', function(ev){
  var m = ev.data || {};
  if (m.__viz === 'wasm') {
    try { Mod = loadModule(new Uint8Array(m.bytes)); } catch(e){ err('wasm load: '+(e.message||e)); }
  } else if (m.__viz === 'data') {
    DATA = m.data; if (m.params) PARAMS = m.params;
    if (!started) {
      if (typeof globalThis.setup === 'function') { try { globalThis.setup({ width: cvs.width, height: cvs.height, params: PARAMS, module: Mod }); } catch(e){ err(e.message||e); } }
      started = true;
    }
  } else if (m.__viz === 'size') {
    cvs.width = m.w; cvs.height = m.h;
  }
});
requestAnimationFrame(loop);
parent.postMessage({__viz:'ready'}, '*');
`;

function buildSrcDoc(authorJs: string): string {
  // 'wasm-unsafe-eval' lets the sandbox instantiate the pinned module WASM
  // (compute only) WITHOUT permitting general eval(); connect-src 'none'
  // still blocks every network path, so nothing can be exfiltrated.
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  // Author code is injected as a SEPARATE inline script after the harness.
  // It cannot escape the sandbox; a syntax error is caught by window.onerror.
  return (
    "<!doctype html><html><head><meta charset='utf-8'>" +
    "<meta http-equiv='Content-Security-Policy' content=\"" + csp + "\">" +
    "<style>html,body{margin:0;background:#0a0a0c;overflow:hidden}canvas{display:block;width:100%;height:100%}</style>" +
    "</head><body><canvas id='c' width='720' height='420'></canvas>" +
    "<script>" + HARNESS + "</scr" + "ipt>" +
    "<script>" + authorJs + "</scr" + "ipt>" +
    "</body></html>"
  );
}

export function VizFrame({
  vizJs,
  wasmUrl,
  params,
  data,
  height = 420,
}: {
  vizJs: string;
  wasmUrl: string;
  params: Record<string, unknown>;
  data: unknown;
  height?: number;
}) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasmSent = useRef(false);

  // Receive ready/error signals from the sandbox. Source check is loose on
  // purpose: a null-origin sandboxed iframe reports ev.source that doesn't
  // always === contentWindow across engines, and only our harness ever emits
  // __viz messages, so keying on that marker is the reliable signal.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as { __viz?: string; message?: string };
      if (m?.__viz === "ready") setReady(true);
      else if (m?.__viz === "error") setError(m.message ?? "viz error");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Once ready: hand over the module WASM (fetched by the PARENT — the sandbox
  // has no network), then stream data/params.
  useEffect(() => {
    if (!ready) return;
    const win = ref.current?.contentWindow;
    if (!win) return;
    (async () => {
      if (!wasmSent.current) {
        try {
          const bytes = await (await fetch(wasmUrl)).arrayBuffer();
          win.postMessage({ __viz: "wasm", bytes }, "*", [bytes]);
          wasmSent.current = true;
        } catch {
          /* viz can still run without the module for data-only draws */
        }
      }
      win.postMessage({ __viz: "data", data, params }, "*");
    })();
  }, [ready, data, params, wasmUrl]);

  return (
    <div className="relative">
      <iframe
        ref={ref}
        title="module visualization"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={buildSrcDoc(vizJs)}
        onLoad={() => setReady(true)}
        style={{ width: "100%", height, border: "none", borderRadius: 12, background: "#0a0a0c" }}
      />
      {error && (
        <div className="absolute bottom-2 left-2 right-2 num text-[11px] px-2 py-1 rounded"
          style={{ background: "var(--panel-2)", color: "var(--rejected)" }}>
          viz error: {error}
        </div>
      )}
    </div>
  );
}
