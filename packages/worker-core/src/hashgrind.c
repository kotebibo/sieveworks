/*
 * Sieveworks worker module: hash-grind (proof-of-work).
 *
 * A deliberately NON-Minecraft worker that proves the platform is
 * game-agnostic. The score of a seed is the number of leading zero BITS in
 * sha256(seed_le_8bytes ‖ salt). Finding a high score is hard (probabilistic,
 * ~2^k work for k zero bits); checking a claim is one hash. That is the whole
 * Sieveworks thesis — hard to find, easy to check — in its purest form.
 *
 * Exports the same ABI as every worker: evaluate_seed / evaluate_range /
 * spec_version. Same fold rule as the Minecraft core: ascending, strictly
 * greater, so ties resolve to the lowest seed.
 *
 * params JSON: { "salt": "<ascii string, ≤64 chars>" }
 * Self-contained SHA-256 (no libs) so it builds standalone to WASM.
 */

#include "sieve_core.h" /* SIEVE_EXPORT, SIEVE_ERR_SCORE */

#include <stdint.h>
#include <string.h>

/* ---- minimal SHA-256 ---- */
typedef struct { uint32_t s[8]; uint64_t len; uint8_t buf[64]; uint32_t n; } sha256_ctx;

static uint32_t ror(uint32_t x, int r) { return (x >> r) | (x << (32 - r)); }

static const uint32_t K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };

static void sha256_block(sha256_ctx *c, const uint8_t *p) {
  uint32_t w[64], a,b,cc,d,e,f,g,h,t1,t2;
  for (int i = 0; i < 16; i++)
    w[i] = (uint32_t)p[i*4] << 24 | (uint32_t)p[i*4+1] << 16 | (uint32_t)p[i*4+2] << 8 | p[i*4+3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = ror(w[i-15],7) ^ ror(w[i-15],18) ^ (w[i-15] >> 3);
    uint32_t s1 = ror(w[i-2],17) ^ ror(w[i-2],19) ^ (w[i-2] >> 10);
    w[i] = w[i-16] + s0 + w[i-7] + s1;
  }
  a=c->s[0];b=c->s[1];cc=c->s[2];d=c->s[3];e=c->s[4];f=c->s[5];g=c->s[6];h=c->s[7];
  for (int i = 0; i < 64; i++) {
    uint32_t S1 = ror(e,6) ^ ror(e,11) ^ ror(e,25);
    uint32_t ch = (e & f) ^ (~e & g);
    t1 = h + S1 + ch + K[i] + w[i];
    uint32_t S0 = ror(a,2) ^ ror(a,13) ^ ror(a,22);
    uint32_t maj = (a & b) ^ (a & cc) ^ (b & cc);
    t2 = S0 + maj;
    h=g;g=f;f=e;e=d+t1;d=cc;cc=b;b=a;a=t1+t2;
  }
  c->s[0]+=a;c->s[1]+=b;c->s[2]+=cc;c->s[3]+=d;c->s[4]+=e;c->s[5]+=f;c->s[6]+=g;c->s[7]+=h;
}

static void sha256(const uint8_t *msg, uint32_t mlen, uint8_t out[32]) {
  sha256_ctx c;
  c.s[0]=0x6a09e667;c.s[1]=0xbb67ae85;c.s[2]=0x3c6ef372;c.s[3]=0xa54ff53a;
  c.s[4]=0x510e527f;c.s[5]=0x9b05688c;c.s[6]=0x1f83d9ab;c.s[7]=0x5be0cd19;
  c.len = mlen;
  uint32_t i = 0;
  while (mlen - i >= 64) { sha256_block(&c, msg + i); i += 64; }
  uint8_t tail[128]; uint32_t t = 0;
  for (; i < mlen; i++) tail[t++] = msg[i];
  tail[t++] = 0x80;
  uint32_t pad = (t <= 56) ? (56 - t) : (120 - t);
  for (uint32_t j = 0; j < pad; j++) tail[t++] = 0;
  uint64_t bits = (uint64_t)mlen * 8;
  for (int j = 7; j >= 0; j--) tail[t++] = (uint8_t)(bits >> (j * 8));
  for (uint32_t j = 0; j < t; j += 64) sha256_block(&c, tail + j);
  for (int j = 0; j < 8; j++) {
    out[j*4]   = (uint8_t)(c.s[j] >> 24);
    out[j*4+1] = (uint8_t)(c.s[j] >> 16);
    out[j*4+2] = (uint8_t)(c.s[j] >> 8);
    out[j*4+3] = (uint8_t)(c.s[j]);
  }
}

static int leading_zero_bits(const uint8_t h[32]) {
  int n = 0;
  for (int i = 0; i < 32; i++) {
    if (h[i] == 0) { n += 8; continue; }
    uint8_t b = h[i];
    while ((b & 0x80) == 0) { n++; b <<= 1; }
    break;
  }
  return n;
}

/* extract salt from params json (minimal parser, our coordinator emits it) */
static int get_salt(const char *json, int len, char *out, int cap) {
  const char *key = "\"salt\"";
  char buf[4096];
  if (len <= 0 || len >= (int)sizeof(buf)) { out[0] = '\0'; return 0; }
  memcpy(buf, json, len); buf[len] = '\0';
  const char *p = strstr(buf, key);
  if (!p) { out[0] = '\0'; return 0; }
  p += 6;
  while (*p == ' ' || *p == ':' || *p == '\t') p++;
  if (*p != '"') { out[0] = '\0'; return 0; }
  p++;
  int i = 0;
  while (*p && *p != '"' && i < cap - 1) out[i++] = *p++;
  out[i] = '\0';
  return i;
}

static int64_t score(uint64_t seed, const char *salt, int slen) {
  uint8_t msg[8 + 64];
  for (int i = 0; i < 8; i++) msg[i] = (uint8_t)(seed >> (8 * i)); /* LE */
  int m = slen > 64 ? 64 : slen;
  memcpy(msg + 8, salt, m);
  uint8_t h[32];
  sha256(msg, 8 + m, h);
  return leading_zero_bits(h);
}

SIEVE_EXPORT int64_t evaluate_seed(uint64_t seed, const char *params_json, int32_t params_len) {
  char salt[128];
  int slen = get_salt(params_json, params_len, salt, sizeof(salt));
  return score(seed, salt, slen);
}

SIEVE_EXPORT int32_t evaluate_range(uint64_t range_start, uint64_t range_end,
                                    const char *params_json, int32_t params_len, uint8_t *out16) {
  if (!out16 || range_end <= range_start) return -1;
  char salt[128];
  int slen = get_salt(params_json, params_len, salt, sizeof(salt));
  int64_t best = -1;
  uint64_t best_seed = range_start;
  for (uint64_t s = range_start; s < range_end; s++) {
    int64_t sc = score(s, salt, slen);
    if (sc > best) { best = sc; best_seed = s; }
  }
  for (int i = 0; i < 8; i++) out16[i] = (uint8_t)((uint64_t)best >> (8 * i));
  for (int i = 0; i < 8; i++) out16[8 + i] = (uint8_t)(best_seed >> (8 * i));
  return 0;
}

SIEVE_EXPORT const char *spec_version(void) {
  return "sieveworks-hashgrind/0.1.0";
}
