import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranslationConfigFingerprint,
  getTranslationCheckpointCandidates,
  getTranslationCheckpointResumeMetadata,
  hasMatchingCheckpointSource,
  hasMatchingTranslationConfig,
} from "../electron/main/utils/translation-checkpoint.ts";

const fingerprint = { size: 1_024, mtimeMs: 123_456.75 };

test("resumes only when name, format, size, and modification time match", () => {
  const checkpoint = {
    format: "srt",
    source: { name: "episode.srt", fingerprint },
  };

  assert.equal(
    hasMatchingCheckpointSource(
      checkpoint,
      "episode.srt",
      "srt",
      fingerprint
    ),
    true
  );
  assert.equal(
    hasMatchingCheckpointSource(checkpoint, "renamed.srt", "srt", fingerprint),
    false
  );
  assert.equal(
    hasMatchingCheckpointSource(checkpoint, "episode.srt", "vtt", fingerprint),
    false
  );
  assert.equal(
    hasMatchingCheckpointSource(checkpoint, "episode.srt", "srt", {
      ...fingerprint,
      size: fingerprint.size + 1,
    }),
    false
  );
});

test("does not auto-resume legacy checkpoints without a fingerprint", () => {
  assert.equal(
    hasMatchingCheckpointSource(
      { format: "srt", source: { name: "episode.srt" } },
      "episode.srt",
      "srt",
      fingerprint
    ),
    false
  );
});

test("identifies whether the translation configuration matches", () => {
  const config = {
    apiHost: "https://api.openai.com/v1",
    model: "example-model",
    prompt: "Translate to {{lang}}",
    lang: "Traditional Chinese",
    additional: "Keep names consistent",
    temperature: 0.3,
    contextSize: 5,
  };
  const configFingerprint = createTranslationConfigFingerprint(config);
  const checkpoint = {
    format: "srt",
    source: { name: "episode.srt", fingerprint },
    translation: { configFingerprint },
  };

  assert.equal(
    hasMatchingTranslationConfig(checkpoint, configFingerprint),
    true
  );
  assert.equal(
    hasMatchingTranslationConfig(
      checkpoint,
      createTranslationConfigFingerprint({ ...config, lang: "Japanese" })
    ),
    false
  );
  assert.equal(
    hasMatchingTranslationConfig(
      { format: "srt", source: { name: "episode.srt", fingerprint } },
      configFingerprint
    ),
    false
  );
});

test("preserves completed work but invalidates analysis when settings change", () => {
  const checkpoint = {
    version: 2 as const,
    format: "srt",
    source: { name: "episode.srt", fingerprint },
    translation: { configFingerprint: "a".repeat(64) },
    analysis: "Existing context",
  };

  assert.deepEqual(
    getTranslationCheckpointResumeMetadata(checkpoint, "b".repeat(64)),
    {
      analysis: undefined,
      shouldBackupCheckpoint: true,
    }
  );
  assert.deepEqual(
    getTranslationCheckpointResumeMetadata(checkpoint, "a".repeat(64)),
    {
      analysis: "Existing context",
      shouldBackupCheckpoint: false,
    }
  );
});

test("finds both stable and version 1.8.0 checkpoint names", () => {
  assert.deepEqual(
    getTranslationCheckpointCandidates("/tmp/episode.srt"),
    [
      "/tmp/episode.translation.json",
      "/tmp/episode.srt.translation.json",
    ]
  );
  assert.deepEqual(
    getTranslationCheckpointCandidates("/tmp/episode.translation.json"),
    ["/tmp/episode.translation.json"]
  );
});
