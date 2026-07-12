import assert from "node:assert/strict";
import test from "node:test";
import {
  isSubtitleCueComplete,
  splitIntoChunk,
} from "../electron/main/utils/subtitle-chunks.ts";

const cue = (text: string, translatedText?: string) => ({
  data: {
    text,
    ...(translatedText === undefined ? {} : { translatedText }),
  },
});

test("keeps resumed untranslated regions contiguous", () => {
  const chunks = splitIntoChunk(
    [cue("A"), cue("B", "已完成"), cue("C"), cue("D")],
    20
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.map(({ data }) => data.text)),
    [["A"], ["C", "D"]]
  );
});

test("retries blank translations for non-blank source cues", () => {
  const blankTranslation = cue("Needs translation", "");

  assert.equal(isSubtitleCueComplete(blankTranslation), false);
  assert.deepEqual(splitIntoChunk([blankTranslation]), [[blankTranslation]]);
});

test("skips blank source cues and bounds invalid chunk sizes", () => {
  assert.equal(isSubtitleCueComplete(cue("  ")), true);
  assert.equal(splitIntoChunk([cue("A"), cue("B")], 0).length, 2);
});
