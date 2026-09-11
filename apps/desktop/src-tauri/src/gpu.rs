//! GPU hash-grind kernel (the flagship desktop-only compute path).
//!
//! Scores seeds by the leading-zero bits of sha256(seed_le_8 ‖ salt) — the
//! exact scoring of the `hashgrind` builtin (packages/worker-core/src/
//! hashgrind.c) — on the GPU via a WGSL compute shader. wgpu targets
//! Vulkan/Metal/DX12/GL behind one shader, so this one kernel runs on any GPU.
//!
//! ZERO-DRIFT IS NON-NEGOTIABLE: a GPU score that differs from the WASM/native
//! reference by one bit makes an honest worker look like a cheat. So the GPU
//! path is gated by a self-conformance check (`selfcheck` below): it runs the
//! GPU and the native core on the same sample and only activates if every
//! bucket matches. A buggy shader therefore never produces a wrong submission —
//! it just stays disabled and the CPU path is used instead.
//!
//! The GPU computes only the expensive part (the hashes → per-seed scores);
//! the per-bucket extremum fold is done on the CPU here, identically to the
//! native core (ascending, strictly-greater → lowest seed wins ties).

use std::sync::OnceLock;

use crate::executor::BucketLeaf;

const WGSL: &str = r#"
struct Params {
  base_lo: u32,
  base_hi: u32,
  salt_len: u32,
  count: u32,
  salt: array<vec4<u32>, 4>,   // up to 64 salt bytes, packed 4-per-u32 little-endian
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> out_scores: array<u32>;

fn salt_word(w: u32) -> u32 { return P.salt[w / 4u][w % 4u]; }

// i-th byte of the padded sha256 message for a given seed.
fn mbyte(i: u32, seed_lo: u32, seed_hi: u32) -> u32 {
  let msg_len = 8u + P.salt_len;                 // seed(8) ‖ salt
  let padded = select(128u, 64u, msg_len < 56u); // one or two 64-byte blocks
  if (i < 4u) { return (seed_lo >> (8u * i)) & 0xffu; }
  if (i < 8u) { return (seed_hi >> (8u * (i - 4u))) & 0xffu; }
  if (i < msg_len) {
    let s = i - 8u;
    return (salt_word(s / 4u) >> (8u * (s % 4u))) & 0xffu;
  }
  if (i == msg_len) { return 0x80u; }            // padding delimiter
  if (i >= padded - 8u) {                        // 64-bit big-endian bit length
    let bits = msg_len * 8u;                      // < 2^16 for our sizes
    let pos = i - (padded - 8u);
    if (pos == 6u) { return (bits >> 8u) & 0xffu; }
    if (pos == 7u) { return bits & 0xffu; }
    return 0u;
  }
  return 0u;
}

fn word_be(block_base: u32, wi: u32, seed_lo: u32, seed_hi: u32) -> u32 {
  let b = block_base + wi * 4u;
  return (mbyte(b, seed_lo, seed_hi) << 24u)
       | (mbyte(b + 1u, seed_lo, seed_hi) << 16u)
       | (mbyte(b + 2u, seed_lo, seed_hi) << 8u)
       |  mbyte(b + 3u, seed_lo, seed_hi);
}

const K = array<u32, 64>(
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
);

fn ror(x: u32, r: u32) -> u32 { return (x >> r) | (x << (32u - r)); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= P.count) { return; }

  // seed = base + idx (64-bit add via two u32 with carry)
  let seed_lo = P.base_lo + idx;
  let carry = select(0u, 1u, seed_lo < P.base_lo);
  let seed_hi = P.base_hi + carry;

  var s = array<u32, 8>(
    0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
    0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u
  );
  let msg_len = 8u + P.salt_len;
  let n_blocks = select(2u, 1u, msg_len < 56u);

  for (var blk = 0u; blk < n_blocks; blk = blk + 1u) {
    var w: array<u32, 64>;
    for (var i = 0u; i < 16u; i = i + 1u) {
      w[i] = word_be(blk * 64u, i, seed_lo, seed_hi);
    }
    for (var i = 16u; i < 64u; i = i + 1u) {
      let s0 = ror(w[i-15u],7u) ^ ror(w[i-15u],18u) ^ (w[i-15u] >> 3u);
      let s1 = ror(w[i-2u],17u) ^ ror(w[i-2u],19u) ^ (w[i-2u] >> 10u);
      w[i] = w[i-16u] + s0 + w[i-7u] + s1;
    }
    var a = s[0]; var b = s[1]; var c = s[2]; var d = s[3];
    var e = s[4]; var f = s[5]; var g = s[6]; var h = s[7];
    for (var i = 0u; i < 64u; i = i + 1u) {
      let S1 = ror(e,6u) ^ ror(e,11u) ^ ror(e,25u);
      let ch = (e & f) ^ (~e & g);
      let t1 = h + S1 + ch + K[i] + w[i];
      let S0 = ror(a,2u) ^ ror(a,13u) ^ ror(a,22u);
      let maj = (a & b) ^ (a & c) ^ (b & c);
      let t2 = S0 + maj;
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    s[0] = s[0] + a; s[1] = s[1] + b; s[2] = s[2] + c; s[3] = s[3] + d;
    s[4] = s[4] + e; s[5] = s[5] + f; s[6] = s[6] + g; s[7] = s[7] + h;
  }

  // leading zero bits of the 256-bit big-endian hash
  var lz = 0u;
  for (var j = 0u; j < 8u; j = j + 1u) {
    if (s[j] == 0u) { lz = lz + 32u; continue; }
    lz = lz + countLeadingZeros(s[j]);
    break;
  }
  out_scores[idx] = lz;
}
"#;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    base_lo: u32,
    base_hi: u32,
    salt_len: u32,
    count: u32,
    salt: [u32; 16],
}

struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    bind_layout: wgpu::BindGroupLayout,
    backend: String,
}

static GPU: OnceLock<Option<Gpu>> = OnceLock::new();

fn init_gpu() -> Option<Gpu> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))?;
    let backend = format!("{:?}", adapter.get_info().backend);
    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("sieve-gpu"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            memory_hints: wgpu::MemoryHints::Performance,
        },
        None,
    ))
    .ok()?;

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("hashgrind"),
        source: wgpu::ShaderSource::Wgsl(WGSL.into()),
    });
    let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("hashgrind-bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: false },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("hashgrind-pl"),
        bind_group_layouts: &[&bind_layout],
        push_constant_ranges: &[],
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("hashgrind-pipeline"),
        layout: Some(&pipeline_layout),
        module: &shader,
        entry_point: "main",
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });

    Some(Gpu { device, queue, pipeline, bind_layout, backend })
}

fn gpu() -> Option<&'static Gpu> {
    GPU.get_or_init(init_gpu).as_ref()
}

/// True if a usable GPU adapter was found; carries the backend name for the UI.
pub fn gpu_backend() -> Option<String> {
    gpu().map(|g| g.backend.clone())
}

fn pack_salt(salt: &[u8]) -> [u32; 16] {
    let mut out = [0u32; 16];
    for (i, &byte) in salt.iter().take(64).enumerate() {
        out[i / 4] |= (byte as u32) << (8 * (i % 4));
    }
    out
}

/// Score `count` seeds starting at `base_seed` on the GPU. Returns one score
/// (leading-zero bits) per seed, indexed by (seed - base_seed).
fn score_range(salt: &[u8], base_seed: u64, count: u32) -> Option<Vec<u32>> {
    let g = gpu()?;
    if count == 0 {
        return Some(vec![]);
    }
    let params = Params {
        base_lo: base_seed as u32,
        base_hi: (base_seed >> 32) as u32,
        salt_len: salt.len().min(64) as u32,
        count,
        salt: pack_salt(salt),
    };
    let out_bytes = (count as u64) * 4;

    use wgpu::util::DeviceExt;
    let param_buf = g.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("params"),
        contents: bytemuck::bytes_of(&params),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let out_buf = g.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scores"),
        size: out_bytes,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let staging = g.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("staging"),
        size: out_bytes,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("bind"),
        layout: &g.bind_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: param_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: out_buf.as_entire_binding() },
        ],
    });

    let mut enc = g.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    {
        let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: None,
            timestamp_writes: None,
        });
        pass.set_pipeline(&g.pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.dispatch_workgroups(count.div_ceil(64), 1, 1);
    }
    enc.copy_buffer_to_buffer(&out_buf, 0, &staging, 0, out_bytes);
    g.queue.submit(Some(enc.finish()));

    let slice = staging.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
    g.device.poll(wgpu::Maintain::Wait);
    rx.recv().ok()?.ok()?;
    let data = slice.get_mapped_range();
    let scores: Vec<u32> = bytemuck::cast_slice(&data).to_vec();
    drop(data);
    staging.unmap();
    Some(scores)
}

/// GPU extremum fold, identical to the native core: over `[start, end)` in
/// buckets of `bucket_size`, each bucket's leaf is (max score, lowest seed at
/// that score). Returns None if no GPU or the scoring can't run.
pub fn eval_range_gpu(
    salt: &[u8],
    range_start: u64,
    range_end: u64,
    bucket_size: u64,
) -> Option<Vec<BucketLeaf>> {
    gpu()?; // bail early if no adapter
    if range_end <= range_start {
        return Some(vec![]);
    }
    let total = range_end - range_start;
    let scores = score_range(salt, range_start, u32::try_from(total).ok()?)?;

    let mut leaves = Vec::new();
    let mut index: u32 = 0;
    let mut bucket_start = range_start;
    while bucket_start < range_end {
        let bucket_end = (bucket_start + bucket_size).min(range_end);
        let mut best_score: u32 = 0;
        let mut best_seed: u64 = bucket_start;
        let mut first = true;
        let mut seed = bucket_start;
        while seed < bucket_end {
            let sc = scores[(seed - range_start) as usize];
            // ascending, STRICTLY greater → lowest seed wins ties (matches C)
            if first || sc > best_score {
                best_score = sc;
                best_seed = seed;
                first = false;
            }
            seed += 1;
        }
        leaves.push(BucketLeaf {
            index,
            max_score: best_score.to_string(),
            max_seed: best_seed.to_string(),
        });
        index += 1;
        bucket_start = bucket_end;
    }
    Some(leaves)
}

const HASHGRIND_HASH: &str = "e1e6730bb1abfa8a83237579a2f90394c1b427722505ee31c5b5c916ab0c05a0";

fn check_one(salt: &[u8]) -> bool {
    let (start, end, bucket) = (0u64, 4096u64, 512u64);
    let Some(gpu_leaves) = eval_range_gpu(salt, start, end, bucket) else { return false };
    let params = format!("{{\"salt\":\"{}\"}}", String::from_utf8_lossy(salt));
    let Ok(cpu_leaves) = crate::executor::eval_range(
        HASHGRIND_HASH, &start.to_string(), &end.to_string(), bucket, &params,
    ) else { return false };
    gpu_leaves.len() == cpu_leaves.len()
        && gpu_leaves.iter().zip(cpu_leaves.iter()).all(|(a, b)| {
            a.max_score == b.max_score && a.max_seed == b.max_seed
        })
}

/// Self-conformance gate: run the GPU and the native core on the same samples
/// and confirm every bucket matches bit-for-bit — testing BOTH the one-block
/// (short salt) and two-block (long salt) sha256 paths. Cached; runs once. If
/// it fails (or there's no GPU / no native core), the caller uses the CPU path,
/// so a buggy shader can never produce a wrong submission.
pub fn selfcheck() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        gpu().is_some()
            && check_one(b"") // 1 block (message = 8 seed bytes)
            && check_one(b"sieveworks-conformance-salt-spanning-two-sha256-blocks") // 2 blocks
    })
}
