import assert from "node:assert/strict";
import test from "node:test";
import { selectBriefForScene } from "../electron/main/utils/adaptive/brief.ts";
import type { TranslationBrief } from "../electron/main/utils/adaptive/types.ts";

const brief: TranslationBrief = {
  summary: "A detective questions a witness in a district attorney's office.",
  style: { tone: "Natural", register: "Spoken", notes: ["Use Taiwanese terms"] },
  characters: [
    { sourceName: "John", preferredTranslation: "約翰", aliases: ["Johnny"], notes: null },
    { sourceName: "Mary", preferredTranslation: "瑪莉", aliases: [], notes: null },
  ],
  glossary: [
    {
      source: "district attorney",
      preferredTranslation: "地方檢察官",
      aliases: ["DA"],
      notes: null,
    },
  ],
};

test("brief retrieval handles aliases, case folding, and CJK substring matches", () => {
  const scene = selectBriefForScene(brief, ["JOHNNY was here", "District attorney office"]);
  assert.deepEqual(scene.characters.map((entry) => entry.sourceName), ["John"]);
  assert.deepEqual(scene.glossary.map((entry) => entry.source), ["district attorney"]);
  assert.equal(scene.style.tone, "Natural");
});

test("brief retrieval applies deterministic entry and summary limits", () => {
  const selected = selectBriefForScene(brief, ["John DA"], {
    maxCharacters: 0,
    maxGlossary: 1,
    summaryMaxCharacters: 10,
  });
  assert.deepEqual(selected.characters, []);
  assert.equal(selected.glossary.length, 1);
  assert.ok(Array.from(selected.summary).length <= 10);
});
