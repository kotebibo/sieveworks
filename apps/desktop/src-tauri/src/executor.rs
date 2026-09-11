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
    Spawn(String),
    NonZeroExit(i32, String),
    Parse(String),
}

impl std::fmt::Display for ExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExecError::CoreNotFound(p) => write!(f, "native core not found at {}", p.display()),
            ExecError::Spawn(e) => write!(f, "failed to spawn native core: {e}"),
            ExecError::NonZeroExit(c, e) => write!(f, "native core exited {c}: {e}"),
            ExecError::Parse(e) => write!(f, "could not parse core output: {e}"),
        }
    }
}
impl std::error::Error for ExecError {}

/// Resolve the native worker-core binary. Precedence:
///   1. `$SIEVE_CORE` (explicit override / bundled sidecar path)
///   2. the monorepo dev build at packages/worker-core/out/native/
/// Bundling this binary as a Tauri sidecar for shipped installers is a later
/// step — documented in the app README, not done here.
pub fn resolve_core() -> Result<PathBuf, ExecError> {
    if let Ok(p) = std::env::var("SIEVE_CORE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
        return Err(ExecError::CoreNotFound(pb));
    }
    let exe = if cfg!(windows) { "sieve_core.exe" } else { "sieve_core" };
    // src-tauri/ -> apps/desktop -> apps -> repo root
    let mut root = std::env::current_dir().map_err(|e| ExecError::Spawn(e.to_string()))?;
    // Walk up to 4 levels looking for the packages/ dir, so `cargo run` from
    // either src-tauri/ or apps/desktop/ resolves the same binary.
    for _ in 0..5 {
        let candidate = root
            .join("packages")
            .join("worker-core")
            .join("out")
            .join("native")
            .join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
        if !root.pop() {
            break;
        }
    }
    Err(ExecError::CoreNotFound(PathBuf::from(format!(
        "packages/worker-core/out/native/{exe}"
    ))))
}

/// Evaluate `[range_start, range_end)` in buckets of `bucket_size`, returning
/// one leaf per bucket. `params_json` is passed opaquely to the core (the
/// per-module parameter blob). Same CLI contract as `apps/cli` uses:
///   sieve_core eval-range <start> <end> <bucket_size> <params_json>
pub fn eval_range(
    range_start: &str,
    range_end: &str,
    bucket_size: u64,
    params_json: &str,
) -> Result<Vec<BucketLeaf>, ExecError> {
    let core = resolve_core()?;
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
