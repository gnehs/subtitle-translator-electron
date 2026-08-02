import type {
  AdaptiveSourceCue,
  SceneBrief,
  TranslationBrief,
  TranslationBriefCharacter,
  TranslationBriefGlossaryEntry,
} from "./types.ts";

export interface SelectBriefForSceneOptions {
  maxCharacters?: number;
  maxGlossary?: number;
  summaryMaxCharacters?: number;
}

function normaliseForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function truncateByCodePoint(value: string, maxCharacters: number): string {
  const max = Number.isFinite(maxCharacters)
    ? Math.max(0, Math.floor(maxCharacters))
    : 0;
  if (Array.from(value).length <= max) return value;
  return Array.from(value).slice(0, max).join("").trimEnd();
}

function sceneTextValue(value: string | AdaptiveSourceCue): string {
  if (typeof value === "string") return value;
  return value.plainText || value.originalText;
}

function matchesEntry(
  sceneText: string,
  source: string,
  aliases: readonly string[]
): boolean {
  const haystack = normaliseForMatch(sceneText);
  const candidates = [source, ...aliases]
    .map((candidate) => normaliseForMatch(candidate.trim()))
    .filter(Boolean);
  return candidates.some((candidate) => haystack.includes(candidate));
}

function cloneCharacter(entry: TranslationBriefCharacter): TranslationBriefCharacter {
  return {
    sourceName: entry.sourceName,
    preferredTranslation: entry.preferredTranslation,
    aliases: [...entry.aliases],
    notes: entry.notes,
  };
}

function cloneGlossary(entry: TranslationBriefGlossaryEntry): TranslationBriefGlossaryEntry {
  return {
    source: entry.source,
    preferredTranslation: entry.preferredTranslation,
    aliases: [...entry.aliases],
    notes: entry.notes,
  };
}

/**
 * Select only brief entries relevant to a scene. Matching intentionally uses
 * normalized substring checks instead of tokenization or embeddings so CJK
 * source text remains searchable without whitespace.
 */
export function selectBriefForScene(
  brief: TranslationBrief,
  sceneTexts: readonly (string | AdaptiveSourceCue)[],
  options: SelectBriefForSceneOptions = {}
): SceneBrief {
  const maxCharacters = Number.isFinite(options.maxCharacters)
    ? Math.max(0, Math.floor(options.maxCharacters as number))
    : 8;
  const maxGlossary = Number.isFinite(options.maxGlossary)
    ? Math.max(0, Math.floor(options.maxGlossary as number))
    : 12;
  const summaryMaxCharacters = Number.isFinite(options.summaryMaxCharacters)
    ? Math.max(0, Math.floor(options.summaryMaxCharacters as number))
    : 500;
  const sceneText = sceneTexts.map(sceneTextValue).join("\n");

  const characters: TranslationBriefCharacter[] = [];
  for (const character of brief.characters) {
    if (characters.length >= maxCharacters) break;
    if (matchesEntry(sceneText, character.sourceName, character.aliases)) {
      characters.push(cloneCharacter(character));
    }
  }

  const glossary: TranslationBriefGlossaryEntry[] = [];
  for (const entry of brief.glossary) {
    if (glossary.length >= maxGlossary) break;
    if (matchesEntry(sceneText, entry.source, entry.aliases)) {
      glossary.push(cloneGlossary(entry));
    }
  }

  return {
    summary: truncateByCodePoint(brief.summary, summaryMaxCharacters),
    style: {
      tone: brief.style.tone,
      register: brief.style.register,
      notes: [...brief.style.notes],
    },
    characters,
    glossary,
  };
}

/** A valid empty brief used when optional analysis fails. */
export function createEmptyTranslationBrief(): TranslationBrief {
  return {
    summary: "",
    style: { tone: "", register: "", notes: [] },
    characters: [],
    glossary: [],
  };
}

/** Deterministic human-readable representation for the existing UI. */
export function formatTranslationBrief(brief: TranslationBrief): string {
  const styleLines = [
    `- Tone: ${brief.style.tone || "—"}`,
    `- Register: ${brief.style.register || "—"}`,
    ...(brief.style.notes.length > 0
      ? brief.style.notes.map((note) => `- Note: ${note}`)
      : []),
  ];
  const characterLines =
    brief.characters.length > 0
      ? brief.characters.map((entry) => {
          const aliases = entry.aliases.length
            ? ` (aliases: ${entry.aliases.join(", ")})`
            : "";
          const notes = entry.notes ? ` — ${entry.notes}` : "";
          return `- ${entry.sourceName} → ${entry.preferredTranslation}${aliases}${notes}`;
        })
      : ["- No character entries identified."];
  const glossaryLines =
    brief.glossary.length > 0
      ? brief.glossary.map((entry) => {
          const aliases = entry.aliases.length
            ? ` (aliases: ${entry.aliases.join(", ")})`
            : "";
          const notes = entry.notes ? ` — ${entry.notes}` : "";
          return `- ${entry.source} → ${entry.preferredTranslation}${aliases}${notes}`;
        })
      : ["- No glossary entries identified."];

  return [
    "## Summary",
    "",
    brief.summary || "—",
    "",
    "## Style",
    "",
    ...styleLines,
    "",
    "## Characters",
    "",
    ...characterLines,
    "",
    "## Glossary",
    "",
    ...glossaryLines,
  ].join("\n");
}

export const formatBriefAsMarkdown = formatTranslationBrief;
