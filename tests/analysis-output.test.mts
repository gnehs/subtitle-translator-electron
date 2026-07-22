import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSubtitleAnalysis,
  subtitleAnalysisSchema,
} from "../electron/main/utils/analysis-output.ts";

test("validates and deterministically formats subtitle analysis", () => {
  const analysis = subtitleAnalysisSchema.parse({
    plotSummary: "A detective follows a trail of clues.",
    glossary: [
      {
        term: "Inspector Lin",
        description: "The detective leading the investigation.",
        category: "person",
        preferredTranslation: "林探長",
        notes: null,
      },
    ],
  });

  assert.equal(
    formatSubtitleAnalysis(analysis),
    [
      "## Plot Summary",
      "",
      "A detective follows a trail of clues.",
      "",
      "## Glossary",
      "",
      "- Inspector Lin: The detective leading the investigation.",
      "  - Category: person",
      "  - Preferred translation: 林探長",
    ].join("\n")
  );
});

test("keeps an explicit glossary section when no terms are found", () => {
  const analysis = subtitleAnalysisSchema.parse({
    plotSummary: "Two friends have an ordinary conversation.",
    glossary: [],
  });

  assert.match(
    formatSubtitleAnalysis(analysis),
    /## Glossary\n\n- No glossary entries identified\./
  );
});

test("rejects incomplete glossary entries", () => {
  const result = subtitleAnalysisSchema.safeParse({
    plotSummary: "A complete summary.",
    glossary: [{ term: "Missing fields" }],
  });

  assert.equal(result.success, false);
});
