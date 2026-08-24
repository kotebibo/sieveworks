import { z } from "zod";

export const U64_MAX = 0xffff_ffff_ffff_ffffn;
export const I64_MIN = -0x8000_0000_0000_0000n;
export const I64_MAX = 0x7fff_ffff_ffff_ffffn;

/**
 * u64 as a decimal string. JS numbers lose precision past 2^53, so u64 values
 * (seeds, range bounds, counts) always cross the wire as decimal strings.
 */
export const u64String = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "u64 must be a decimal string with no leading zeros")
  .refine((s) => BigInt(s) <= U64_MAX, "exceeds u64");

/**
 * i64 score as a decimal string. Scores are integers by protocol rule: exact
 * comparison and exact hashing, no float hazards (-0.0, NaN, equality). A job
 * needing fractional scores declares a scale factor in params and reports
 * scaled integers.
 */
export const i64String = z
  .string()
  .regex(/^(0|-?[1-9]\d*)$/, "i64 must be a decimal string with no leading zeros and no -0")
  .refine((s) => {
    const v = BigInt(s);
    return v >= I64_MIN && v <= I64_MAX;
  }, "outside i64 range");

export const toU64 = (s: string): bigint => BigInt(s);
export const toI64 = (s: string): bigint => BigInt(s);
