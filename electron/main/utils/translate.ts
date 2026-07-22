import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync, type NodeList } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { z } from "zod";
import { generateText, Output, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { translationErrorCodes } from "../../shared/translation-error-codes";
import type { RequestRateLimiter } from "./request-rate-limiter";
import { compactRepetitiveSubtitleText } from "./subtitle-chunks";
import { sampleSubtitlesForAnalysis } from "./subtitle-sampling";
import type { TranslationSourceFingerprint } from "./translation-checkpoint";
import {
  formatSubtitleAnalysis,
  subtitleAnalysisSchema,
} from "./analysis-output";
import {
  isCompletedModelFinishReason,
  TranslationOutputRepetitionGuard,
} from "./translation-output";

export interface SubtitleCueData {
  text: string;
  start: number | string;
  end: number | string;
  translatedText?: string;
}

export interface SubtitleCue {
  type: "cue";
  data: SubtitleCueData;
}

export type SubtitleFileExtension = "ass" | "ssa" | "srt" | "vtt";

interface SubtitleHeader {
  type: "header";
  data: string;
}

interface AssDescriptor {
  key?: string;
  type?: string;
  value?: Record<string, string> | string;
  [key: string]: unknown;
}

interface AssSection {
  section?: string;
  body?: AssDescriptor[];
  [key: string]: unknown;
}

export interface AssSubtitle {
  full: AssSection[];
  events: SubtitleCue[];
}

export type ParsedSubtitle = Array<SubtitleCue | SubtitleHeader> | AssSubtitle;
export type MultiLanguageSave =
  | "none"
  | "translate+original"
  | "original+translate";

export interface SubtitleTranslationChunk {
  before: string[];
  core: string[];
  after: string[];
}

export interface TranslationCacheDocument {
  version: 1 | 2;
  format: SubtitleFileExtension;
  source: {
    name: string;
    fingerprint?: TranslationSourceFingerprint;
  };
  translation?: {
    configFingerprint: string;
  };
  subtitle: ParsedSubtitle;
  analysis?: string;
}

function isCue(node: SubtitleCue | SubtitleHeader): node is SubtitleCue {
  return node.type === "cue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSubtitleFileExtension(value: unknown): value is SubtitleFileExtension {
  return value === "ass" || value === "ssa" || value === "srt" || value === "vtt";
}

function isSourceFingerprint(
  value: unknown
): value is TranslationSourceFingerprint {
  return (
    isRecord(value) &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mtimeMs === "number" &&
    Number.isFinite(value.mtimeMs) &&
    value.mtimeMs >= 0
  );
}

function isSubtitleCueData(value: unknown): value is SubtitleCueData {
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string") return false;
  if (typeof value.start !== "number" && typeof value.start !== "string") return false;
  if (typeof value.end !== "number" && typeof value.end !== "string") return false;
  return value.translatedText === undefined || typeof value.translatedText === "string";
}

function isSubtitleCueNode(value: unknown): value is SubtitleCue {
  return (
    isRecord(value) &&
    value.type === "cue" &&
    isSubtitleCueData(value.data)
  );
}

function isParsedSubtitle(value: unknown): value is ParsedSubtitle {
  if (Array.isArray(value)) {
    return value.every((node) => {
      if (isSubtitleCueNode(node)) return true;
      return (
        isRecord(node) &&
        node.type === "header" &&
        typeof node.data === "string"
      );
    });
  }

  return (
    isRecord(value) &&
    Array.isArray(value.full) &&
    value.full.every(isRecord) &&
    Array.isArray(value.events) &&
    value.events.every(isSubtitleCueNode)
  );
}

export function createTranslationCacheDocument({
  subtitle,
  sourceName,
  format,
  configFingerprint,
  analysis,
  sourceFingerprint,
}: {
  subtitle: ParsedSubtitle;
  sourceName: string;
  format: SubtitleFileExtension;
  configFingerprint: string;
  analysis?: string;
  sourceFingerprint?: TranslationSourceFingerprint;
}): TranslationCacheDocument {
  return {
    version: 2,
    format,
    source: {
      name: sourceName,
      ...(sourceFingerprint ? { fingerprint: sourceFingerprint } : {}),
    },
    translation: { configFingerprint },
    subtitle,
    ...(analysis ? { analysis } : {}),
  };
}

export function parseTranslationCache(
  content: string
): TranslationCacheDocument {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error(translationErrorCodes.invalidCheckpoint);
  }

  if (!isRecord(value)) {
    throw new Error(translationErrorCodes.invalidCheckpoint);
  }

  const source = value.source;
  if (
    (value.version !== 1 && value.version !== 2) ||
    !isSubtitleFileExtension(value.format) ||
    !isRecord(source) ||
    typeof source.name !== "string" ||
    source.name.trim().length === 0 ||
    (source.fingerprint !== undefined &&
      !isSourceFingerprint(source.fingerprint)) ||
    (value.version === 2 &&
      (!isRecord(value.translation) ||
        typeof value.translation.configFingerprint !== "string" ||
        !/^[a-f\d]{64}$/i.test(value.translation.configFingerprint))) ||
    (value.version === 1 && value.translation !== undefined) ||
    !isParsedSubtitle(value.subtitle) ||
    getSubtitleCues(value.subtitle).length === 0 ||
    (value.analysis !== undefined && typeof value.analysis !== "string")
  ) {
    throw new Error(translationErrorCodes.incompatibleCheckpoint);
  }

  return value as unknown as TranslationCacheDocument;
}

export function getSubtitleCues(parsedSubtitle: ParsedSubtitle): SubtitleCue[] {
  return Array.isArray(parsedSubtitle)
    ? parsedSubtitle.filter(isCue)
    : parsedSubtitle.events;
}

function getAi({ apiKey, apiHost }: { apiKey: string; apiHost: string }) {
  return createOpenAICompatible({
    name: "openai",
    apiKey: apiKey,
    baseURL: apiHost,
    headers: {
      // OpenRouter Headers
      "HTTP-Referer": "https://github.com/gnehs/subtitle-translator-electron",
      "X-Title": "Subtitle Translator",
    },
  });
}

function getFirstValidApiKey(apiKeys: readonly string[]): string {
  const apiKey = apiKeys
    .map((key) => key.trim())
    .find((key) => key.length > 0);
  if (!apiKey) {
    throw new Error(translationErrorCodes.noValidApiKeys);
  }
  return apiKey;
}

async function translateSubtitleChunk(
  { before, core, after }: SubtitleTranslationChunk,
  {
    apiKeys,
    apiHost,
    model,
    prompt,
    lang,
    additional,
    temperature,
    requestRateLimiter,
    abortSignal,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    prompt: string;
    lang: string;
    additional: string;
    temperature: number;
    requestRateLimiter?: RequestRateLimiter;
    abortSignal?: AbortSignal;
  }
) {
  if (core.length === 0) return [];

  const compactedBefore = before.map(compactRepetitiveSubtitleText);
  const compactedCore = core.map(compactRepetitiveSubtitleText);
  const compactedAfter = after.map(compactRepetitiveSubtitleText);

  const ai = getAi({ apiKey: getFirstValidApiKey(apiKeys), apiHost });

  const systemPrompt = prompt
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{additional}}", additional);

  await requestRateLimiter?.waitForSlot(abortSignal);
  const repetitionController = new AbortController();
  const requestAbortSignal = abortSignal
    ? AbortSignal.any([abortSignal, repetitionController.signal])
    : repetitionController.signal;
  const repetitionGuards = new Map<
    string,
    TranslationOutputRepetitionGuard
  >();
  let stoppedForRepetition = false;

  const result = streamText({
    model: ai(model),
    temperature,
    system: systemPrompt,
    output: Output.array({
      element: z.string().describe("The translated subtitle"),
      description:
        "Return one translated subtitle for each core subtitle, in the same order.",
    }),
    prompt:
      `Translate only the \`core\` subtitles. Use \`before\` and \`after\` only as context. ` +
      `Return a JSON object with one \`elements\` array containing exactly ${core.length} translated strings ` +
      `in the same order as \`core\`, with no other properties.\n\n` +
      `A bracketed note such as [source phrase repeats N times total] is input metadata, not subtitle text. ` +
      `Interpret repeated source phrases naturally and never output the bracketed note.\n\n` +
      JSON.stringify({
        before: compactedBefore,
        core: compactedCore,
        after: compactedAfter,
      }),
    maxRetries: 0,
    abortSignal: requestAbortSignal,
    onChunk({ chunk }) {
      if (
        chunk.type !== "text-delta" &&
        chunk.type !== "reasoning-delta"
      ) {
        return;
      }

      const guardKey = `${chunk.type}:${chunk.id}`;
      const guard =
        repetitionGuards.get(guardKey) ??
        new TranslationOutputRepetitionGuard();
      repetitionGuards.set(guardKey, guard);

      if (guard.push(chunk.text)) {
        stoppedForRepetition = true;
        repetitionController.abort(
          new Error(translationErrorCodes.repetitiveModelOutput)
        );
      }
    },
  });

  let output: string[];
  try {
    const finishReason = await result.finishReason;
    if (!isCompletedModelFinishReason(finishReason)) {
      throw new Error(translationErrorCodes.incompleteModelOutput);
    }
    output = await result.output;
  } catch (error) {
    if (stoppedForRepetition && !abortSignal?.aborted) {
      throw new Error(translationErrorCodes.repetitiveModelOutput);
    }
    throw error;
  }

  if (
    output.length !== core.length ||
    output.some(
      (translation, index) =>
        core[index].trim().length > 0 && translation.trim().length === 0
    )
  ) {
    throw new Error(
      `Translation output validation failed: expected ${core.length} non-empty subtitles, got ${output.length}`
    );
  }

  return output;
}

function parseSubtitle(
  fileContent: string,
  fileExtension: string
): ParsedSubtitle {
  if (["srt", "vtt"].includes(fileExtension)) {
    return parseSync(fileContent) as unknown as Array<
      SubtitleCue | SubtitleHeader
    >;
  }
  if (["ass", "ssa"].includes(fileExtension)) {
    const parsedAssSubtitle = assParser(fileContent) as AssSection[];
    const events = parsedAssSubtitle
      .find((section) => section.section === "Events")
      ?.body?.filter(
        (line) =>
          line.key === "Dialogue" &&
          typeof line.value === "object" &&
          line.value !== null &&
          typeof line.value.Text === "string"
      )
      .map((line) => {
        const value = line.value as Record<string, string>;
        return {
          type: "cue" as const,
          data: {
            text: value.Text,
            start: value.Start ?? "",
            end: value.End ?? "",
          },
        };
      }) ?? [];
    return { full: parsedAssSubtitle, events };
  }
  throw new Error(translationErrorCodes.unsupportedFileExtension);
}

function saveTranslated(
  outputPath: string,
  parsedSubtitle: ParsedSubtitle,
  fileExtension: string,
  multiLangSave: MultiLanguageSave = "none"
): void {
  function parseTranslatedText(
    originalSubtitle: string = "",
    translatedText: string = "",
    splitText: string = "\n"
  ) {
    switch (multiLangSave) {
      case "none":
        return translatedText;
      case "translate+original":
        return `${translatedText}${splitText}${originalSubtitle}`;
      case "original+translate":
        return `${originalSubtitle}${splitText}${translatedText}`;
      default:
        return translatedText;
    }
  }

  let newSubtitle = "";
  if (Array.isArray(parsedSubtitle)) {
    const format = fileExtension === "vtt" ? "WebVTT" : "SRT";
    const translatedNodes = parsedSubtitle.map((node) => {
      if (!isCue(node)) return node;
      return {
        type: node.type,
        data: {
          ...node.data,
          text: parseTranslatedText(
            node.data.text,
            node.data.translatedText ?? node.data.text
          ),
        },
      };
    });
    // SRT/WebVTT cues parsed by `subtitle` always use numeric timestamps.
    newSubtitle = stringifySync(translatedNodes as NodeList, { format });
  } else {
    const { full, events } = parsedSubtitle;
    // Use sequential alignment with Events order instead of text matching to avoid misalignment
    let dialogueIndex = 0;
    newSubtitle = assStringify(
      full.map((section) => {
        if (section.section === "Events" && section.body) {
          return {
            ...section,
            body: section.body.map((line) => {
              if (line.key === "Dialogue") {
                const currentEvent = events[dialogueIndex++];
                const translatedText =
                  currentEvent &&
                  currentEvent.data.translatedText &&
                  typeof line.value === "object" &&
                  line.value !== null
                    ? currentEvent.data.translatedText
                    : typeof line.value === "object" && line.value !== null
                      ? line.value.Text ?? ""
                      : "";
                const value =
                  typeof line.value === "object" && line.value !== null
                    ? line.value
                    : {};
                return {
                  key: "Dialogue",
                  value: {
                    ...value,
                    Text: parseTranslatedText(
                      value.Text,
                      translatedText,
                      "\\n"
                    ),
                  },
                };
              }
              return line;
            }),
          };
        }
        return section;
      })
    );
  }

  // Atomic write to avoid renderer reading partial file during concurrent updates
  const tmpPath = `${outputPath}.tmp`;
  fs.writeFileSync(tmpPath, newSubtitle, "utf8");
  try {
    fs.renameSync(tmpPath, outputPath);
  } catch {
    // Fallback for filesystems where rename might not be atomic
    fs.writeFileSync(outputPath, newSubtitle, "utf8");
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function analyzeSubtitlesForContext(
  subtitles: string[],
  {
    apiKeys,
    apiHost,
    model,
    lang,
    temperature = 0.3,
    requestRateLimiter,
    abortSignal,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    lang: string;
    temperature?: number;
    requestRateLimiter?: RequestRateLimiter;
    abortSignal?: AbortSignal;
  }
): Promise<string> {
  const sampledSubtitles = sampleSubtitlesForAnalysis(subtitles);
  if (sampledSubtitles.length === 0) return "";

  const ai = getAi({ apiKey: getFirstValidApiKey(apiKeys), apiHost });

  await requestRateLimiter?.waitForSlot(abortSignal);
  const result = await generateText({
    model: ai(model),
    temperature,
    output: Output.object({
      name: "SubtitleAnalysis",
      description:
        "A plot summary and glossary extracted from subtitle samples.",
      schema: subtitleAnalysisSchema,
    }),
    system: `# System Prompt

You are a subtitle content analyst assisting a translation and glossary extraction system.

## Task
Analyze subtitle samples and return one JSON object with exactly these properties:
- plotSummary: a string with the plot summary
- glossary: an array of glossary entry objects

## plotSummary
   - Language: ${lang}
   - Length: 5–10 sentences
   - Must be clear, coherent, and written in natural ${lang}
   - Avoid literal stitching of subtitles

## glossary
   - Up to 20 items
   - Include rare words, character names, places, organizations, fictional elements, or jargon
   - Every entry must include term, description, category, preferredTranslation, and notes
   - category must be person, place, organization, jargon, fictional, other, or null
   - Use null for category, preferredTranslation, or notes when not applicable
   - Do not invent glossary entries merely to make the array non-empty.`,
    prompt:
      `Produce a plot summary in ${lang} and a glossary from this sample:\n` +
      sampledSubtitles.join("\n"),
    maxRetries: 0,
    abortSignal,
  });

  if (!isCompletedModelFinishReason(result.finishReason)) {
    throw new Error(translationErrorCodes.incompleteModelOutput);
  }

  return formatSubtitleAnalysis(result.output);
}

export {
  translateSubtitleChunk,
  parseSubtitle,
  saveTranslated,
  analyzeSubtitlesForContext,
};
