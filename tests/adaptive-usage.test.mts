import assert from "node:assert/strict";
import test from "node:test";
import { createUsageSummary, mergeUsageSummaries } from "../electron/main/utils/adaptive/usage.ts";

test("usage aggregation preserves unavailable provider fields", () => {
  const summary = createUsageSummary([
    {
      stage: "adaptive-translate",
      model: "test-model",
      requestAttempt: 1,
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      reasoningTokens: 2,
      cachedInputTokens: 1,
      durationMs: 100,
    },
    {
      stage: "adaptive-repair",
      model: "test-model",
      requestAttempt: 1,
      durationMs: 120,
    },
  ]);
  assert.equal(summary.requestCount, 2);
  assert.equal(summary.inputTokens, 10);
  assert.equal(summary.reasoningTokens, 2);
  assert.equal(summary.cachedInputTokens, 1);
  assert.equal(summary.byStage["adaptive-repair"]?.requestCount, 1);
  assert.equal("inputTokens" in (summary.byStage["adaptive-repair"] ?? {}), false);
});

test("usage summaries merge stage counts and known token totals", () => {
  const left = createUsageSummary([
    {
      stage: "brief",
      model: "m",
      requestAttempt: 1,
      inputTokens: 2,
      durationMs: 1,
    },
  ]);
  const right = createUsageSummary([
    {
      stage: "brief",
      model: "m",
      requestAttempt: 1,
      inputTokens: 3,
      durationMs: 1,
    },
  ]);
  const merged = mergeUsageSummaries(left, right);
  assert.equal(merged.requestCount, 2);
  assert.equal(merged.inputTokens, 5);
  assert.equal(merged.byStage.brief?.requestCount, 2);
});
