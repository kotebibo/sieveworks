//! Sieveworks desktop shell. The webview loads our frontend (`src/`), which
//! owns the coordinator protocol, ed25519 signing and Merkle commitments —
//! identical to the browser worker. This Rust side exposes exactly one job:
//! run the compute the browser can't, via the `eval_range` command.

mod executor;

use serde::Serialize;

#[derive(Serialize)]
struct EvalResult {
    core_path: String,
    leaves: Vec<executor::BucketLeaf>,
}

/// Command invoked from the frontend worker loop after it leases a chunk.
/// Returns one leaf per bucket; the frontend builds the Merkle root, signs the
/// result with its local key, and submits — this fn never sees the key.
#[tauri::command]
fn eval_range(
    spec_hash: String,
    range_start: String,
    range_end: String,
    bucket_size: u64,
    params_json: String,
) -> Result<EvalResult, String> {
    let core = executor::resolve_core(&spec_hash).map_err(|e| e.to_string())?;
    let leaves = executor::eval_range(&spec_hash, &range_start, &range_end, bucket_size, &params_json)
        .map_err(|e| e.to_string())?;
    Ok(EvalResult {
        core_path: core.display().to_string(),
        leaves,
    })
}

/// Report which builtin native cores are present, so the UI can show what the
/// machine can run (and tell the user a job's module is browser-only).
#[tauri::command]
fn core_status() -> Result<Vec<String>, String> {
    Ok(executor::available_cores())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![eval_range, core_status])
        .run(tauri::generate_context!())
        .expect("error while running Sieveworks desktop");
}
