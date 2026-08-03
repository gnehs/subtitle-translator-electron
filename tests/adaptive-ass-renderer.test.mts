import assert from "node:assert/strict";
import test from "node:test";
import assParser from "ass-parser";
import {
  renderAdaptiveAss,
  type AdaptiveAssEvent,
} from "../electron/main/utils/adaptive/ass-renderer.ts";

function sourceCue(text: string, start: number, end: number) {
  return { type: "cue" as const, data: { text, start, end } };
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

function dialogueEvents(content: string): Array<Record<string, string>> {
  const sections = assParser(content) as Array<{
    section?: string;
    body?: Array<{ key?: string; value?: Record<string, string> | string[] }>;
  }>;
  return sections
    .find((section) => section.section === "Events")
    ?.body?.filter(
      (line): line is { key: "Dialogue"; value: Record<string, string> } =>
        line.key === "Dialogue" &&
        typeof line.value === "object" &&
        line.value !== null &&
        !Array.isArray(line.value),
    )
    .map((line) => line.value) ?? [];
}

test("emits independent original and adaptive translation Dialogue streams", () => {
  const result = renderAdaptiveAss(
    [
      sourceCue("I didn't know", 1_000, 1_900),
      sourceCue("he was your brother.", 1_940, 3_200),
      sourceCue("Really?", 4_000, 5_000),
    ],
    [
      // Deliberately complete scenes out of order: the SRT materializer and
      // this ASS renderer must continue to use immutable source ranges.
      scene(2, 2, [translationBlock("b2", 2, 2, [2], ["真的嗎？"])]),
      scene(0, 1, [translationBlock("b1", 0, 1, [0, 1], ["我不知道他是你哥哥。"])]),
    ],
    { assFonts: { originalFont: "Arial", translationFont: "Noto Sans TC" } },
  );

  assert.equal(result.violations.some((item) => item.severity === "error"), false);
  assert.equal(result.originalEvents.length, 3);
  assert.equal(result.translationEvents.length, 2);
  assert.deepEqual(
    result.originalEvents.map((event) => [event.startMs, event.endMs]),
    [
      [1_000, 1_900],
      [1_940, 3_200],
      [4_000, 5_000],
    ],
  );
  assert.deepEqual(
    result.translationEvents.map((event) => [event.startMs, event.endMs]),
    [
      [1_000, 3_200],
      [4_000, 5_000],
    ],
  );
  assert.deepEqual(result.translationEvents[0]?.sourceCueIds, [0, 1]);

  const events = dialogueEvents(result.content);
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.slice(0, 3).map((event) => [event.Style, event.Layer, event.Name]),
    [
      ["ST Original", "0", "Original"],
      ["ST Original", "0", "Original"],
      ["ST Original", "0", "Original"],
    ],
  );
  assert.deepEqual(
    events.slice(3).map((event) => [event.Style, event.Layer, event.Name]),
    [
      ["ST Translation", "1", "Translation"],
      ["ST Translation", "1", "Translation"],
    ],
  );
  assert.match(result.content, /Style: ST Original,Arial,16,/);
  assert.match(result.content, /Style: ST Translation,Noto Sans TC,20,/);
  assert.match(result.content, /Style: ST Original,Arial,16,[^\n]*,8,20,20,24,1/);
  assert.match(result.content, /Style: ST Translation,Noto Sans TC,20,[^\n]*,2,20,20,24,1/);
});

test("supports one-to-many target blocks and ASS-safe markup", () => {
  const result = renderAdaptiveAss(
    [sourceCue("<i>Say {hello}</i>\\Nnext", 1_000, 5_000)],
    [
      scene(0, 0, [
        translationBlock("split", 0, 0, [0], ["<b>{safe}</b>", "{\\pos(0,0)}"]),
      ]),
    ],
  );

  assert.equal(result.translationEvents.length, 2);
  assert.match(result.content, /\\N/);
  assert.match(result.content, /\{\\b1\}\\\{safe\\\}\{\\b0\}/);
  // Model-supplied override blocks are rendered literally, not executed.
  assert.equal(result.content.includes("{\\pos(0,0)}"), false);
  assert.equal(result.content.includes("\\{\\pos(0,0)\\}"), false);
  assert.ok(result.content.includes("\\\\pos(0,0)"));
  assert.ok(result.content.endsWith("\n"));
});

test("keeps partial output free of unfinished source text and reports coverage", () => {
  const result = renderAdaptiveAss(
    [sourceCue("完成", 1_000, 2_000), sourceCue("尚未翻譯", 2_100, 3_000)],
    [scene(0, 0, [translationBlock("done", 0, 0, [0], ["完成"])])],
  );
  assert.equal(result.translationEvents.length, 1);
  assert.equal(result.content.includes("尚未翻譯"), true);
  assert.ok(
    result.violations.some(
      (item) => item.code === "adaptive.renderer.coverageMissing" && item.severity === "error",
    ),
  );
});

test("exposes an event stream useful to callers without assuming one-to-one mapping", () => {
  const result = renderAdaptiveAss(
    [sourceCue("one", 0, 1_000)],
    [scene(0, 0, [translationBlock("one", 0, 0, [0], ["一"])] )],
  );
  const kinds = result.events.map((event: AdaptiveAssEvent) => event.kind);
  assert.deepEqual(kinds, ["original", "translation"]);
  assert.equal(result.events[0]?.sourceCueId, 0);
  assert.equal(result.events[1]?.targetCueId, "one-target-0");
});
