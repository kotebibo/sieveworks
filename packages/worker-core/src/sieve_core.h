#ifndef SIEVE_CORE_H
#define SIEVE_CORE_H

#include <stdint.h>

/*
 * Sieveworks Minecraft worker core. Thin wrapper around cubiomes — all world
 * generation is cubiomes; this file only parses params, dispatches one of the
 * hardcoded scorers, and folds ranges to (max_score, max_seed).
 *
 * Determinism contract:
 *  - Scores are i64. INT64_MIN is the error sentinel (bad params), never a score.
 *  - Range fold iterates seeds ascending and replaces only on strictly greater
 *    score, so ties resolve to the LOWEST seed. Every implementation must match.
 *  - The WASM build of this file is the reference; the native build must agree
 *    byte-for-byte (enforced by the determinism test).
 *
 * params JSON (produced by our own coordinator, minimal parser on purpose):
 *   { "scorer": "biome_diversity" | "mushroom_fields",
 *     "version_pin": "1.21.1",          // fed to cubiomes str2mc
 *     "radius": 512 }                    // blocks, sampled at 1:64 scale
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define SIEVE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SIEVE_EXPORT
#endif

#define SIEVE_ERR_SCORE INT64_MIN

/* Score one seed. Returns SIEVE_ERR_SCORE on invalid params. */
SIEVE_EXPORT int64_t evaluate_seed(uint64_t seed, const char *params_json, int32_t params_len);

/* Fold [range_start, range_end) to its extremum. Writes 16 bytes to out16:
 * i64 LE max_score at offset 0, u64 LE max_seed at offset 8.
 * Returns 0 on success, negative on error. */
SIEVE_EXPORT int32_t evaluate_range(uint64_t range_start, uint64_t range_end,
                                    const char *params_json, int32_t params_len,
                                    uint8_t *out16);

/* Static version string identifying this worker spec. */
SIEVE_EXPORT const char *spec_version(void);

#endif
