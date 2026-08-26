/*
 * Sieveworks worker module: spawn_quality (Minecraft "cool seed" finder).
 *
 * A GRADED score of how interesting the area around the origin is: a weighted
 * count of overworld structures generating within `radius` blocks, plus a
 * small biome-variety bonus. Graded (not yes/no) so extremum reframing holds —
 * every chunk has a verifiable local max, and the globally coolest seeds are
 * the global maxima.
 *
 * Filter cascade, the honest way (spec: cost varies per seed):
 *   getStructurePos()      — cheap per-region RNG, run for every region
 *   isViableStructurePos() — expensive biome-gen check, run ONLY on the few
 *                            candidates that land inside the radius
 * Most seeds are cheap (few in-radius candidates); the rare rich seeds cost
 * more. The worker reports the TRUE max regardless; honeypots catch any lazy
 * under-reporting. Verification stays one-seed-cheap.
 *
 * params JSON: { "version_pin": "1.21.1", "radius": 800 }
 */

#include "sieve_core.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "generator.h"
#include "finders.h"
#include "biomes.h"
#include "util.h"

typedef struct { int type; int weight; int cap; } StructWeight;

/* What makes a spawn "cool" — tune weights to taste. Rare structures score
 * high; common ones a little. Caps stop one structure type dominating. */
static const StructWeight WEIGHTS[] = {
    { Village,        3, 3 },
    { Ruined_Portal,  1, 2 },
    { Desert_Pyramid, 2, 2 },
    { Jungle_Temple,  3, 2 },
    { Swamp_Hut,      2, 2 },
    { Monument,       4, 2 },
    { Mansion,       10, 1 },
    { Ancient_City,   8, 1 },
    { Trail_Ruins,    2, 2 },
    { Outpost,        1, 2 },
};
#define NWEIGHTS ((int)(sizeof(WEIGHTS) / sizeof(WEIGHTS[0])))

typedef struct { int mc; int radius; } Params;

static long long json_int(const char *json, const char *key, long long dflt) {
    char pat[64];
    size_t k = strlen(key);
    if (k + 3 > sizeof(pat)) return dflt;
    pat[0] = '"'; memcpy(pat + 1, key, k); pat[k + 1] = '"'; pat[k + 2] = 0;
    const char *p = strstr(json, pat);
    if (!p) return dflt;
    p += k + 2;
    while (*p == ' ' || *p == ':' || *p == '\t') p++;
    return strtoll(p, NULL, 10);
}

static int parse_params(const char *json, int len, Params *out) {
    char buf[4096];
    if (!json || len <= 0 || len >= (int)sizeof(buf)) return -1;
    memcpy(buf, json, len); buf[len] = 0;
    char pin[64];
    const char *p = strstr(buf, "\"version_pin\"");
    if (!p) return -1;
    p += 13;
    while (*p == ' ' || *p == ':' || *p == '\t') p++;
    if (*p != '"') return -1;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < 63) pin[i++] = *p++;
    pin[i] = 0;
    out->mc = str2mc(pin);
    if (out->mc <= 0) return -1;
    long long r = json_int(buf, "radius", 800);
    if (r < 100) r = 100;
    if (r > 4000) r = 4000;
    out->radius = (int)r;
    return 0;
}

static Generator g_gen;
static int g_mc = -1;
static void ensure_gen(int mc) {
    if (g_mc != mc) { setupGenerator(&g_gen, mc, 0); g_mc = mc; }
}

static int64_t score_seed(uint64_t seed, const Params *p) {
    ensure_gen(p->mc);
    applySeed(&g_gen, DIM_OVERWORLD, seed);
    const int R = p->radius;
    int64_t score = 0;

    for (int w = 0; w < NWEIGHTS; w++) {
        StructureConfig sc;
        if (!getStructureConfig(WEIGHTS[w].type, p->mc, &sc)) continue;
        double bpr = sc.regionSize * 16.0;
        int r0x = (int)floor((-R) / bpr), r1x = (int)ceil((R) / bpr);
        int r0z = (int)floor((-R) / bpr), r1z = (int)ceil((R) / bpr);
        int found = 0;
        for (int rz = r0z; rz <= r1z && found < WEIGHTS[w].cap; rz++) {
            for (int rx = r0x; rx <= r1x && found < WEIGHTS[w].cap; rx++) {
                Pos pos;
                /* cheap prefilter: does this region even attempt a structure? */
                if (!getStructurePos(WEIGHTS[w].type, p->mc, seed, rx, rz, &pos)) continue;
                /* in radius? (still cheap — just arithmetic) */
                if ((int64_t)pos.x * pos.x + (int64_t)pos.z * pos.z > (int64_t)R * R) continue;
                /* expensive check, only for in-radius candidates */
                if (!isViableStructurePos(WEIGHTS[w].type, &g_gen, pos.x, pos.z, 0)) continue;
                score += WEIGHTS[w].weight;
                found++;
            }
        }
    }

    /* small biome-variety bonus: distinct biomes on a coarse grid near spawn */
    uint8_t seen[256];
    memset(seen, 0, sizeof(seen));
    int distinct = 0, cells = R / 128; /* sample at 1:64 scale, coarse */
    if (cells > 8) cells = 8;
    for (int x = -cells; x <= cells; x++)
        for (int z = -cells; z <= cells; z++) {
            int id = getBiomeAt(&g_gen, 64, x * 2, 15, z * 2);
            if (id >= 0 && id < 256 && !seen[id]) { seen[id] = 1; distinct++; }
        }
    score += distinct; /* +1 per distinct biome */
    return score;
}

SIEVE_EXPORT int64_t evaluate_seed(uint64_t seed, const char *params_json, int32_t params_len) {
    Params p;
    if (parse_params(params_json, params_len, &p) != 0) return SIEVE_ERR_SCORE;
    return score_seed(seed, &p);
}

SIEVE_EXPORT int32_t evaluate_range(uint64_t range_start, uint64_t range_end,
                                    const char *params_json, int32_t params_len, uint8_t *out16) {
    Params p;
    if (!out16 || range_end <= range_start) return -1;
    if (parse_params(params_json, params_len, &p) != 0) return -2;
    int64_t best = SIEVE_ERR_SCORE;
    uint64_t best_seed = range_start;
    for (uint64_t s = range_start; s < range_end; s++) {
        int64_t sc = score_seed(s, &p);
        if (sc == SIEVE_ERR_SCORE) return -3;
        if (sc > best) { best = sc; best_seed = s; } /* ascending, strictly greater */
    }
    for (int i = 0; i < 8; i++) out16[i] = (uint8_t)((uint64_t)best >> (8 * i));
    for (int i = 0; i < 8; i++) out16[8 + i] = (uint8_t)(best_seed >> (8 * i));
    return 0;
}

SIEVE_EXPORT const char *spec_version(void) {
    return "sieveworks-spawnquality/0.1.0+cubiomes-e61f905";
}
