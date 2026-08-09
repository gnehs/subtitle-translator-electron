import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADAPTIVE_PIPELINE_VERSION,
  assertCompleteAdaptiveCoverage,
  canReuseAdaptiveCheckpoint,
  createAdaptiveCheckpointWriter,
  createAdaptiveLayoutFingerprint,
  createAdaptiveSemanticFingerprint,
  getAdaptiveCheckpointCoverage,
  getAdaptiveCheckpointResumeMetadata,
  hasCompleteAdaptiveCoverage,
  parseAdaptiveCheckpoint,
  serializeAdaptiveCheckpoint,
  stripAdaptiveTranslations,
} from "../electron/main/utils/adaptive/checkpoint.ts";

const semanticFingerprint = createAdaptiveSemanticFingerprint({
  pipelineVersion: ADAPTIVE_PIPELINE_VERSION,
  mode: "adaptive",
  apiHost: "https://example.invalid/v1",
  model: "example-model",
  targetLanguage: "繁體中文",
  adaptivePrompt: "Translate {{lang}}",
  additionalInstructions: "Keep names consistent",
  temperature: 0.3,
  contextSize: 5,
  scenePolicyVersion: 1,
  maxTake: 4,
  maxTargets: 3,
  briefSchemaVersion: 1,
  placeholderStrategyVersion: 1,
  apiKey: "must-not-affect-fingerprint",
  concurrency: 8,
  rpm: 60,
  delay: 100,
  outputDirectory: "/private/secret/path",
});
const layoutFingerprint = createAdaptiveLayoutFingerprint({
  layoutEngineVersion: 1,
  outputFormat: "srt",
  targetLanguage: "繁體中文",
  layoutOptions: { maxLines: 2 },
});

function createCheckpoint(state: "in-progress" | "complete" = "complete") {
  return {
    version: 3 as const,
    kind: "adaptive" as const,
    state,
    format: "srt" as const,
    source: {
      name: "episode.srt",
      fingerprint: { size: 1024, mtimeMs: 1234.5 },
    },
    translation: {
      mode: "adaptive" as const,
      pipelineVersion: ADAPTIVE_PIPELINE_VERSION,
      semanticFingerprint,
      layoutFingerprint,
    },
    subtitle: [
      {
        type: "cue" as const,
        data: {
          text: "Hello",
          start: 1000,
          end: 2000,
          translatedText: "你好",
        },
      },
      {
        type: "cue" as const,
        data: { text: "world", start: 2100, end: 3000 },
      },
    ],
    scenes: [
      {
        id: "scene-0",
        sourceStart: 0,
        sourceEnd: 1,
        status: "done" as const,
        blocks: [
          {
            id: "block-0",
            sceneId: "scene-0",
            sourceStart: 0,
            sourceEnd: 1,
            sourceCueIds: [0, 1],
            targetTexts: ["你好世界"],
            origin: "adaptive" as const,
            semanticFingerprint,
          },
        ],
        violations: [],
      },
    ],
    usage: [],
    usageSummary: { requestCount: 0, byStage: {} },
  };
}

test("serializes source subtitles without translatedText and parses valid v3", () => {
  const checkpoint = createCheckpoint();
  const parsedSource = checkpoint.subtitle;
  const serialized = serializeAdaptiveCheckpoint(checkpoint);
  assert.equal(serialized.includes("translatedText"), false);
  assert.deepEqual((parsedSource[0] as any).data.translatedText, "你好");

  const parsed = parseAdaptiveCheckpoint(serialized);
  assert.equal(parsed.version, 3);
  assert.equal((parsed.subtitle[0] as any).data.translatedText, undefined);
});

test("rejects malformed v3 and source subtitles that already contain translations", () => {
  const checkpoint = createCheckpoint();
  const serialized = serializeAdaptiveCheckpoint(checkpoint);
  const malformed = JSON.parse(serialized) as Record<string, unknown>;
  malformed.translation = {
    ...(malformed.translation as Record<string, unknown>),
    semanticFingerprint: "not-a-fingerprint",
  };
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(malformed)));

  const parsedWithResult = JSON.parse(serialized) as Record<string, any>;
  parsedWithResult.subtitle[0].data.translatedText = "偷渡結果";
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(parsedWithResult)));

  const incompleteComplete = JSON.parse(serialized) as Record<string, any>;
  incompleteComplete.scenes[0].status = "pending";
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(incompleteComplete)));
});

test("rejects checkpoint scenes with invalid coverage or oversized targets", () => {
  const duplicateScene = JSON.parse(
    serializeAdaptiveCheckpoint(createCheckpoint())
  ) as Record<string, any>;
  duplicateScene.scenes.push({ ...duplicateScene.scenes[0] });
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(duplicateScene)));

  const escapedBlock = JSON.parse(
    serializeAdaptiveCheckpoint(createCheckpoint())
  ) as Record<string, any>;
  escapedBlock.scenes[0].blocks[0].sceneId = "another-scene";
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(escapedBlock)));

  const oversizedTarget = JSON.parse(
    serializeAdaptiveCheckpoint(createCheckpoint())
  ) as Record<string, any>;
  oversizedTarget.scenes[0].blocks[0].targetTexts = ["字".repeat(1001)];
  assert.throws(() => parseAdaptiveCheckpoint(JSON.stringify(oversizedTarget)));
});

test("allows checkpoint scene gaps only for empty source cues", () => {
  const checkpoint = createCheckpoint();
  checkpoint.subtitle.splice(1, 0, {
    type: "cue" as const,
    data: { text: "", start: 2000, end: 2050 },
  });
  checkpoint.scenes[0]!.sourceEnd = 0;
  checkpoint.scenes[0]!.blocks[0]!.sourceEnd = 0;
  checkpoint.scenes[0]!.blocks[0]!.sourceCueIds = [0];
  checkpoint.scenes.push({
    id: "scene-2",
    sourceStart: 2,
    sourceEnd: 2,
    status: "done",
    blocks: [
      {
        id: "block-2",
        sceneId: "scene-2",
        sourceStart: 2,
        sourceEnd: 2,
        sourceCueIds: [2],
        targetTexts: ["世界"],
        origin: "adaptive",
        semanticFingerprint,
      },
    ],
    violations: [],
  });

  assert.doesNotThrow(() => parseAdaptiveCheckpoint(serializeAdaptiveCheckpoint(checkpoint)));

  checkpoint.subtitle[1]!.data.text = "must not be skipped";
  assert.throws(() => serializeAdaptiveCheckpoint(checkpoint));
});

test("fingerprints ignore operational secrets but track semantic and layout settings", () => {
  const baseline = createAdaptiveSemanticFingerprint({
    apiHost: "https://example.invalid/v1",
    model: "example-model",
    targetLanguage: "繁體中文",
    adaptivePrompt: "Translate {{lang}}",
    additionalInstructions: "Keep names consistent",
    temperature: 0.3,
    contextSize: 5,
  });
  assert.equal(
    baseline,
    createAdaptiveSemanticFingerprint({
      apiHost: "https://example.invalid/v1",
      model: "example-model",
      targetLanguage: "繁體中文",
      adaptivePrompt: "Translate {{lang}}",
      additionalInstructions: "Keep names consistent",
      temperature: 0.3,
      contextSize: 5,
      apiKey: "another-key",
      concurrency: 1,
      rpm: 1,
      delay: 1,
      outputDirectory: "/different",
    })
  );
  assert.notEqual(
    baseline,
    createAdaptiveSemanticFingerprint({
      apiHost: "https://example.invalid/v1",
      model: "example-model",
      targetLanguage: "日本語",
      adaptivePrompt: "Translate {{lang}}",
      additionalInstructions: "Keep names consistent",
      temperature: 0.3,
      contextSize: 5,
    })
  );
  assert.notEqual(
    layoutFingerprint,
    createAdaptiveLayoutFingerprint({
      layoutEngineVersion: 2,
      outputFormat: "srt",
      targetLanguage: "繁體中文",
      layoutOptions: { maxLines: 2 },
    })
  );
});

test("reports completed coverage and resume decisions", () => {
  const checkpoint = createCheckpoint();
  assert.deepEqual(getAdaptiveCheckpointCoverage(checkpoint), [{ start: 0, end: 1 }]);
  assert.equal(hasCompleteAdaptiveCoverage(checkpoint, 2), true);
  assert.doesNotThrow(() => assertCompleteAdaptiveCoverage(checkpoint, 2));
  assert.equal(
    canReuseAdaptiveCheckpoint(checkpoint, {
      sourceName: "episode.srt",
      format: "srt",
      sourceFingerprint: { size: 1024, mtimeMs: 1234.5 },
      semanticFingerprint,
    }),
    true
  );

  const layoutChanged = getAdaptiveCheckpointResumeMetadata(checkpoint, {
    sourceName: "episode.srt",
    format: "srt",
    sourceFingerprint: { size: 1024, mtimeMs: 1234.5 },
    semanticFingerprint,
    layoutFingerprint: createAdaptiveLayoutFingerprint({
      layoutEngineVersion: 2,
      outputFormat: "srt",
    }),
  });
  assert.equal(layoutChanged.mode, "layout-only");
  assert.equal(layoutChanged.canReuseCompletedScenes, true);

  const semanticChanged = getAdaptiveCheckpointResumeMetadata(checkpoint, {
    sourceName: "episode.srt",
    format: "srt",
    sourceFingerprint: { size: 1024, mtimeMs: 1234.5 },
    semanticFingerprint: "f".repeat(64),
  });
  assert.equal(semanticChanged.mode, "restart");
  assert.equal(semanticChanged.shouldBackupCheckpoint, true);

  const sourceChanged = getAdaptiveCheckpointResumeMetadata(checkpoint, {
    sourceName: "episode.srt",
    format: "srt",
    sourceFingerprint: { size: 2048, mtimeMs: 1234.5 },
    semanticFingerprint,
  });
  assert.equal(sourceChanged.mode, "incompatible");
});

test("serializes concurrent writes atomically and leaves the newest snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "adaptive-checkpoint-"));
  const checkpointPath = path.join(directory, "episode.translation.json");
  try {
    const writer = createAdaptiveCheckpointWriter(checkpointPath);
    const first = createCheckpoint("in-progress");
    const second = createCheckpoint("complete");
    await Promise.all([writer.write(first), writer.write(second)]);
    await writer.flush();
    const persisted = parseAdaptiveCheckpoint(await readFile(checkpointPath, "utf8"));
    assert.equal(persisted.state, "complete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not let a late in-progress snapshot overwrite a completed checkpoint", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "adaptive-checkpoint-"));
  const checkpointPath = path.join(directory, "episode.translation.json");
  try {
    const writer = createAdaptiveCheckpointWriter(checkpointPath);
    await writer.write(createCheckpoint("complete"));
    await writer.write(createCheckpoint("in-progress"));
    const persisted = parseAdaptiveCheckpoint(await readFile(checkpointPath, "utf8"));
    assert.equal(persisted.state, "complete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not let an older complete snapshot overwrite newer complete progress", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "adaptive-checkpoint-"));
  const checkpointPath = path.join(directory, "episode.translation.json");
  try {
    const writer = createAdaptiveCheckpointWriter(checkpointPath);
    const newer = createCheckpoint("complete");
    newer.usage.push({
      stage: "adaptive-translate",
      model: "fixture",
      sceneId: "scene-0",
      requestAttempt: 1,
      durationMs: 1,
    });
    newer.usageSummary.requestCount = 1;
    await writer.write(newer);
    await writer.write(createCheckpoint("complete"));
    const persisted = parseAdaptiveCheckpoint(await readFile(checkpointPath, "utf8"));
    assert.equal(persisted.usage.length, 1);
    assert.equal(persisted.usageSummary.requestCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stripAdaptiveTranslations does not mutate parser output", () => {
  const checkpoint = createCheckpoint();
  const original = checkpoint.subtitle;
  const stripped = stripAdaptiveTranslations(original);
  assert.equal((original[0] as any).data.translatedText, "你好");
  assert.equal((stripped[0] as any).data.translatedText, undefined);
});
