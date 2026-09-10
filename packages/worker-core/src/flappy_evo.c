#include <stdint.h>
#include <string.h>

/*
 * Sieveworks "AI learns to fly" evolutionary module (prize bounties).
 * A candidate is a tiny MLP genome (i16 weights) steering a flappy-style
 * bird through a pipe course generated from the job's forced prize_salt —
 * every bounty gets a DIFFERENT course, so a winning genome from one job
 * crashes on another (anti-reuse by construction, and visibly so).
 *
 * Determinism: all physics in Q16.16 fixed point (i32/i64), pipe course
 * from splitmix64(prize_salt ‖ pipe_index). No floats anywhere.
 *
 * ABI: evaluate_candidate (fitness), candidate_max_len, trace_candidate
 * (replay data for the browser canvas), spec_version. Candidate-only
 * module: no range ABI, so it serves prize bounties, not coverage jobs.
 *
 * params JSON: { "prize_salt": "<u64 decimal string>", "max_ticks": 3000 }
 *
 * Genome layout (i16 LE, 130 bytes): W1[6*8] ‖ b1[8] ‖ W2[8] ‖ b2[1].
 * Net: in[6] -> ReLU(8) -> out; flap when out > 0.
 * Inputs (Q8 scaled to ±~127): bird y, velocity, dx/dy to next gap,
 * dx/dy to the following gap.
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define SIEVE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SIEVE_EXPORT
#endif

#define Q 16                    /* Q16.16 */
#define ONE (1 << Q)
#define GENOME_LEN 130          /* 65 i16 weights */
#define N_IN 6
#define N_H 8

/* World constants (pixels in Q16.16 where noted) */
#define WORLD_H 480
#define BIRD_X 120
#define GRAVITY ((ONE * 22) / 64)      /* px/tick^2 */
#define FLAP_V (-(ONE * 5))            /* px/tick */
#define MAX_V (ONE * 8)
#define PIPE_SPEED (ONE * 3)           /* px/tick */
#define PIPE_SPACING 220               /* px between pipes */
#define PIPE_GAP 150                   /* gap height px */
#define PIPE_W 52
#define FIRST_PIPE_X 400

static uint64_t splitmix64(uint64_t x) {
  x += 0x9e3779b97f4a7c15ULL;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
  return x ^ (x >> 31);
}

/* Gap CENTER y for pipe i, in [90, WORLD_H-90]. */
static int32_t gap_center(uint64_t salt, uint32_t i) {
  uint64_t r = splitmix64(salt ^ (0xC0FFEEULL + i));
  return 90 + (int32_t)(r % (uint64_t)(WORLD_H - 180));
}

/* Minimal params scan: integer or quoted-integer value for "key". */
static int scan_u64(const char *json, int32_t len, const char *key, uint64_t *out) {
  int32_t klen = (int32_t)strlen(key);
  for (int32_t i = 0; i + klen + 3 < len; i++) {
    if (json[i] == '"' && memcmp(json + i + 1, key, (size_t)klen) == 0 && json[i + 1 + klen] == '"') {
      int32_t j = i + klen + 2;
      while (j < len && (json[j] == ':' || json[j] == ' ' || json[j] == '"')) j++;
      if (j >= len || json[j] < '0' || json[j] > '9') return 0;
      uint64_t v = 0;
      while (j < len && json[j] >= '0' && json[j] <= '9') { v = v * 10 + (uint64_t)(json[j] - '0'); j++; }
      *out = v;
      return 1;
    }
  }
  return 0;
}

typedef struct {
  int32_t y;      /* Q16.16 px */
  int32_t v;      /* Q16.16 px/tick */
  int32_t scroll; /* Q16.16 px scrolled */
  uint32_t pipes_passed;
} Bird;

/* Net forward pass. Inputs Q8 (≈ -128..127); weights i16 read as-is;
 * accumulate in i64; hidden shift >>7 keeps ranges tame. Flap if out > 0. */
static int net_flap(const int16_t *g, const int32_t in[N_IN]) {
  int32_t h[N_H];
  for (int j = 0; j < N_H; j++) {
    int64_t acc = (int64_t)g[N_IN * N_H + j] << 7; /* bias */
    for (int i = 0; i < N_IN; i++) acc += (int64_t)g[j * N_IN + i] * in[i];
    int32_t v = (int32_t)(acc >> 7);
    h[j] = v > 0 ? v : 0; /* ReLU */
  }
  int64_t out = (int64_t)g[N_IN * N_H + N_H + N_H] << 7; /* b2 */
  for (int j = 0; j < N_H; j++) out += (int64_t)g[N_IN * N_H + N_H + j] * h[j];
  return out > 0;
}

static void sense(const Bird *b, uint64_t salt, int32_t in[N_IN]) {
  int32_t scroll_px = b->scroll >> Q;
  /* next pipe index whose x (world) is still ahead of the bird */
  int32_t world_bird_x = BIRD_X + scroll_px;
  uint32_t next = 0;
  while ((int32_t)(FIRST_PIPE_X + (int64_t)next * PIPE_SPACING) + PIPE_W < world_bird_x) next++;
  int32_t p1x = FIRST_PIPE_X + (int32_t)next * PIPE_SPACING;
  int32_t p2x = p1x + PIPE_SPACING;
  int32_t g1 = gap_center(salt, next);
  int32_t g2 = gap_center(salt, next + 1);
  int32_t by = b->y >> Q;
  /* Normalize to ≈ ±127 (Q8-ish magnitudes) */
  in[0] = (by - WORLD_H / 2) * 127 / (WORLD_H / 2);
  in[1] = (b->v >> Q) * 16;
  in[2] = (p1x - world_bird_x) * 127 / PIPE_SPACING;
  in[3] = (g1 - by) * 127 / WORLD_H;
  in[4] = (p2x - world_bird_x) * 127 / (2 * PIPE_SPACING);
  in[5] = (g2 - by) * 127 / WORLD_H;
}

/* Advance one tick. Returns 0 on death, 1 alive. */
static int step(Bird *b, uint64_t salt, const int16_t *g) {
  int32_t in[N_IN];
  sense(b, salt, in);
  if (net_flap(g, in)) b->v = FLAP_V;
  b->v += GRAVITY;
  if (b->v > MAX_V) b->v = MAX_V;
  b->y += b->v;
  b->scroll += PIPE_SPEED;
  int32_t by = b->y >> Q;
  if (by <= 0 || by >= WORLD_H) return 0;
  int32_t scroll_px = b->scroll >> Q;
  int32_t world_bird_x = BIRD_X + scroll_px;
  /* collision with the pipe whose x-span contains the bird */
  int32_t rel = world_bird_x - FIRST_PIPE_X;
  if (rel >= 0) {
    int32_t idx = rel / PIPE_SPACING;
    int32_t px = FIRST_PIPE_X + idx * PIPE_SPACING;
    if (world_bird_x >= px && world_bird_x <= px + PIPE_W) {
      int32_t gc = gap_center(salt, (uint32_t)idx);
      if (by < gc - PIPE_GAP / 2 || by > gc + PIPE_GAP / 2) return 0;
    }
    /* pipes passed = count of pipes whose right edge is behind the bird
     * (computed directly — the scroll step is >1px, an equality test on a
     * single x would skip pipes) */
    int32_t cleared = world_bird_x - FIRST_PIPE_X - PIPE_W;
    if (cleared > 0) b->pipes_passed = (uint32_t)(cleared / PIPE_SPACING) + 1;
  }
  return 1;
}

static int parse(const char *params, int32_t plen, uint64_t *salt, uint64_t *max_ticks) {
  *salt = 42;
  *max_ticks = 3000;
  scan_u64(params, plen, "prize_salt", salt);
  scan_u64(params, plen, "max_ticks", max_ticks);
  if (*max_ticks < 100 || *max_ticks > 100000) return 0;
  return 1;
}

SIEVE_EXPORT int64_t evaluate_candidate(const uint8_t *cand, int32_t cand_len,
                                        const char *params, int32_t plen) {
  if (cand_len != GENOME_LEN) return INT64_MIN;
  uint64_t salt, max_ticks;
  if (!parse(params, plen, &salt, &max_ticks)) return INT64_MIN;
  const int16_t *g = (const int16_t *)cand;
  Bird b = { (WORLD_H / 2) << Q, 0, 0, 0 };
  uint64_t t = 0;
  while (t < max_ticks && step(&b, salt, g)) t++;
  /* pipes dominate; ticks break ties — survival alone can't beat progress */
  return (int64_t)b.pipes_passed * 10000 + (int64_t)t;
}

SIEVE_EXPORT int32_t candidate_max_len(void) { return GENOME_LEN; }

/* Replay trace for the browser canvas:
 * u32 n_ticks ‖ u32 pipes_passed ‖ u32 n_pipes(=64) ‖ i32 gap_center[64]
 * ‖ per tick: i16 bird_y_px ‖ u8 flapped ‖ u8 pad
 * Returns bytes written, negative on error. */
SIEVE_EXPORT int32_t trace_candidate(const uint8_t *cand, int32_t cand_len,
                                     const char *params, int32_t plen,
                                     uint8_t *out, int32_t cap) {
  if (cand_len != GENOME_LEN) return -1;
  uint64_t salt, max_ticks;
  if (!parse(params, plen, &salt, &max_ticks)) return -2;
  const int16_t *g = (const int16_t *)cand;
  const int32_t N_PIPES = 64;
  int32_t need_head = 12 + N_PIPES * 4;
  if (cap < need_head) return -3;
  int32_t w = 12;
  for (int32_t i = 0; i < N_PIPES; i++) {
    int32_t gc = gap_center(salt, (uint32_t)i);
    memcpy(out + w, &gc, 4);
    w += 4;
  }
  Bird b = { (WORLD_H / 2) << Q, 0, 0, 0 };
  uint32_t t = 0;
  while (t < max_ticks && w + 4 <= cap) {
    int32_t in[N_IN];
    sense(&b, salt, in);
    int flap = net_flap(g, in);
    if (!step(&b, salt, g)) break;
    int16_t y = (int16_t)(b.y >> Q);
    memcpy(out + w, &y, 2);
    out[w + 2] = (uint8_t)flap;
    out[w + 3] = 0;
    w += 4;
    t++;
  }
  memcpy(out, &t, 4);
  memcpy(out + 4, &b.pipes_passed, 4);
  uint32_t np = (uint32_t)N_PIPES;
  memcpy(out + 8, &np, 4);
  return w;
}

SIEVE_EXPORT const char *spec_version(void) { return "sieveworks-flappy-evo/0.1.0"; }
