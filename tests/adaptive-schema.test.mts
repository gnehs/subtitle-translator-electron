import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveSceneDraftSchema,
  createStrictFallbackOutputSchema,
  parseTranslationBrief,
  translationBriefSchema,
} from "../electron/main/utils/adaptive/schema.ts";

test("adaptive draft schema accepts merge/split blocks and trims targets", () => {
  const draft = adaptiveSceneDraftSchema.parse({
    blocks: [
      { take: 2, targets: [" 我不知道他是你哥哥。 "] },
      { take: 1, targets: ["真的嗎？", "Really?"] },
    ],
  });

  assert.equal(draft.blocks[0]?.targets[0], "我不知道他是你哥哥。");
  assert.equal(draft.blocks[1]?.targets.length, 2);
});

test("adaptive draft schema rejects unsupported structure", () => {
  assert.equal(
    adaptiveSceneDraftSchema.safeParse({
      blocks: [{ take: 0, targets: ["text"] }],
    }).success,
    false
  );
  assert.equal(
    adaptiveSceneDraftSchema.safeParse({
      blocks: [{ take: 1, targets: ["text"], extra: true }],
    }).success,
    false
  );
});

test("strict fallback schema requires one non-empty translation per cue", () => {
  const schema = createStrictFallbackOutputSchema(2);

  assert.deepEqual(schema.parse({ elements: ["第一句", "第二句"] }), {
    elements: ["第一句", "第二句"],
  });
  assert.equal(schema.safeParse({ elements: ["只有一句"] }).success, false);
  assert.equal(schema.safeParse({ elements: ["第一句", ""] }).success, false);
  assert.equal(
    schema.safeParse({ elements: ["第一句", "第二句"], extra: true }).success,
    false
  );
});

test("translation brief schema accepts nullable notes and rejects extra fields", () => {
  const brief = parseTranslationBrief({
    summary: "A detective questions a witness.",
    style: { tone: "Natural", register: "Spoken", notes: [] },
    characters: [
      {
        sourceName: "John",
        preferredTranslation: "約翰",
        aliases: ["Johnny"],
        notes: null,
      },
    ],
    glossary: [],
  });
  assert.equal(brief.characters[0]?.preferredTranslation, "約翰");
  assert.equal(
    translationBriefSchema.safeParse({
      summary: "ok",
      style: { tone: "", register: "", notes: [] },
      characters: [],
      glossary: [],
      extra: "not allowed",
    }).success,
    false
  );
});
