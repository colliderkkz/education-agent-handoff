import type { Question } from "../../lib/types.ts";
import chinese from "./chinese.json";
import math from "./math.json";
import english from "./english.json";
import juniorMath from "./junior-math.json";
import seniorMath from "./senior-math.json";
import manifest from "./manifest.json";

/**
 * 静态内容库入口。
 * 只被 lib/content-bank.ts（服务端专用）引用，不进入客户端 bundle，
 * 也不会被 xiaohe-mobile/scripts/sync-local-domain.mjs 同步到移动端。
 * 库文件由 scripts/validate-bank.mjs 校验、由 scripts/merge-bank.mjs 重算 manifest。
 */
export const bankQuestions: Question[] = [...chinese, ...math, ...english, ...juniorMath, ...seniorMath] as unknown as Question[];
export const bankVersion: string = manifest.version;
export const bankDigest: string = manifest.digest;
export const bankCounts: Record<string, number> = manifest.counts;
