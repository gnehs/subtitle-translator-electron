import type {
  StageUsage,
  StageUsageSummary,
  TranslationUsageStage,
  TranslationUsageSummary,
} from "./types.ts";

const TOTAL_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
] as const;

const STAGE_TOTAL_KEYS = ["inputTokens", "outputTokens", "totalTokens"] as const;

function addOptional(
  target: Record<string, number>,
  key: string,
  value: number | undefined
): void {
  if (value === undefined || !Number.isFinite(value)) return;
  target[key] = (target[key] ?? 0) + value;
}

/** Aggregate provider usage without inventing zeroes for unavailable fields. */
export function createUsageSummary(
  usages: readonly StageUsage[] = []
): TranslationUsageSummary {
  const summary: TranslationUsageSummary = { requestCount: 0, byStage: {} };
  for (const usage of usages) {
    summary.requestCount += 1;
    for (const key of TOTAL_KEYS) {
      addOptional(
        summary as unknown as Record<string, number>,
        key,
        usage[key]
      );
    }

    const stageSummary: StageUsageSummary = summary.byStage[usage.stage] ?? {
      requestCount: 0,
    };
    stageSummary.requestCount += 1;
    for (const key of STAGE_TOTAL_KEYS) {
      addOptional(stageSummary as unknown as Record<string, number>, key, usage[key]);
    }
    summary.byStage[usage.stage] = stageSummary;
  }
  return summary;
}

export function mergeUsageSummaries(
  left: TranslationUsageSummary,
  right: TranslationUsageSummary
): TranslationUsageSummary {
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const byStage: TranslationUsageSummary["byStage"] = {};
  const stages = new Set<TranslationUsageStage>([
    ...(Object.keys(left.byStage) as TranslationUsageStage[]),
    ...(Object.keys(right.byStage) as TranslationUsageStage[]),
  ]);
  for (const stage of stages) {
    const a = left.byStage[stage];
    const b = right.byStage[stage];
    if (!a && !b) continue;
    byStage[stage] = {
      requestCount: (a?.requestCount ?? 0) + (b?.requestCount ?? 0),
      ...(sum(a?.inputTokens, b?.inputTokens) !== undefined
        ? { inputTokens: sum(a?.inputTokens, b?.inputTokens) }
        : {}),
      ...(sum(a?.outputTokens, b?.outputTokens) !== undefined
        ? { outputTokens: sum(a?.outputTokens, b?.outputTokens) }
        : {}),
      ...(sum(a?.totalTokens, b?.totalTokens) !== undefined
        ? { totalTokens: sum(a?.totalTokens, b?.totalTokens) }
        : {}),
    };
  }
  return {
    requestCount: left.requestCount + right.requestCount,
    ...(sum(left.inputTokens, right.inputTokens) !== undefined
      ? { inputTokens: sum(left.inputTokens, right.inputTokens) }
      : {}),
    ...(sum(left.outputTokens, right.outputTokens) !== undefined
      ? { outputTokens: sum(left.outputTokens, right.outputTokens) }
      : {}),
    ...(sum(left.totalTokens, right.totalTokens) !== undefined
      ? { totalTokens: sum(left.totalTokens, right.totalTokens) }
      : {}),
    ...(sum(left.reasoningTokens, right.reasoningTokens) !== undefined
      ? { reasoningTokens: sum(left.reasoningTokens, right.reasoningTokens) }
      : {}),
    ...(sum(left.cachedInputTokens, right.cachedInputTokens) !== undefined
      ? { cachedInputTokens: sum(left.cachedInputTokens, right.cachedInputTokens) }
      : {}),
    byStage,
  };
}

/** Add one usage event, returning a fresh summary suitable for checkpoint state. */
export function addStageUsage(
  summary: TranslationUsageSummary,
  usage: StageUsage
): TranslationUsageSummary {
  const single = createUsageSummary([usage]);
  return mergeUsageSummaries(summary, single);
}

export function createStageUsage(
  input: Omit<StageUsage, "requestAttempt" | "durationMs"> &
    Partial<Pick<StageUsage, "requestAttempt" | "durationMs">>
): StageUsage {
  return {
    ...input,
    requestAttempt: input.requestAttempt ?? 1,
    durationMs: input.durationMs ?? 0,
  };
}

export const aggregateUsage = createUsageSummary;
export const summarizeUsage = createUsageSummary;
