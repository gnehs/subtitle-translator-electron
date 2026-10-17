import assert from "node:assert/strict";
import test from "node:test";
import {
  callAdaptiveAgentTool,
  type AdaptiveAgentSession,
} from "../electron/main/utils/adaptive/agent-tools.ts";
import type {
  AdaptiveAgentSessionInput,
  AdaptiveCallResult,
  AdaptiveModelClient,
  StageUsage,
} from "../electron/main/utils/adaptive/model-client.ts";
import {
  ADAPTIVE_AGENT_MAX_STEPS,
  AdaptiveStrictFallbackError,
  translateAdaptiveScene,
} from "../electron/main/utils/adaptive/translator.ts";
import { translationErrorCodes } from "../electron/shared/translation-error-codes.ts";
import { sceneOf, sourceCues } from "./helpers/adaptive-scene-fixture.mts";

const twoCueScene = () => sceneOf(sourceCues(["Source 1", "Source 2"]));

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

type Script = (
  session: AdaptiveAgentSession,
  call: (name: string, input: unknown) => unknown,
  input: AdaptiveAgentSessionInput,
) => void | Promise<void>;

function scriptedClient(
  script: Script,
  fallback: AdaptiveCallResult = { translations: ["First", "Second"], usage: usage("strict-fallback") },
): AdaptiveModelClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async runAgentSession(input) {
      calls.push("agent");
      const session = input.openSession();
      const call = (name: string, raw: unknown) => {
        calls.push(name);
        const result = callAdaptiveAgentTool(session, name, raw);
        return result.ok ? result.output : { error: result.error };
      };
      await script(session, call, input);
      return {
        usage: usage("adaptive-translate"),
        finishReason: session.isComplete() ? "stop" : "length",
      };
    },
    async translateStrictFallback() {
      calls.push("fallback");
      return fallback;
    },
  };
}

test("an agent that edits, hits an error, checks, fixes and finishes yields adaptive blocks", async () => {
  const client = scriptedClient((_session, call) => {
    call("view_scene", {});
    const malformed = call("edit", { from: 0, to: 1, targets: [] }) as { error?: string };
    assert.ok(malformed.error);
    const rejected = call("edit", { from: 0, to: 1, targets: ["", "x"] }) as { ok: boolean };
    assert.equal(rejected.ok, false);
    call("edit", { from: 0, to: 0, targets: ["第一句"] });
    const check = call("check", {}) as { ok: boolean };
    assert.equal(check.ok, false);
    call("edit", { from: 1, to: 1, targets: ["第二句"] });
    const finish = call("finish", {}) as { ok: boolean };
    assert.equal(finish.ok, true);
  });

  const result = await translateAdaptiveScene(twoCueScene(), { client });

  assert.deepEqual(client.calls, ["agent", "view_scene", "edit", "edit", "edit", "check", "edit", "finish"]);
  assert.equal(result.origin, "adaptive");
  assert.deepEqual(
    result.blocks.map((block) => [block.sourceStart, block.sourceEnd, block.origin, block.targetTexts]),
    [
      [0, 0, "adaptive", ["第一句"]],
      [1, 1, "adaptive", ["第二句"]],
    ],
  );
  assert.equal(result.usage.requestCount, 1);
  assert.equal(result.violations.some((item) => item.severity === "error"), false);
});

test("merged cues become one block spanning both source cues", async () => {
  const client = scriptedClient((_session, call) => {
    call("edit", { from: 0, to: 1, targets: ["合併翻譯"] });
    call("finish", {});
  });
  const result = await translateAdaptiveScene(twoCueScene(), { client });
  assert.equal(result.blocks.length, 1);
  assert.deepEqual(result.blocks[0]?.sourceCueIds, [0, 1]);
});

test("an agent that never finishes falls back to strict one-to-one blocks", async () => {
  const client = scriptedClient((_session, call) => {
    call("edit", { from: 0, to: 0, targets: ["只有第一句"] });
  });

  const result = await translateAdaptiveScene(twoCueScene(), { client });

  assert.deepEqual(client.calls, ["agent", "edit", "fallback"]);
  assert.equal(result.origin, "strict-fallback");
  assert.deepEqual(
    result.blocks.map((block) => [block.origin, block.targetTexts[0]]),
    [["strict-fallback", "First"], ["strict-fallback", "Second"]],
  );
  assert.equal(result.usage.requestCount, 2);
});

test("an agent that ends with text only (no tool support) falls back", async () => {
  const client = scriptedClient(() => undefined);
  const result = await translateAdaptiveScene(twoCueScene(), { client });
  assert.equal(result.origin, "strict-fallback");
});

test("every request attempt opens a fresh workspace so retries are idempotent", async () => {
  const views: string[] = [];
  const client: AdaptiveModelClient = {
    async runAgentSession(input) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const session = input.openSession();
        views.push(session.view());
        callAdaptiveAgentTool(session, "edit", { from: 0, to: 0, targets: [`attempt ${attempt}`] });
        if (attempt === 1) continue;
        callAdaptiveAgentTool(session, "edit", { from: 1, to: 1, targets: ["second"] });
        callAdaptiveAgentTool(session, "finish", {});
      }
      return { usage: usage("adaptive-translate"), finishReason: "stop" };
    },
    async translateStrictFallback() {
      throw new Error("fallback must not run after a submitted retry");
    },
  };

  const result = await translateAdaptiveScene(twoCueScene(), { client });

  assert.equal(views.length, 2);
  assert.equal(views[1], views[0]);
  assert.match(views[1]!, /\(untranslated\)/);
  assert.deepEqual(result.blocks.map((block) => block.targetTexts[0]), ["attempt 2", "second"]);
});

test("the client receives the step budget", async () => {
  const seen: number[] = [];
  const client = scriptedClient((_session, call, input) => {
    seen.push(input.maxSteps);
    call("edit", { from: 0, to: 1, targets: ["x"] });
    call("finish", {});
  });
  await translateAdaptiveScene(twoCueScene(), { client });
  await translateAdaptiveScene(twoCueScene(), { client, maxSteps: 3 });
  assert.deepEqual(seen, [ADAPTIVE_AGENT_MAX_STEPS, 3]);
});

test("restores cue-local duplicate placeholders within each block", async () => {
  const scene = sceneOf(sourceCues(["<i>A</i>", "<b>B</b>"]));
  const client = scriptedClient((_session, call) => {
    call("edit", { from: 0, to: 0, targets: [scene.core[0]!.modelText] });
    call("edit", { from: 1, to: 1, targets: [scene.core[1]!.modelText] });
    call("finish", {});
  });

  const result = await translateAdaptiveScene(scene, { client });
  assert.deepEqual(
    result.blocks.map((block) => block.targetTexts[0]),
    ["<i>A</i>", "<b>B</b>"],
  );
});

test("abort stops before the agent session starts", async () => {
  const controller = new AbortController();
  const client = scriptedClient(() => undefined);
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    translateAdaptiveScene(twoCueScene(), { client, abortSignal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(client.calls, []);
});

test("strict fallback failure is surfaced with the shared error code", async () => {
  const client = scriptedClient(() => undefined, {
    translations: ["Only one"],
    usage: usage("strict-fallback"),
  });
  await assert.rejects(
    translateAdaptiveScene(twoCueScene(), { client }),
    (error: unknown) =>
      error instanceof AdaptiveStrictFallbackError &&
      error.code === translationErrorCodes.adaptiveFallbackFailed,
  );
  assert.deepEqual(client.calls, ["agent", "fallback"]);
});

test("strict fallback accepts only an exact elements object from raw model output", async () => {
  const valid = await translateAdaptiveScene(twoCueScene(), {
    client: scriptedClient(() => undefined, { draft: { elements: ["First", "Second"] } }),
  });
  assert.deepEqual(valid.blocks.map((block) => block.targetTexts[0]), ["First", "Second"]);

  const invalidShapes = [
    { elements: ["First", "Second"], extra: true },
    { targets: ["First", "Second"] },
    { elements: ["a".repeat(1001), "Second"] },
    { blocks: [{ take: 2, targets: ["Merged fallback"] }] },
  ];
  for (const draft of invalidShapes) {
    await assert.rejects(
      translateAdaptiveScene(twoCueScene(), { client: scriptedClient(() => undefined, { draft }) }),
      (error: unknown) =>
        error instanceof AdaptiveStrictFallbackError && error.violations.length > 0,
    );
  }
});

test("a strict fallback that did not finish normally is rejected", async () => {
  const client = scriptedClient(() => undefined, {
    translations: ["First", "Second"],
    finishReason: "length",
  });
  await assert.rejects(
    translateAdaptiveScene(twoCueScene(), { client }),
    (error: unknown) =>
      error instanceof AdaptiveStrictFallbackError &&
      error.violations.some((item) => item.code === "adaptive.model.incomplete"),
  );
});
