import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranslationConfigFingerprint,
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

test("resumes only with the same translation configuration", () => {
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
