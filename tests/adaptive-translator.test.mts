import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveGenerationBudgetError,
  AdaptiveStrictFallbackError,
  createAdaptiveTranslator,
  translateAdaptiveScene,
} from "../electron/main/utils/adaptive/translator.ts";
import type {
  AdaptiveCallResult,
  AdaptiveModelClient,
  AdaptiveSceneLike,
  StageUsage,
} from "../electron/main/utils/adaptive/model-client.ts";
import { protectSubtitleText } from "../electron/main/utils/adaptive/protected-tokens.ts";
import { translationErrorCodes } from "../electron/shared/translation-error-codes.ts";

function sceneFixture(count = 2): AdaptiveSceneLike {
  const core = Array.from({ length: count }, (_, index) => ({
    id: index,
    sourceIndex: index,
    startMs: index * 1_000,
    endMs: index * 1_000 + 800,
    durationMs: 800,
    gapAfterMs: index + 1 < count ? 200 : null,
    originalText: `Source ${index + 1}`,
    modelText: `Source ${index + 1}`,
    plainText: `Source ${index + 1}`,
    protectedTokens: [],
    flags: {
      empty: false,
      overlapping: false,
      multiSpeaker: false,
      lockedOneToOne: false,
    },
  }));
  return {
    id: `scene-0-${count - 1}`,
    sourceStart: 0,
    sourceEnd: count - 1,
    core,
    before: [],
    after: [],
    lockedOneToOne: false,
  };
}

function usage(stage: StageUsage["stage"]): StageUsage {
  return {
    stage,
    model: "fake-model",
    requestAttempt: 1,
    durationMs: 4,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    finishReason: "stop",
  };
}

function fakeClient(
  initial: AdaptiveCallResult,
  repair: AdaptiveCallResult = { draft: { blocks: [] }, usage: usage("adaptive-repair") },
  fallback: AdaptiveCallResult = { translations: ["fallback"] , usage: usage("strict-fallback") },
): AdaptiveModelClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async translateScene() {
      calls.push("initial");
      return initial;
    },
    async repairScene() {
      calls.push("repair");
      return repair;
    },
    async translateStrictFallback() {
      calls.push("fallback");
      return fallback;
    },
  };
}

test("valid adaptive draft completes without repair or fallback", async () => {
  const client = fakeClient({
    draft: { blocks: [{ take: 2, targets: ["Merged translation"] }] },
    usage: usage("adaptive-translate"),
  });
  const result = await translateAdaptiveScene(sceneFixture(), { client });

  assert.deepEqual(client.calls, ["initial"]);
  assert.equal(result.origin, "adaptive");
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0]?.sourceStart, 0);
  assert.equal(result.blocks[0]?.sourceEnd, 1);
  assert.equal(result.usage.requestCount, 1);
});

test("partition failure is repaired exactly once", async () => {
  const client = fakeClient(
    { draft: { blocks: [{ take: 1, targets: ["Only one"] }] }, usage: usage("adaptive-translate") },
    { draft: { blocks: [{ take: 2, targets: ["Repaired"] }] }, usage: usage("adaptive-repair") },
  );
  const result = await translateAdaptiveScene(sceneFixture(), { client });

  assert.deepEqual(client.calls, ["initial", "repair"]);
  assert.equal(result.origin, "repair");
  assert.equal(result.usage.requestCount, 2);
  assert.equal(result.blocks[0]?.origin, "repair");
  assert.equal(result.violations.some((item) => item.severity === "error"), false);
});

test("restores cue-local duplicate placeholders within each block", async () => {
  const first = protectSubtitleText("<i>A</i>");
  const second = protectSubtitleText("<b>B</b>");
  const scene = sceneFixture();
  scene.core[0] = {
    ...scene.core[0]!,
    originalText: "<i>A</i>",
    modelText: first.text,
    protectedTokens: first.tokens,
  };
  scene.core[1] = {
    ...scene.core[1]!,
    originalText: "<b>B</b>",
    modelText: second.text,
    protectedTokens: second.tokens,
  };
  const client = fakeClient({
    draft: {
      blocks: [
        { take: 1, targets: [first.text] },
        { take: 1, targets: [second.text] },
      ],
    },
    usage: usage("adaptive-translate"),
  });

  const result = await translateAdaptiveScene(scene, { client });
  assert.deepEqual(
    result.blocks.map((block) => block.targetTexts[0]),
    ["<i>A</i>", "<b>B</b>"]
  );
});

test("generation budget errors expose the stable shared error code", () => {
  const error = new AdaptiveGenerationBudgetError("repair");
  assert.equal(error.code, translationErrorCodes.adaptiveGenerationBudgetExceeded);
  assert.equal(error.message, translationErrorCodes.adaptiveGenerationBudgetExceeded);
});

test("failed repair falls back to strict one-to-one blocks", async () => {
  const client = fakeClient(
    { draft: { blocks: [{ take: 3, targets: ["Invalid"] }] }, usage: usage("adaptive-translate") },
    { draft: { blocks: [{ take: 3, targets: ["Still invalid"] }] }, usage: usage("adaptive-repair") },
    { translations: ["First", "Second"], usage: usage("strict-fallback") },
  );
  const result = await translateAdaptiveScene(sceneFixture(), { client });

  assert.deepEqual(client.calls, ["initial", "repair", "fallback"]);
  assert.equal(result.origin, "strict-fallback");
  assert.deepEqual(result.blocks.map((block) => block.origin), ["strict-fallback", "strict-fallback"]);
  assert.equal(result.usage.requestCount, 3);
});

test("soft warnings do not trigger semantic repair", async () => {
  const client = fakeClient({
    draft: { blocks: [{ take: 2, targets: ["Natural translation"] }] },
    usage: usage("adaptive-translate"),
  });
  const result = await translateAdaptiveScene(sceneFixture(), {
    client,
    validateDraft: () => ({
      valid: true,
      violations: [
        {
          code: "adaptive.layout.softCpsExceeded",
          severity: "warning",
          message: "Soft CPS threshold exceeded",
        },
      ],
      blocks: [
        {
          id: "scene-0-1-block-0",
          sceneId: "scene-0-1",
          sourceStart: 0,
          sourceEnd: 1,
          sourceCueIds: [0, 1],
          targetTexts: ["Natural translation"],
          origin: "adaptive",
          semanticFingerprint: "fixture",
        },
      ],
    }),
  });

  assert.deepEqual(client.calls, ["initial"]);
  assert.equal(result.warnings.length, 1);
});

test("abort stops before the next semantic stage", async () => {
  const controller = new AbortController();
  const client = fakeClient({
    draft: { blocks: [{ take: 1, targets: ["Only one"] }] },
    usage: usage("adaptive-translate"),
  });
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    translateAdaptiveScene(sceneFixture(), { client, abortSignal: controller.signal }),
    /cancelled/
  );
  assert.deepEqual(client.calls, []);
});

test("strict fallback failure is surfaced after the bounded budget", async () => {
  const client = fakeClient(
    { draft: { blocks: [{ take: 3, targets: ["Invalid"] }] }, usage: usage("adaptive-translate") },
    { draft: { blocks: [{ take: 3, targets: ["Still invalid"] }] }, usage: usage("adaptive-repair") },
    { translations: ["Only one"], usage: usage("strict-fallback") },
  );
  await assert.rejects(
    translateAdaptiveScene(sceneFixture(), { client }),
    (error: unknown) => error instanceof AdaptiveStrictFallbackError
  );
  assert.deepEqual(client.calls, ["initial", "repair", "fallback"]);
});
