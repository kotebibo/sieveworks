//! Sieveworks desktop shell. The webview loads our frontend (`src/`), which
//! owns the coordinator protocol, ed25519 signing and Merkle commitments —
//! identical to the browser worker. This Rust side exposes exactly one job:
//! run the compute the browser can't, via the `eval_range` command.

mod executor;
mod gpu;

use serde::Serialize;

const HASHGRIND_HASH: &str = "e1e6730bb1abfa8a83237579a2f90394c1b427722505ee31c5b5c916ab0c05a0";

#[derive(Serialize)]
struct EvalResult {
    core_path: String,
    leaves: Vec<executor::BucketLeaf>,
}

/// Extract the ascii salt from a hashgrind params blob, or None if absent.
fn parse_salt(params_json: &str) -> Option<Vec<u8>> {
    let v: serde_json::Value = serde_json::from_str(params_json).ok()?;
    Some(v.get("salt")?.as_str()?.as_bytes().to_vec())
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
    // GPU fast path — hashgrind only, and ONLY if it self-conforms to the
    // native core (bit-for-bit). Any failure falls through to the CPU core, so
    // the GPU can never produce a rejectable submission.
    if spec_hash == HASHGRIND_HASH && gpu::selfcheck() {
        if let (Some(salt), Ok(start), Ok(end)) =
            (parse_salt(&params_json), range_start.parse::<u64>(), range_end.parse::<u64>())
        {
            if let Some(leaves) = gpu::eval_range_gpu(&salt, start, end, bucket_size) {
                let backend = gpu::gpu_backend().unwrap_or_else(|| "gpu".into());
                return Ok(EvalResult { core_path: format!("gpu:{backend}"), leaves });
            }
        }
    }

    let core = executor::resolve_core(&spec_hash).map_err(|e| e.to_string())?;
    let leaves = executor::eval_range(&spec_hash, &range_start, &range_end, bucket_size, &params_json)
        .map_err(|e| e.to_string())?;
    Ok(EvalResult {
        core_path: core.display().to_string(),
        leaves,
    })
}

/// Report the GPU backend if a usable adapter exists and it self-conforms to
/// the native core, else None (the UI shows "CPU only").
#[tauri::command]
fn gpu_status() -> Option<String> {
    if gpu::selfcheck() { gpu::gpu_backend() } else { None }
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
        .invoke_handler(tauri::generate_handler![eval_range, core_status, gpu_status])
        .run(tauri::generate_context!())
        .expect("error while running Sieveworks desktop");
}
