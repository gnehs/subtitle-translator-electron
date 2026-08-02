import assert from "node:assert/strict";
import test from "node:test";
import { renderAdaptiveSrt } from "../electron/main/utils/adaptive/renderer.ts";

function sourceCue(text: string, start: number, end: number) {
  return {
    type: "cue" as const,
    data: { text, start, end },
  };
}

function translationBlock(
  id: string,
  sourceStart: number,
  sourceEnd: number,
  sourceCueIds: number[],
  targetTexts: string[],
) {
  return {
    id,
    sceneId: `scene-${sourceStart}-${sourceEnd}`,
    sourceStart,
    sourceEnd,
    sourceCueIds,
    targetTexts,
    origin: "adaptive" as const,
    semanticFingerprint: "test",
  };
}

function scene(
  sourceStart: number,
  sourceEnd: number,
  blocks: ReturnType<typeof translationBlock>[],
) {
  return {
    id: `scene-${sourceStart}-${sourceEnd}`,
    sourceStart,
    sourceEnd,
    status: "done" as const,
    blocks,
    violations: [],
  };
}

test("renders 2→1 and 1→2 in source order with continuous SRT numbering", () => {
  const source = [
    sourceCue("I didn't know", 1_000, 1_900),
    sourceCue("he was your brother.", 1_940, 3_200),
    sourceCue("Really?", 4_000, 5_000),
  ];
  // Deliberately return scenes out of completion order; renderer sorts by
  // immutable source range.
  const result = renderAdaptiveSrt(source, [
    scene(2, 2, [translationBlock("b2", 2, 2, [2], ["真的嗎？"])]),
    scene(0, 1, [translationBlock("b1", 0, 1, [0, 1], ["我不知道他是你哥哥。"])]),
  ]);
  assert.equal(result.violations.some((item) => item.severity === "error"), false);
  assert.equal(result.targetCues.length, 2);
  assert.deepEqual(result.targetCues.map((cue) => cue.id), ["b1-target-0", "b2-target-0"]);
  assert.match(result.content, /^1\n00:00:01,000 --> 00:00:03,200\n我不知道他是你哥哥。\n\n2\n/);
  assert.match(result.content, /00:00:04,000 --> 00:00:05,000\n真的嗎？\n$/);

  const splitResult = renderAdaptiveSrt(
    [sourceCue("I wanted to tell you the truth, but I was afraid you would leave.", 1_000, 5_000)],
    [scene(0, 0, [translationBlock("split", 0, 0, [0], ["我想告訴你真相。", "但我害怕你會離開。"])]),],
  );
  assert.equal(splitResult.targetCues.length, 2);
  assert.match(splitResult.content, /^1\n/);
  assert.match(splitResult.content, /\n\n2\n/);
});

test("partial output never uses unfinished source text as a translation", () => {
  const source = [
    sourceCue("翻譯完成", 1_000, 2_000),
    sourceCue("尚未翻譯", 2_100, 3_000),
  ];
  const result = renderAdaptiveSrt(
    source,
    [scene(0, 0, [translationBlock("done", 0, 0, [0], ["完成"])]),],
  );
  assert.equal(result.content.includes("尚未翻譯"), false);
  assert.ok(result.violations.some((item) => item.code === "adaptive.renderer.coverageMissing"));
  assert.equal(result.targetCues.length, 1);
});

test("restores protected markup placeholders from source text", () => {
  const result = renderAdaptiveSrt(
    [sourceCue("<i>Hello</i>", 1_000, 2_000)],
    [
      scene(0, 0, [
        translationBlock("markup", 0, 0, [0], ["__ST_TAG_0__哈囉__ST_TAG_1__"]),
      ]),
    ],
  );
  assert.equal(result.targetCues[0]?.semanticText, "<i>哈囉</i>");
  assert.equal(result.targetCues[0]?.renderedText, "<i>哈囉</i>");
  assert.match(result.content, /<i>哈囉<\/i>/);
});
