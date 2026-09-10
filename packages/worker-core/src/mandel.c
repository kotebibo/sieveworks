#include <stdint.h>
#include <string.h>

/*
 * Sieveworks Mandelbrot render module — the first output_hash (mode 1)
 * worker. A "unit" is one 64x64-pixel tile of a grid x grid render, indexed
 * row-major; render_bucket writes tile bytes (1 byte/pixel palette index),
 * the HOST hashes them into the Merkle leaf. No floats anywhere: Q32.32
 * fixed-point arithmetic via __int128, so determinism is by construction.
 *
 * params JSON (integers only; minimal parser on purpose):
 *   { "center_re_q32": -3221225472,   // i64, Q32.32 (-0.75 << 32)
 *     "center_im_q32": 0,
 *     "span_q32": 12884901888,        // i64, Q32.32 (3.0 << 32)
 *     "grid": 4096,                   // pixels per side, multiple of tile
 *     "tile": 64,                     // tile side in pixels
 *     "max_iter": 500 }
 *
 * ABI (mode 1): render_bucket, spec_version, verification_mode -> 1.
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define SIEVE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SIEVE_EXPORT
#endif

typedef struct {
  int64_t center_re, center_im, span;
  int64_t grid, tile, max_iter;
} MandelParams;

/* Minimal integer-field JSON scan: finds "key": <int>. Returns 1 on hit. */
static int scan_i64(const char *json, int32_t len, const char *key, int64_t *out) {
  int32_t klen = (int32_t)strlen(key);
  for (int32_t i = 0; i + klen + 3 < len; i++) {
    if (json[i] == '"' && i + 1 + klen < len && memcmp(json + i + 1, key, (size_t)klen) == 0 &&
        json[i + 1 + klen] == '"') {
      int32_t j = i + klen + 2;
      while (j < len && (json[j] == ':' || json[j] == ' ')) j++;
      int neg = 0;
      if (j < len && json[j] == '-') { neg = 1; j++; }
      if (j >= len || json[j] < '0' || json[j] > '9') return 0;
      int64_t v = 0;
      while (j < len && json[j] >= '0' && json[j] <= '9') { v = v * 10 + (json[j] - '0'); j++; }
      *out = neg ? -v : v;
      return 1;
    }
  }
  return 0;
}

static int parse_params(const char *json, int32_t len, MandelParams *p) {
  p->center_re = -((int64_t)3 << 30);      /* -0.75 in Q32.32 */
  p->center_im = 0;
  p->span = (int64_t)3 << 32;              /* 3.0 */
  p->grid = 4096;
  p->tile = 64;
  p->max_iter = 500;
  scan_i64(json, len, "center_re_q32", &p->center_re);
  scan_i64(json, len, "center_im_q32", &p->center_im);
  scan_i64(json, len, "span_q32", &p->span);
  scan_i64(json, len, "grid", &p->grid);
  scan_i64(json, len, "tile", &p->tile);
  scan_i64(json, len, "max_iter", &p->max_iter);
  if (p->grid < 64 || p->grid > 16384 || p->tile < 8 || p->tile > 256) return 0;
  if (p->grid % p->tile != 0) return 0;
  if (p->max_iter < 16 || p->max_iter > 100000) return 0;
  if (p->span <= 0) return 0;
  return 1;
}

/* Q32.32 multiply via 128-bit intermediate. */
static int64_t qmul(int64_t a, int64_t b) {
  return (int64_t)(((__int128)a * (__int128)b) >> 32);
}

static uint8_t mandel_pixel(int64_t cre, int64_t cim, int64_t max_iter) {
  int64_t zr = 0, zi = 0;
  const int64_t four = (int64_t)4 << 32;
  for (int64_t it = 0; it < max_iter; it++) {
    int64_t zr2 = qmul(zr, zr);
    int64_t zi2 = qmul(zi, zi);
    if (zr2 + zi2 > four) {
      /* Escaped: palette 1..255, scaled by iteration count. */
      int64_t v = 1 + (it * 254) / max_iter;
      return (uint8_t)v;
    }
    int64_t nzr = zr2 - zi2 + cre;
    zi = 2 * qmul(zr, zi) + cim;
    zr = nzr;
  }
  return 0; /* inside the set */
}

/* Render tiles [range_start, range_end) sequentially into out. One tile =
 * tile*tile bytes. Returns total bytes written, negative on error. */
SIEVE_EXPORT int32_t render_bucket(uint64_t range_start, uint64_t range_end,
                                   const char *params_json, int32_t params_len,
                                   uint8_t *out, int32_t out_cap) {
  MandelParams p;
  if (!parse_params(params_json, params_len, &p)) return -1;
  int64_t tiles_per_side = p.grid / p.tile;
  int64_t total_tiles = tiles_per_side * tiles_per_side;
  if (range_end <= range_start) return -2;
  if ((int64_t)range_end > total_tiles) return -3;

  int64_t tile_bytes = p.tile * p.tile;
  int64_t need = (int64_t)(range_end - range_start) * tile_bytes;
  if (need > out_cap) return -4;

  /* pixel step = span / grid; origin = center - span/2 (top-left). */
  int64_t step = p.span / p.grid;
  int64_t origin_re = p.center_re - p.span / 2;
  int64_t origin_im = p.center_im - p.span / 2;

  int32_t w = 0;
  for (uint64_t t = range_start; t < range_end; t++) {
    int64_t tx = (int64_t)(t % (uint64_t)tiles_per_side);
    int64_t ty = (int64_t)(t / (uint64_t)tiles_per_side);
    int64_t px0 = tx * p.tile, py0 = ty * p.tile;
    for (int64_t py = 0; py < p.tile; py++) {
      int64_t cim = origin_im + (py0 + py) * step;
      for (int64_t px = 0; px < p.tile; px++) {
        int64_t cre = origin_re + (px0 + px) * step;
        out[w++] = mandel_pixel(cre, cim, p.max_iter);
      }
    }
  }
  return w;
}

SIEVE_EXPORT int32_t verification_mode(void) { return 1; }

SIEVE_EXPORT const char *spec_version(void) { return "sieveworks-mandel/0.1.0"; }
