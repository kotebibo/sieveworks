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
    range_start: String,
    range_end: String,
    bucket_size: u64,
    params_json: String,
) -> Result<EvalResult, String> {
    let core = executor::resolve_core().map_err(|e| e.to_string())?;
    let leaves = executor::eval_range(&range_start, &range_end, bucket_size, &params_json)
        .map_err(|e| e.to_string())?;
    Ok(EvalResult {
        core_path: core.display().to_string(),
        leaves,
    })
}

/// Report whether a usable native core is present, so the UI can show a clear
/// "install the worker core" state instead of failing mid-lease.
#[tauri::command]
fn core_status() -> Result<String, String> {
    executor::resolve_core()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![eval_range, core_status])
        .run(tauri::generate_context!())
        .expect("error while running Sieveworks desktop");
}
