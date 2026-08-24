#include "sieve_core.h"

#include <stdlib.h>
#include <string.h>

#include "generator.h"
#include "biomes.h"
#include "util.h"

#define PARAMS_CAP 4096
#define GRID_MAX_CELLS 64

enum Scorer {
    SCORER_INVALID = 0,
    SCORER_BIOME_DIVERSITY = 1,
    SCORER_MUSHROOM_FIELDS = 2
};

typedef struct {
    int mc;      /* cubiomes MCVersion */
    int scorer;  /* enum Scorer */
    int radius;  /* blocks */
} SieveParams;

/* Minimal JSON field extraction. Params come from our own coordinator via
 * canonical JSON: no escapes, no nesting inside the keys we read. */
static const char *find_key(const char *json, const char *key)
{
    char pat[64];
    size_t klen = strlen(key);
    if (klen + 3 > sizeof(pat))
        return NULL;
    pat[0] = '"';
    memcpy(pat + 1, key, klen);
    pat[klen + 1] = '"';
    pat[klen + 2] = '\0';
    const char *p = strstr(json, pat);
    if (!p)
        return NULL;
    p += klen + 2;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    if (*p != ':')
        return NULL;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    return p;
}

static int json_get_str(const char *json, const char *key, char *out, int cap)
{
    const char *p = find_key(json, key);
    if (!p || *p != '"')
        return -1;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < cap - 1)
        out[i++] = *p++;
    if (*p != '"')
        return -1;
    out[i] = '\0';
    return 0;
}

static long long json_get_int(const char *json, const char *key, long long dflt)
{
    const char *p = find_key(json, key);
    if (!p)
        return dflt;
    return strtoll(p, NULL, 10);
}

static int parse_params(const char *params_json, int32_t params_len, SieveParams *out)
{
    char buf[PARAMS_CAP];
    if (!params_json || params_len <= 0 || params_len >= PARAMS_CAP)
        return -1;
    memcpy(buf, params_json, (size_t)params_len);
    buf[params_len] = '\0';

    char scorer[64], pin[64];
    if (json_get_str(buf, "scorer", scorer, sizeof(scorer)) != 0)
        return -1;
    if (json_get_str(buf, "version_pin", pin, sizeof(pin)) != 0)
        return -1;

    if (strcmp(scorer, "biome_diversity") == 0)
        out->scorer = SCORER_BIOME_DIVERSITY;
    else if (strcmp(scorer, "mushroom_fields") == 0)
        out->scorer = SCORER_MUSHROOM_FIELDS;
    else
        return -1;

    out->mc = str2mc(pin);
    if (out->mc <= 0)
        return -1;

    long long radius = json_get_int(buf, "radius", 512);
    if (radius < 64)
        radius = 64;
    if (radius > 64 * GRID_MAX_CELLS)
        radius = 64 * GRID_MAX_CELLS;
    out->radius = (int)radius;
    return 0;
}

/* One generator, re-seeded per evaluation. Both build targets are
 * single-threaded per instance, so static state is safe. */
static Generator g_gen;
static int g_gen_mc = -1;

static void ensure_generator(int mc)
{
    if (g_gen_mc != mc) {
        setupGenerator(&g_gen, mc, 0);
        g_gen_mc = mc;
    }
}

static int64_t score_seed(uint64_t seed, const SieveParams *p)
{
    ensure_generator(p->mc);
    applySeed(&g_gen, DIM_OVERWORLD, seed);

    int cells = p->radius / 64; /* grid half-width at 1:64 scale */
    /* y=15 in 1:4 vertical units ≈ y=60, sea level */
    if (p->scorer == SCORER_BIOME_DIVERSITY) {
        uint8_t seen[512];
        memset(seen, 0, sizeof(seen));
        int64_t distinct = 0;
        for (int x = -cells; x <= cells; x++) {
            for (int z = -cells; z <= cells; z++) {
                int id = getBiomeAt(&g_gen, 64, x, 15, z);
                if (id >= 0 && id < 512 && !seen[id]) {
                    seen[id] = 1;
                    distinct++;
                }
            }
        }
        return distinct;
    }
    if (p->scorer == SCORER_MUSHROOM_FIELDS) {
        int64_t count = 0;
        for (int x = -cells; x <= cells; x++) {
            for (int z = -cells; z <= cells; z++) {
                int id = getBiomeAt(&g_gen, 64, x, 15, z);
                if (id == mushroom_fields)
                    count++;
            }
        }
        return count;
    }
    return SIEVE_ERR_SCORE;
}

SIEVE_EXPORT int64_t evaluate_seed(uint64_t seed, const char *params_json, int32_t params_len)
{
    SieveParams p;
    if (parse_params(params_json, params_len, &p) != 0)
        return SIEVE_ERR_SCORE;
    return score_seed(seed, &p);
}

SIEVE_EXPORT int32_t evaluate_range(uint64_t range_start, uint64_t range_end,
                                    const char *params_json, int32_t params_len,
                                    uint8_t *out16)
{
    SieveParams p;
    if (!out16 || range_end <= range_start)
        return -1;
    if (parse_params(params_json, params_len, &p) != 0)
        return -2;

    /* Ascending iteration + strictly-greater replacement = lowest seed wins
     * ties. This rule is part of the protocol; do not change it. */
    int64_t best_score = SIEVE_ERR_SCORE;
    uint64_t best_seed = range_start;
    for (uint64_t s = range_start; s < range_end; s++) {
        int64_t score = score_seed(s, &p);
        if (score == SIEVE_ERR_SCORE)
            return -3;
        if (score > best_score) {
            best_score = score;
            best_seed = s;
        }
    }

    for (int i = 0; i < 8; i++)
        out16[i] = (uint8_t)((uint64_t)best_score >> (8 * i));
    for (int i = 0; i < 8; i++)
        out16[8 + i] = (uint8_t)(best_seed >> (8 * i));
    return 0;
}

SIEVE_EXPORT const char *spec_version(void)
{
    return "sieveworks-mc/0.1.0+cubiomes-e61f905";
}
