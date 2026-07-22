import { z } from "zod";

const glossaryEntrySchema = z.object({
  term: z.string().trim().min(1).describe("The source-language term"),
  description: z
    .string()
    .trim()
    .min(1)
    .describe("A concise explanation in the requested language"),
  category: z
    .enum(["person", "place", "organization", "jargon", "fictional", "other"])
    .nullable()
    .describe("The term category, or null when no category fits"),
  preferredTranslation: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe("The preferred translation, or null when not applicable"),
  notes: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe("Additional translation guidance, or null when unnecessary"),
});

export const subtitleAnalysisSchema = z.object({
  plotSummary: z
    .string()
    .trim()
    .min(1)
    .describe("A coherent plot summary in the requested language"),
  glossary: z
    .array(glossaryEntrySchema)
    .max(20)
    .describe("Important terms found in the subtitle sample"),
});

export type SubtitleAnalysis = z.infer<typeof subtitleAnalysisSchema>;

export function formatSubtitleAnalysis(analysis: SubtitleAnalysis): string {
  const glossary = analysis.glossary.flatMap((entry) => {
    const lines = [`- ${entry.term}: ${entry.description}`];
    if (entry.category) lines.push(`  - Category: ${entry.category}`);
    if (entry.preferredTranslation) {
      lines.push(`  - Preferred translation: ${entry.preferredTranslation}`);
    }
    if (entry.notes) lines.push(`  - Notes: ${entry.notes}`);
    return lines;
  });

  if (glossary.length === 0) {
    glossary.push("- No glossary entries identified.");
  }

  return [
    "## Plot Summary",
    "",
    analysis.plotSummary,
    "",
    "## Glossary",
    "",
    ...glossary,
  ].join("\n");
}
