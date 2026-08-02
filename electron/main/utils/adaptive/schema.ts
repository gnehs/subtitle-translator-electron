import { z } from "zod";
import type {
  AdaptiveDraftBlock,
  AdaptiveSceneDraft,
  TranslationBrief,
} from "./types.ts";

/**
 * Keep the model contract deliberately small. `z.strictObject` is used instead
 * of silently stripping unknown fields so structural errors can trigger the
 * bounded repair path.
 */
export const adaptiveDraftBlockSchema = z.strictObject({
  take: z.number().int().min(1).max(4),
  targets: z.array(z.string().trim().min(1).max(1000)).min(1).max(3),
});

export const adaptiveSceneDraftSchema = z.strictObject({
  blocks: z.array(adaptiveDraftBlockSchema).min(1).max(32),
});

export const translationBriefStyleSchema = z.strictObject({
  tone: z.string().trim().max(200),
  register: z.string().trim().max(200),
  notes: z.array(z.string().trim().max(200)).max(8),
});

export const translationBriefCharacterSchema = z.strictObject({
  sourceName: z.string().trim().min(1).max(100),
  preferredTranslation: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(8),
  notes: z.string().trim().max(300).nullable(),
});

export const translationBriefGlossaryEntrySchema = z.strictObject({
  source: z.string().trim().min(1).max(150),
  preferredTranslation: z.string().trim().min(1).max(150),
  aliases: z.array(z.string().trim().min(1).max(150)).max(8),
  notes: z.string().trim().max(300).nullable(),
});

export const translationBriefSchema = z.strictObject({
  summary: z.string().trim().max(1200),
  style: translationBriefStyleSchema,
  characters: z.array(translationBriefCharacterSchema).max(20),
  glossary: z.array(translationBriefGlossaryEntrySchema).max(30),
});

// Descriptive aliases keep adapters readable while retaining one canonical
// schema instance for the structured model contract.
export const adaptiveDraftSchema = adaptiveSceneDraftSchema;
export const briefSchema = translationBriefSchema;

export type ParsedAdaptiveDraft = z.infer<typeof adaptiveSceneDraftSchema>;
export type ParsedAdaptiveDraftBlock = z.infer<typeof adaptiveDraftBlockSchema>;
export type ParsedTranslationBrief = z.infer<typeof translationBriefSchema>;

/** Parse and narrow unknown model output to the adaptive draft contract. */
export function parseAdaptiveSceneDraft(value: unknown): AdaptiveSceneDraft {
  return adaptiveSceneDraftSchema.parse(value) as AdaptiveSceneDraft;
}

export function parseTranslationBrief(value: unknown): TranslationBrief {
  return translationBriefSchema.parse(value) as TranslationBrief;
}

export function safeParseAdaptiveSceneDraft(value: unknown) {
  return adaptiveSceneDraftSchema.safeParse(value);
}

export function safeParseTranslationBrief(value: unknown) {
  return translationBriefSchema.safeParse(value);
}

/**
 * A small helper for callers that construct drafts programmatically. It keeps
 * the output type explicit without bypassing runtime validation.
 */
export function validateAdaptiveDraftBlock(
  value: unknown
): AdaptiveDraftBlock {
  return adaptiveDraftBlockSchema.parse(value) as AdaptiveDraftBlock;
}
