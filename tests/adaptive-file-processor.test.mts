import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { processAdaptiveTranslationFile } from "../electron/main/process-adaptive-translation-file.ts";
import { RequestRateLimiter } from "../electron/main/utils/request-rate-limiter.ts";
import type {
  AdaptiveModelClient,
  AdaptiveTranslateInput,
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

function createFakeClient(counter: { initial: number; repair: number; fallback: number }): AdaptiveModelClient {
  return {
    async translateScene(input: AdaptiveTranslateInput) {
      counter.initial += 1;
      assert.equal(input.scene.core.length, 3);
      return {
        draft: {
          blocks: [
            { take: 2, targets: ["我不知道他是你哥哥。"] },
            { take: 1, targets: ["我本來想告訴你真相，", "但怕你會離開。"] },
          ],
        },
        usage: {
          stage: "adaptive-translate",
          model: "fake-model",
          sceneId: input.scene.id,
          requestAttempt: 1,
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          durationMs: 3,
          finishReason: "stop",
        },
        finishReason: "stop",
      };
    },
    async repairScene() {
      counter.repair += 1;
      throw new Error("repair should not be called for a valid draft");
    },
    async translateStrictFallback() {
      counter.fallback += 1;
      throw new Error("fallback should not be called for a valid draft");
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
  const counter = { initial: 0, repair: 0, fallback: 0 };
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

  const run = (modelClient: AdaptiveModelClient, adaptiveLayoutOptions = {}) =>
    processAdaptiveTranslationFile({
      file: { path: sourcePath, name: "sample.srt" },
      params: { ...params, adaptiveLayoutOptions },
      abortSignal: new AbortController().signal,
      requestRateLimiter: new RequestRateLimiter({ requestsPerMinute: 10_000 }),
      outputPath,
      checkpointPath,
      sourceName: "sample.srt",
      sourceExtension: "srt",
      sourceFingerprint: { size: stats.size, mtimeMs: stats.mtimeMs },
      sendProgress: (event) => progress.push(event),
      modelClient,
    });

  try {
    await run(createFakeClient(counter));
    assert.deepEqual(counter, { initial: 1, repair: 0, fallback: 0 });
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
    const reuseCounter = { initial: 0, repair: 0, fallback: 0 };
    await run(createFakeClient(reuseCounter), { maxLineUnitsCjk: 16 });
    assert.deepEqual(reuseCounter, { initial: 0, repair: 0, fallback: 0 });
    assert.match(fs.readFileSync(outputPath, "utf8"), /我不知道他是你哥哥。/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
