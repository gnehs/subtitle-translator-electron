import assert from "node:assert/strict";
import test from "node:test";
import { processAdaptiveScenes } from "../electron/main/utils/adaptive/pipeline.ts";
import type {
  AdaptiveSceneLike,
  StageUsage,
} from "../electron/main/utils/adaptive/model-client.ts";
import type { AdaptiveSceneTranslationResult } from "../electron/main/utils/adaptive/translator.ts";

function scene(index: number): AdaptiveSceneLike {
  return {
    id: `scene-${index}-${index}`,
    sourceStart: index,
    sourceEnd: index,
    core: [
      {
        id: index,
        sourceIndex: index,
        startMs: index * 1_000,
        endMs: index * 1_000 + 700,
        durationMs: 700,
        gapAfterMs: null,
        originalText: `Cue ${index}`,
        modelText: `Cue ${index}`,
        plainText: `Cue ${index}`,
        protectedTokens: [],
        flags: {
          empty: false,
          overlapping: false,
          multiSpeaker: false,
          lockedOneToOne: false,
        },
      },
    ],
    before: [],
    after: [],
    lockedOneToOne: false,
  };
}

const fakeUsage: StageUsage = {
  stage: "adaptive-translate",
  model: "fake-model",
  requestAttempt: 1,
  durationMs: 1,
  finishReason: "stop",
};

function translated(sceneInput: AdaptiveSceneLike): AdaptiveSceneTranslationResult {
  const sourceId = sceneInput.core[0]?.id ?? sceneInput.sourceStart;
  return {
    sceneId: sceneInput.id,
    blocks: [
      {
        id: `${sceneInput.id}-block-0`,
        sceneId: sceneInput.id,
        sourceStart: sceneInput.sourceStart,
        sourceEnd: sceneInput.sourceEnd,
        sourceCueIds: [sourceId],
        targetTexts: [`Target ${sourceId}`],
        origin: "adaptive",
        semanticFingerprint: `fp-${sourceId}`,
      },
    ],
    origin: "adaptive",
    violations: [],
    warnings: [],
    usages: [fakeUsage],
    usage: {
      requestCount: 1,
      byStage: {
        "adaptive-translate": { requestCount: 1 },
      },
    },
    budget: { initial: 1, repair: 0, strictFallback: 0 },
  };
}

test("pipeline commits scenes in source order despite concurrent completion", async () => {
  const completed: string[] = [];
  const result = await processAdaptiveScenes({
    scenes: [scene(0), scene(1), scene(2)],
    concurrency: 3,
    translateScene: async (item) => {
      if (item.sourceStart === 0) await new Promise((resolve) => setTimeout(resolve, 20));
      completed.push(item.id);
      return translated(item);
    },
  });

  assert.notDeepEqual(completed, ["scene-0-0", "scene-1-1", "scene-2-2"]);
  assert.deepEqual(result.scenes.map((item) => item.sceneId), ["scene-0-0", "scene-1-1", "scene-2-2"]);
  assert.deepEqual(result.blocks.map((item) => item.sourceStart), [0, 1, 2]);
  assert.deepEqual(result.coverage, [0, 1, 2]);
});

test("pipeline rejects duplicate scenes before issuing model calls", async () => {
  let calls = 0;
  await assert.rejects(
    processAdaptiveScenes({
      scenes: [scene(0), scene(0)],
      translateScene: async (item) => {
        calls += 1;
        return translated(item);
      },
    }),
    /Duplicate adaptive scene id/
  );
  assert.equal(calls, 0);
});

test("pipeline abort prevents starting later scenes", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    processAdaptiveScenes({
      scenes: [scene(0), scene(1), scene(2)],
      concurrency: 1,
      abortSignal: controller.signal,
      translateScene: async (item) => {
        calls += 1;
        controller.abort(new Error("cancelled"));
        return translated(item);
      },
    }),
    /cancelled/
  );
  assert.equal(calls, 1);
});

test("pipeline stops scheduling after a scene failure and settles in-flight work", async () => {
  const calls: number[] = [];
  let inFlightSettled = false;
  await assert.rejects(
    processAdaptiveScenes({
      scenes: [scene(0), scene(1), scene(2), scene(3)],
      concurrency: 2,
      translateScene: async (item) => {
        calls.push(item.sourceStart);
        if (item.sourceStart === 0) throw new Error("scene failed");
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlightSettled = true;
        return translated(item);
      },
    }),
    /scene failed/
  );
  assert.equal(calls.some((index) => index > 1), false);
  if (calls.includes(1)) assert.equal(inFlightSettled, true);
});
