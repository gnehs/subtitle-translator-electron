import assert from "node:assert/strict";
import test from "node:test";
import { createSubtitlePreview } from "../electron/main/utils/subtitle-preview.ts";
import type { SubtitleCue } from "../electron/main/utils/translate.ts";

function cue(text: string, translatedText?: string): SubtitleCue {
  return {
    type: "cue",
    data: { start: 0, end: 1_000, text, translatedText },
  };
}

test("creates a self-contained final preview before its checkpoint is removed", () => {
  const source = [cue("First"), cue("Second")];
  const translated = [cue("First", "第一"), cue("Second", "Second\n第二")];

  assert.deepEqual(createSubtitlePreview(source, translated), [
    { text: "First", translatedText: "第一", start: 0, end: 1_000 },
    { text: "Second", translatedText: "第二", start: 0, end: 1_000 },
  ]);
});
