import assert from "node:assert/strict";
import test from "node:test";
import {
  compactRepetitiveSubtitleText,
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

test("compacts pathological single-token repetition", () => {
  const repeated = Array.from({ length: 100 }, () => "Oh.").join(" ");

  assert.equal(
    compactRepetitiveSubtitleText(repeated),
    "Oh. Oh. Oh. … [source phrase repeats 100 times total]"
  );
});

test("compacts short repeated phrases without changing ordinary subtitles", () => {
  const repeatedPhrase = Array.from({ length: 16 }, () => "No way!").join(" ");

  assert.equal(
    compactRepetitiveSubtitleText(repeatedPhrase),
    "No way! No way! No way! … [source phrase repeats 16 times total]"
  );
  assert.equal(
    compactRepetitiveSubtitleText("Oh. Oh. That is enough."),
    "Oh. Oh. That is enough."
  );
});
