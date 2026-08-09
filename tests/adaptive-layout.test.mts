import assert from "node:assert/strict";
import test from "node:test";
import {
  countReadingUnits,
  detectTextLayoutProfile,
  layoutAdaptiveBlock,
  wrapSubtitleText,
} from "../electron/main/utils/adaptive/layout.ts";
import type { AdaptiveSourceCue, TranslationBlock } from "../electron/main/utils/adaptive/types.ts";

function cue(index: number, text: string, startMs: number, endMs: number): AdaptiveSourceCue {
  return {
    id: index,
    sourceIndex: index,
    startMs,
    endMs,
    originalText: text,
    modelText: text,
    plainText: text,
    durationMs: endMs - startMs,
    gapAfterMs: null,
    protectedTokens: [],
    flags: {
      empty: text.trim().length === 0,
      overlapping: false,
      multiSpeaker: false,
      lockedOneToOne: false,
    },
  };
}

function block(ids: number[], targetTexts: string[]): TranslationBlock {
  return {
    id: `scene-0-block-${ids[0] ?? 0}`,
    sceneId: "scene-0",
    sourceStart: ids[0] ?? 0,
    sourceEnd: ids.at(-1) ?? ids[0] ?? 0,
    sourceCueIds: ids,
    targetTexts,
    origin: "adaptive",
    semanticFingerprint: "test",
  };
}

test("Intl.Segmenter counts graphemes rather than UTF-16 code units", () => {
  assert.equal(countReadingUnits("😀"), 1);
  assert.equal(countReadingUnits("á"), 1);
  assert.equal(countReadingUnits("你 好"), 2);
  assert.equal(detectTextLayoutProfile("你好世界"), "cjk");
  assert.equal(detectTextLayoutProfile("hello world"), "latin");
});

test("uses union span for one target and weighted allocation for two targets", () => {
  const sources = [cue(0, "A", 1_000, 2_000), cue(1, "B", 2_050, 4_000)];
  const merged = layoutAdaptiveBlock(block([0, 1], ["AB"]), sources);
  assert.equal(merged.targetCues.length, 1);
  assert.equal(merged.targetCues[0]?.startMs, 1_000);
  assert.equal(merged.targetCues[0]?.endMs, 4_000);

  const split = layoutAdaptiveBlock(
    block([0], ["short", "a much longer second subtitle"]),
    [cue(0, "A", 1_000, 7_000)],
  );
  assert.equal(split.targetCues.length, 2);
  assert.equal(split.targetCues[0]?.startMs, 1_000);
  assert.equal(split.targetCues.at(-1)?.endMs, 7_000);
  assert.ok(split.targetCues.every((target) => target.startMs < target.endMs));
  assert.ok(
    split.targetCues.slice(1).every((target, index) =>
      target.startMs >= (split.targetCues[index]?.endMs ?? 0),
    ),
  );
});

test("retains equal source/target boundaries when all durations are legal", () => {
  const sources = [cue(0, "A", 1_000, 2_000), cue(1, "B", 2_100, 3_500)];
  const result = layoutAdaptiveBlock(block([0, 1], ["甲", "乙"]), sources);
  assert.deepEqual(
    result.targetCues.map((target) => [target.startMs, target.endMs]),
    [[1_000, 2_000], [2_100, 3_500]],
  );
});

test("merges adjacent targets deterministically when duration is insufficient", () => {
  const result = layoutAdaptiveBlock(
    block([0], ["A", "B", "C"]),
    [cue(0, "A", 1_000, 1_400)],
  );
  assert.equal(result.targetCues.length, 1);
  assert.equal(result.targetTexts[0], "A B C");
  assert.ok(
    result.violations.some(
      (item) =>
        item.code === "adaptive.layout.insufficientDuration" &&
        item.severity === "warning"
    )
  );
  assert.ok(result.targetCues.every((target) => target.startMs < target.endMs));
});

test("wraps without truncating Latin/CJK and preserves hard-break placeholders", () => {
  const latin = wrapSubtitleText("This is a long subtitle that should remain complete", {
    maxLineUnitsLatin: 18,
  });
  assert.equal(latin.renderedText.replaceAll("\n", " ").replace(/ +/g, " ").trim(), "This is a long subtitle that should remain complete");
  assert.ok(latin.lineCount >= 2);

  const cjk = wrapSubtitleText("這是一段需要平衡換行的中文字幕內容", {
    maxLineUnitsCjk: 8,
  });
  assert.equal(cjk.renderedText.replaceAll("\n", ""), "這是一段需要平衡換行的中文字幕內容");
  assert.ok(cjk.lineCount >= 2);

  const protectedText = wrapSubtitleText("前__ST_TAG_0__中__ST_TAG_1__後", {
    maxLineUnitsCjk: 2,
  });
  assert.match(protectedText.renderedText, /__ST_TAG_0__/);
  assert.match(protectedText.renderedText, /__ST_TAG_1__/);
  assert.equal(wrapSubtitleText("甲__ST_BR_0__乙").renderedText, "甲\n乙");
});
