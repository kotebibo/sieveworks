-- Author-supplied visualization (sandboxed). A module may ship a viz_js
-- draw function that the frontend runs in a locked-down iframe (no
-- same-origin, no network) against the module's own output. Public like
-- the wasm — it only ever runs in the viewer's own sandbox.
alter table worker_specs add column viz_js text;
