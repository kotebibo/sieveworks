//! The compute executor — the one thing the browser worker cannot do: run
//! native code (and, later, a wgpu GPU kernel) at full speed.
//!
//! Deliberately narrow: it evaluates a seed range and returns per-bucket
//! extrema. It does NOT touch the coordinator, does NOT sign anything, does
//! NOT hold a key. Signing + Merkle + HTTP stay in the webview frontend
//! (`@sieveworks/protocol`, `@sieveworks/merkle`) exactly as they do in the
//! browser and CLI workers — the host owns the key, never the compute layer.
//! That keeps the desktop client byte-identical to the other two clients and
//! preserves the zero-drift verification property.

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

/// One evaluated bucket: the max score found in it and the seed that produced
/// it. Mirrors the `BucketLeaf` shape the TS merkle package hashes.
#[derive(Debug, Clone, Serialize)]
pub struct BucketLeaf {
    pub index: u32,
    /// Stringified u64 — JS cannot hold a full u64 in a number, and the
    /// protocol carries these as decimal strings everywhere else.
    pub max_score: String,
    pub max_seed: String,
}

#[derive(Debug)]
pub enum ExecError {
    CoreNotFound(PathBuf),
    UnsupportedModule(String),
    Spawn(String),
    NonZeroExit(i32, String),
    Parse(String),
}

impl std::fmt::Display for ExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExecError::CoreNotFound(p) => write!(f, "native core not found at {}", p.display()),
            ExecError::UnsupportedModule(h) => write!(
                f,
                "no native worker for module {} — this module is browser/WASM-only",
                &h[..h.len().min(12)]
            ),
            ExecError::Spawn(e) => write!(f, "failed to spawn native core: {e}"),
            ExecError::NonZeroExit(c, e) => write!(f, "native core exited {c}: {e}"),
            ExecError::Parse(e) => write!(f, "could not parse core output: {e}"),
        }
    }
}
impl std::error::Error for ExecError {}

/// The pinned builtin extremum modules the native worker can run, mapped to
/// their binary basename. Community/uploaded modules are browser/WASM-only —
/// the desktop worker only runs these builtins natively. If a builtin is
/// rebuilt (its content hash changes), update the hash here alongside.
pub const NATIVE_BINARIES: &[(&str, &str)] = &[
    // Minecraft seedfinding
    ("17328b06af18fcba1389b977e7173eaedf2f79a7ef66af707654d4113a32d56f", "sieve_core"),
    // Hash-grind (proof-of-work) — the GPU-kernel target
    ("e1e6730bb1abfa8a83237579a2f90394c1b427722505ee31c5b5c916ab0c05a0", "hashgrind"),
    // Minecraft spawn quality
    ("114a39bdad6c63440989a956b9fb3173511df11e9c2cc9a4245b5869b409a0ef", "spawn_quality"),
];

fn binary_for_spec(spec_hash: &str) -> Option<&'static str> {
    NATIVE_BINARIES.iter().find(|(h, _)| *h == spec_hash).map(|(_, b)| *b)
}

fn with_ext(base: &str) -> String {
    if cfg!(windows) { format!("{base}.exe") } else { base.to_string() }
}

/// Directories to search for a native core, in priority order:
///   1. next to the app executable — where Tauri places bundled sidecars, so a
///      shipped installer is self-contained.
///   2. the monorepo dev build at packages/worker-core/out/native (walking up).
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(mut root) = std::env::current_dir() {
        for _ in 0..5 {
            dirs.push(root.join("packages").join("worker-core").join("out").join("native"));
            if !root.pop() {
                break;
            }
        }
    }
    dirs
}

/// Which builtin native cores are present (bundled or dev), for the UI.
pub fn available_cores() -> Vec<String> {
    let dirs = candidate_dirs();
    NATIVE_BINARIES
        .iter()
        .filter(|(_, b)| dirs.iter().any(|d| d.join(with_ext(b)).exists()))
        .map(|(_, b)| (*b).to_string())
        .collect()
}

/// Resolve the native binary for a job's module. `$SIEVE_CORE` overrides for
/// dev; otherwise the module's spec hash selects the pinned builtin binary.
/// Unknown modules return UnsupportedModule (they must run in the browser).
/// Bundling these as Tauri sidecars for shipped installers is a later step.
pub fn resolve_core(spec_hash: &str) -> Result<PathBuf, ExecError> {
    if let Ok(p) = std::env::var("SIEVE_CORE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
        return Err(ExecError::CoreNotFound(pb));
    }
    let base = binary_for_spec(spec_hash)
        .ok_or_else(|| ExecError::UnsupportedModule(spec_hash.to_string()))?;
    let exe = with_ext(base);
    for dir in candidate_dirs() {
        let candidate = dir.join(&exe);
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(ExecError::CoreNotFound(PathBuf::from(exe)))
}

/// Evaluate `[range_start, range_end)` in buckets of `bucket_size` with the
/// native binary for `spec_hash`, returning one leaf per bucket. Same CLI
/// contract as `apps/cli`: `<binary> eval-range <start> <end> <bucket> <json>`.
pub fn eval_range(
    spec_hash: &str,
    range_start: &str,
    range_end: &str,
    bucket_size: u64,
    params_json: &str,
) -> Result<Vec<BucketLeaf>, ExecError> {
    let core = resolve_core(spec_hash)?;
    let out = Command::new(&core)
        .arg("eval-range")
        .arg(range_start)
        .arg(range_end)
        .arg(bucket_size.to_string())
        .arg(params_json)
        .output()
        .map_err(|e| ExecError::Spawn(e.to_string()))?;

    if !out.status.success() {
        return Err(ExecError::NonZeroExit(
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    parse_leaves(&String::from_utf8_lossy(&out.stdout))
}

/// Parse the core's line-oriented output: `<index> <score> <seed>` per line.
/// Kept separate so it is unit-testable without spawning the binary.
pub fn parse_leaves(stdout: &str) -> Result<Vec<BucketLeaf>, ExecError> {
    let mut leaves = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut it = line.split_whitespace();
        let index = it.next().ok_or_else(|| ExecError::Parse(format!("no index in {line:?}")))?;
        let score = it.next().ok_or_else(|| ExecError::Parse(format!("no score in {line:?}")))?;
        let seed = it.next().ok_or_else(|| ExecError::Parse(format!("no seed in {line:?}")))?;
        leaves.push(BucketLeaf {
            index: index.parse().map_err(|_| ExecError::Parse(format!("bad index {index:?}")))?,
            max_score: score.to_string(),
            max_seed: seed.to_string(),
        });
    }
    Ok(leaves)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_well_formed_output() {
        let leaves = parse_leaves("0 1234 9\n1 5678 42\n").unwrap();
        assert_eq!(leaves.len(), 2);
        assert_eq!(leaves[1].index, 1);
        assert_eq!(leaves[1].max_score, "5678");
        assert_eq!(leaves[1].max_seed, "42");
    }

    #[test]
    fn skips_blank_lines_and_trims() {
        let leaves = parse_leaves("\n  0 1 2  \n\n").unwrap();
        assert_eq!(leaves.len(), 1);
        assert_eq!(leaves[0].max_score, "1");
    }

    #[test]
    fn rejects_short_lines() {
        assert!(parse_leaves("0 1").is_err());
    }
}
