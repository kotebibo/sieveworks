/* Native CLI around sieve_core. Output formats are protocol surface — the
 * Day 2 CLI worker parses them and the determinism test compares them against
 * the WASM build, so any change here must change both sides. */

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sieve_core.h"

static int usage(void)
{
    fprintf(stderr,
            "usage:\n"
            "  sieve_core spec-version\n"
            "  sieve_core eval-seed <seed> <params-json>\n"
            "  sieve_core eval-range <start> <end> <bucket_size> <params-json>\n"
            "eval-range prints one line per bucket: <bucket_index> <max_score> <max_seed>\n");
    return 2;
}

int main(int argc, char **argv)
{
    if (argc < 2)
        return usage();

    if (strcmp(argv[1], "spec-version") == 0) {
        printf("%s\n", spec_version());
        return 0;
    }

    if (strcmp(argv[1], "eval-seed") == 0) {
        if (argc != 4)
            return usage();
        uint64_t seed = strtoull(argv[2], NULL, 10);
        const char *params = argv[3];
        int64_t score = evaluate_seed(seed, params, (int32_t)strlen(params));
        if (score == SIEVE_ERR_SCORE) {
            fprintf(stderr, "error: invalid params\n");
            return 1;
        }
        printf("%" PRId64 "\n", score);
        return 0;
    }

    if (strcmp(argv[1], "eval-range") == 0) {
        if (argc != 6)
            return usage();
        uint64_t start = strtoull(argv[2], NULL, 10);
        uint64_t end = strtoull(argv[3], NULL, 10);
        uint64_t bucket = strtoull(argv[4], NULL, 10);
        const char *params = argv[5];
        int32_t params_len = (int32_t)strlen(params);
        if (end <= start || bucket == 0) {
            fprintf(stderr, "error: bad range or bucket size\n");
            return 1;
        }
        uint32_t index = 0;
        for (uint64_t s = start; s < end; s += bucket, index++) {
            uint64_t e = s + bucket < end && s + bucket > s ? s + bucket : end;
            uint8_t out16[16];
            int32_t rc = evaluate_range(s, e, params, params_len, out16);
            if (rc != 0) {
                fprintf(stderr, "error: evaluate_range rc=%" PRId32 "\n", rc);
                return 1;
            }
            uint64_t raw_score = 0, max_seed = 0;
            for (int i = 7; i >= 0; i--) {
                raw_score = (raw_score << 8) | out16[i];
                max_seed = (max_seed << 8) | out16[8 + i];
            }
            printf("%" PRIu32 " %" PRId64 " %" PRIu64 "\n", index, (int64_t)raw_score, max_seed);
        }
        return 0;
    }

    return usage();
}
