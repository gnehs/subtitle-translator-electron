import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeAdaptiveDraft,
  validateAdaptiveDraft,
  validateAdaptiveDraftPartition,
} from "../electron/main/utils/adaptive/validator.ts";

function cue(index: number, text: string, modelText = text) {
  return {
    id: index,
    sourceIndex: index,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    originalText: text,
    modelText,
    plainText: text,
    durationMs: 900,
    gapAfterMs: 100,
    protectedTokens: [],
    flags: {
      empty: text.trim().length === 0,
      overlapping: false,
      multiSpeaker: false,
      lockedOneToOne: false,
    },
  };
}

function scene(core: ReturnType<typeof cue>[], lockedOneToOne = false) {
  return {
    id: `scene-${core[0]?.id ?? 0}-${core.at(-1)?.id ?? 0}`,
    sourceStart: core[0]?.id ?? 0,
    sourceEnd: core.at(-1)?.id ?? 0,
    core,
    before: [],
    after: [],
    lockedOneToOne,
  };
}

test("materializes 2→1 and 1→2 partitions with exact source ranges", () => {
  const twoCueScene = scene([cue(0, "I didn't know"), cue(1, "he was your brother.")]);
  const merged = validateAdaptiveDraft(
    { blocks: [{ take: 2, targets: ["我不知道他是你哥哥。"] }] },
    twoCueScene,
  );
  assert.equal(merged.valid, true);
  assert.deepEqual(merged.blocks?.[0]?.sourceCueIds, [0, 1]);
  assert.equal(merged.blocks?.[0]?.sourceStart, 0);
  assert.equal(merged.blocks?.[0]?.sourceEnd, 1);

  const split = materializeAdaptiveDraft(
    { blocks: [{ take: 1, targets: ["我想告訴你真相。", "但我害怕你會離開。"] }] },
    scene([cue(0, "I wanted to tell you the truth, but I was afraid you would leave.")]),
  );
  assert.equal(split.violations.some((item) => item.severity === "error"), false);
  assert.deepEqual(split.blocks[0]?.targetTexts, ["我想告訴你真相。", "但我害怕你會離開。"]);
});

test("rejects incomplete, over-consumed, empty and extra-property drafts", () => {
  const currentScene = scene([cue(0, "A"), cue(1, "B")]);
  const incomplete = validateAdaptiveDraftPartition(
    { blocks: [{ take: 1, targets: ["甲"] }] },
    currentScene,
  );
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.violations.some((item) => item.code.includes("CoverageMissing".replace("CoverageMissing", "sourceCoverageMissing"))));

  const overConsumed = validateAdaptiveDraftPartition(
    { blocks: [{ take: 4, targets: ["甲"] }] },
    currentScene,
  );
  assert.equal(overConsumed.valid, false);
  assert.ok(overConsumed.violations.some((item) => item.code === "adaptive.partition.sourceCoverageExceeded"));

  const malformed = validateAdaptiveDraftPartition(
    { blocks: [{ take: 1, targets: [""], explanation: "not allowed" }] },
    scene([cue(0, "A")]),
  );
  assert.equal(malformed.valid, false);
  assert.ok(malformed.violations.some((item) => item.code === "adaptive.partition.extraProperty"));
  assert.ok(malformed.violations.some((item) => item.code === "adaptive.partition.emptyTarget"));
});

test("placeholder loss and reordering are hard errors", () => {
  const protectedScene = scene([
    cue(
      0,
      "<i>Hello</i>",
      "__ST_TAG_0__Hello__ST_TAG_1__",
    ),
  ]);
  const missing = validateAdaptiveDraft(
    { blocks: [{ take: 1, targets: ["哈囉"] }] },
    protectedScene,
  );
  assert.equal(missing.valid, false);
  assert.ok(missing.violations.some((item) => item.code.startsWith("adaptive.placeholder.")));

  const reordered = validateAdaptiveDraft(
    { blocks: [{ take: 1, targets: ["__ST_TAG_1__哈囉__ST_TAG_0__"] }] },
    protectedScene,
  );
  assert.equal(reordered.valid, false);
  assert.ok(reordered.violations.some((item) => item.code === "adaptive.placeholder.orderMismatch"));
});

test("locked scenes require one block and one target per cue", () => {
  const lockedScene = scene([cue(0, "A"), cue(1, "B")], true);
  const result = validateAdaptiveDraft(
    { blocks: [{ take: 2, targets: ["甲乙"] }] },
    lockedScene,
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((item) => item.code === "adaptive.partition.lockedOneToOne"));
});

test("foundation validator rejects targets over the schema length limit", () => {
  const result = validateAdaptiveDraft(
    { blocks: [{ take: 1, targets: ["a".repeat(1001)] }] },
    scene([cue(0, "A")]),
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some(
      (item) => item.code === "adaptive.partition.targetTooLong",
    ),
  );
});
