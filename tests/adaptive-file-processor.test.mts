import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { processAdaptiveTranslationFile } from "../electron/main/process-adaptive-translation-file.ts";
import { RequestRateLimiter } from "../electron/main/utils/request-rate-limiter.ts";
import { callAdaptiveAgentTool } from "../electron/main/utils/adaptive/agent-tools.ts";
import type {
  AdaptiveAgentSessionInput,
  AdaptiveModelClient,
} from "../electron/main/utils/adaptive/model-client.ts";

const sourceSrt = `1
00:00:01,000 --> 00:00:01,900
I didn't know

2
00:00:01,940 --> 00:00:03,200
he was your brother.

3
00:00:04,000 --> 00:00:08,000
I wanted to tell you the truth, but I was afraid you would leave.
`;

function sessionUsage(input: AdaptiveAgentSessionInput) {
  return {
    stage: "adaptive-translate" as const,
    model: "fake-model",
    sceneId: input.scene.id,
    requestAttempt: 1,
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
    durationMs: 3,
    finishReason: "stop",
  };
}

function createFakeClient(counter: { agent: number; fallback: number }): AdaptiveModelClient {
  return {
    async runAgentSession(input) {
      counter.agent += 1;
      assert.equal(input.scene.core.length, 3);
      const session = input.openSession();
      callAdaptiveAgentTool(session, "edit", { from: 0, to: 1, targets: ["我不知道他是你哥哥。"] });
      callAdaptiveAgentTool(session, "edit", {
        from: 2,
        to: 2,
        targets: ["我本來想告訴你真相，", "但怕你會離開。"],
      });
      callAdaptiveAgentTool(session, "finish", {});
      return { usage: sessionUsage(input), finishReason: "stop" };
    },
    async translateStrictFallback() {
      counter.fallback += 1;
      throw new Error("fallback should not be called for a submitted workspace");
    },
  };
}

test("adaptive file processor writes many-to-many SRT and reuses complete v3 without model calls", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-file-"));
  const sourcePath = path.join(directory, "sample.srt");
  const outputPath = path.join(directory, "sample.translated.srt");
  const checkpointPath = path.join(directory, "sample.translation.json");
  fs.writeFileSync(sourcePath, sourceSrt, "utf8");
  const stats = fs.statSync(sourcePath);
  const progress: Array<{ status: string; previewCues?: unknown[] }> = [];
  const counter = { agent: 0, fallback: 0 };
  const params = {
    apiKeys: ["test-key"],
    apiHost: "http://127.0.0.1:9999/v1",
    model: "fake-model",
    prompt: "Translate naturally into {{lang}}. {{additional}}",
    mode: "adaptive" as const,
    lang: "Traditional Chinese",
    additional: "Use Taiwanese terminology.",
    temperature: 0.2,
    outputFormat: "srt-translation" as const,
    assFonts: { translationFont: "", originalFont: "" },
    concurrency: 1 as const,
    delay: 0,
    requestsPerMinute: 10_000,
    contextSize: 5,
  };

  const run = (
    modelClient: AdaptiveModelClient,
    adaptiveLayoutOptions = {},
    outputFormat: "srt-translation" | "ass-bilingual" = "srt-translation",
    requestedOutputPath = outputPath
  ) =>
    processAdaptiveTranslationFile({
      file: { path: sourcePath, name: "sample.srt" },
      params: { ...params, outputFormat, adaptiveLayoutOptions },
      abortSignal: new AbortController().signal,
      requestRateLimiter: new RequestRateLimiter({ requestsPerMinute: 10_000 }),
      outputPath: requestedOutputPath,
      checkpointPath,
      sourceName: "sample.srt",
      sourceExtension: "srt",
      sourceFingerprint: { size: stats.size, mtimeMs: stats.mtimeMs },
      sendProgress: (event) => progress.push(event),
      modelClient,
    });

  try {
    await run(createFakeClient(counter));
    assert.deepEqual(counter, { agent: 1, fallback: 0 });
    const output = fs.readFileSync(outputPath, "utf8");
    assert.match(output, /我不知道他是你哥哥。/);
    assert.match(output, /我本來想告訴你真相/);
    assert.match(output, /但怕你會離開。/);
    assert.equal((output.match(/-->/g) ?? []).length, 3);

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    assert.equal(checkpoint.version, 3);
    assert.equal(checkpoint.kind, "adaptive");
    assert.equal(checkpoint.state, "complete");
    assert.equal(
      JSON.stringify(checkpoint.subtitle).includes("translatedText"),
      false
    );
    assert.equal(checkpoint.usageSummary.requestCount, 1);
    const done = progress.at(-1);
    assert.equal(done?.status, "done");
    assert.equal(done?.previewCues?.length, 3);
    assert.equal((done?.previewCues?.[0] as { kind?: string })?.kind, "adaptive");

    fs.writeFileSync(outputPath, "stale", "utf8");
    const reuseCounter = { agent: 0, fallback: 0 };
    await run(createFakeClient(reuseCounter), { maxLineUnitsCjk: 16 });
    assert.deepEqual(reuseCounter, { agent: 0, fallback: 0 });
    assert.match(fs.readFileSync(outputPath, "utf8"), /我不知道他是你哥哥。/);

    const assOutputPath = path.join(directory, "sample.bilingual.ass");
    const assReuseCounter = { agent: 0, fallback: 0 };
    await run(
      createFakeClient(assReuseCounter),
      {},
      "ass-bilingual",
      assOutputPath
    );
    assert.deepEqual(assReuseCounter, { agent: 0, fallback: 0 });
    const assOutput = fs.readFileSync(assOutputPath, "utf8");
    assert.match(assOutput, /Style: ST Original/);
    assert.match(assOutput, /Style: ST Translation/);
    assert.equal((assOutput.match(/Dialogue: 0,/g) ?? []).length, 3);
    assert.equal((assOutput.match(/Dialogue: 1,/g) ?? []).length, 3);
    assert.match(assOutput, /Dialogue: 0,0:00:01\.00,0:00:01\.90,ST Original/);
    assert.match(assOutput, /Dialogue: 1,0:00:01\.00,0:00:03\.20,ST Translation/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("adaptive file processor falls back to strict one-to-one when the agent does not finish", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-fallback-file-"));
  const sourcePath = path.join(directory, "sample.srt");
  const outputPath = path.join(directory, "sample.translated.srt");
  const checkpointPath = path.join(directory, "sample.translation.json");
  fs.writeFileSync(sourcePath, sourceSrt, "utf8");
  const stats = fs.statSync(sourcePath);
  const calls: string[] = [];
  const statuses: string[] = [];
  const modelClient: AdaptiveModelClient = {
    async runAgentSession(input) {
      calls.push("agent");
      const session = input.openSession();
      // Leaves two cues uncovered and never finishes, so the file must still
      // complete through the strict fallback.
      callAdaptiveAgentTool(session, "edit", { from: 0, to: 0, targets: ["只有第一段"] });
      return { usage: sessionUsage(input), finishReason: "length" };
    },
    async translateStrictFallback() {
      calls.push("fallback");
      return {
        translations: ["我不知道。", "他是你哥哥。", "我想告訴你真相。"],
        finishReason: "stop",
      };
    },
  };

  try {
    await processAdaptiveTranslationFile({
      file: { path: sourcePath, name: "sample.srt" },
      params: {
        apiKeys: ["test-key"],
        apiHost: "http://127.0.0.1:9999/v1",
        model: "fake-model",
        prompt: "Translate into {{lang}}. {{additional}}",
        mode: "adaptive",
        lang: "Traditional Chinese",
        additional: "Use Taiwanese terminology.",
        temperature: 0.2,
        outputFormat: "srt-translation",
        assFonts: { translationFont: "", originalFont: "" },
        concurrency: 1,
        delay: 0,
        requestsPerMinute: 10_000,
        contextSize: 5,
      },
      abortSignal: new AbortController().signal,
      requestRateLimiter: new RequestRateLimiter({ requestsPerMinute: 10_000 }),
      outputPath,
      checkpointPath,
      sourceName: "sample.srt",
      sourceExtension: "srt",
      sourceFingerprint: { size: stats.size, mtimeMs: stats.mtimeMs },
      sendProgress: (event) => statuses.push(event.status),
      modelClient,
    });

    assert.deepEqual(calls, ["agent", "fallback"]);
    assert.ok(statuses.includes("fallback"));
    assert.match(fs.readFileSync(outputPath, "utf8"), /我不知道。/);
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
      state: string;
      scenes: Array<{
        status: string;
        blocks: Array<{ origin: string }>;
        violations: Array<{ severity: string }>;
      }>;
    };
    assert.equal(checkpoint.state, "complete");
    assert.ok(
      checkpoint.scenes.every(
        (scene) =>
          scene.status === "done" &&
          scene.blocks.every((block) => block.origin === "strict-fallback") &&
          scene.violations.every((item) => item.severity !== "error")
      )
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("adaptive file processor completes an empty subtitle without model calls", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-empty-file-"));
  const sourcePath = path.join(directory, "empty.srt");
  const outputPath = path.join(directory, "empty.translated.srt");
  const checkpointPath = path.join(directory, "empty.translation.json");
  fs.writeFileSync(sourcePath, "", "utf8");
  const stats = fs.statSync(sourcePath);
  let modelCalls = 0;
  const modelClient: AdaptiveModelClient = {
    async runAgentSession() {
      modelCalls += 1;
      throw new Error("empty subtitles must not call the model");
    },
    async translateStrictFallback() {
      modelCalls += 1;
      throw new Error("empty subtitles must not call the fallback");
    },
  };

  try {
    await processAdaptiveTranslationFile({
      file: { path: sourcePath, name: "empty.srt" },
      params: {
        apiKeys: ["test-key"],
        apiHost: "http://127.0.0.1:9999/v1",
        model: "fake-model",
        prompt: "Translate into {{lang}}. {{additional}}",
        mode: "adaptive",
        lang: "Traditional Chinese",
        additional: "",
        temperature: 0.2,
        outputFormat: "srt-translation",
        assFonts: { translationFont: "", originalFont: "" },
        concurrency: 1,
        delay: 0,
        requestsPerMinute: 10_000,
      },
      abortSignal: new AbortController().signal,
      requestRateLimiter: new RequestRateLimiter({ requestsPerMinute: 10_000 }),
      outputPath,
      checkpointPath,
      sourceName: "empty.srt",
      sourceExtension: "srt",
      sourceFingerprint: { size: stats.size, mtimeMs: stats.mtimeMs },
      sendProgress: () => undefined,
      modelClient,
    });

    assert.equal(modelCalls, 0);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "");
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
      state: string;
      scenes: unknown[];
    };
    assert.equal(checkpoint.state, "complete");
    assert.deepEqual(checkpoint.scenes, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
