import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubtitlePreview,
  getTranslatedPreviewText,
} from "../electron/main/utils/subtitle-preview.ts";
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
    { kind: "strict", text: "First", translatedText: "第一", start: 0, end: 1_000 },
    { kind: "strict", text: "Second", translatedText: "第二", start: 0, end: 1_000 },
  ]);
});

test("recovers translated text from styled bilingual ASS output", () => {
  assert.equal(
    getTranslatedPreviewText(
      "{\\fnNoto Sans TC}譯文\\N{\\fnArial\\b0\\fs14}Original",
      "Original"
    ),
    "譯文"
  );
});
