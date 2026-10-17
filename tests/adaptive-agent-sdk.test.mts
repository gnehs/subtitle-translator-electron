import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createAiSdkAdaptiveModelClient } from "../electron/main/utils/adaptive/model-client.ts";
import { translateAdaptiveScene } from "../electron/main/utils/adaptive/translator.ts";
import { sceneOf, sourceCues } from "./helpers/adaptive-scene-fixture.mts";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function toolCallStep(
  calls: Array<{ name: string; input: unknown }>,
): { stream: ReadableStream<LanguageModelV4StreamPart> } {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        ...calls.map((call, index): LanguageModelV4StreamPart => ({
          type: "tool-call",
          toolCallId: `call-${index}-${call.name}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
      ],
    }),
  };
}

function textStep(text: string): { stream: ReadableStream<LanguageModelV4StreamPart> } {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ],
    }),
  };
}

function client(model: MockLanguageModelV4) {
  return createAiSdkAdaptiveModelClient({
    apiKey: "test-key",
    apiHost: "http://127.0.0.1:9/v1",
    model: "mock-model",
    targetLanguage: "繁體中文",
    languageModel: model,
  });
}

test("the AI SDK adapter issues tool calls, feeds results back, and stops once the workspace is submitted", async () => {
  const steps = [
    toolCallStep([
      { name: "edit", input: { from: 0, to: 1, targets: [] } },
      { name: "edit", input: { from: 0, to: 0, targets: ["第一句"] } },
    ]),
    toolCallStep([{ name: "check", input: {} }]),
    toolCallStep([
      { name: "edit", input: { from: 1, to: 1, targets: ["第二句"] } },
      { name: "finish", input: {} },
    ]),
  ];
  const model = new MockLanguageModelV4({
    doStream: async () => steps[model.doStreamCalls.length - 1] ?? textStep("should not be reached"),
  });

  const result = await translateAdaptiveScene(sceneOf(sourceCues(["Source 1", "Source 2"])), {
    client: client(model),
  });

  assert.equal(model.doStreamCalls.length, 3);
  assert.equal(result.origin, "adaptive");
  assert.deepEqual(result.blocks.map((block) => block.targetTexts[0]), ["第一句", "第二句"]);

  const firstCall = model.doStreamCalls[0]!;
  assert.deepEqual(
    (firstCall.tools ?? []).map((tool) => tool.name),
    ["view_scene", "edit", "check", "search_file", "read_file", "finish"],
  );
  const lastPrompt = JSON.stringify(model.doStreamCalls[2]!.prompt);
  assert.match(lastPrompt, /adaptive\.workspace\.uncovered/);
  assert.match(lastPrompt, /"role":"tool"/);

  const agentUsage = result.usages.find((item) => item.stage === "adaptive-translate");
  assert.equal(agentUsage?.inputTokens, 30);
  assert.equal(result.usage.requestCount, 1);
});

test("the AI SDK adapter stops at the step budget and the translator falls back", async () => {
  const model = new MockLanguageModelV4({
    doStream: async (options) =>
      options.responseFormat?.type === "json"
        ? textStep(JSON.stringify({ elements: ["一", "二"] }))
        : toolCallStep([{ name: "view_scene", input: {} }]),
  });

  const result = await translateAdaptiveScene(sceneOf(sourceCues(["Source 1", "Source 2"])), {
    client: client(model),
    maxSteps: 2,
  });

  assert.equal(model.doStreamCalls.length, 3);
  assert.equal(result.origin, "strict-fallback");
  assert.deepEqual(result.blocks.map((block) => block.targetTexts[0]), ["一", "二"]);
});

test("a model that answers with text instead of tools falls back after one step", async () => {
  const model = new MockLanguageModelV4({
    doStream: async (options) =>
      options.responseFormat?.type === "json"
        ? textStep(JSON.stringify({ elements: ["一", "二"] }))
        : textStep("I cannot call tools."),
  });

  const result = await translateAdaptiveScene(sceneOf(sourceCues(["Source 1", "Source 2"])), {
    client: client(model),
  });

  assert.equal(model.doStreamCalls.length, 2);
  assert.equal(result.origin, "strict-fallback");
});
