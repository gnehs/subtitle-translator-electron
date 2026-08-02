import fs from "node:fs";
import path from "node:path";
import { parseSync, stringifySync, type NodeList } from "subtitle";
import assParser from "ass-parser";
import assStringify from "ass-stringify";
import { generateText, Output, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { translationErrorCodes } from "../../shared/translation-error-codes.ts";
import type { RequestRateLimiter } from "./request-rate-limiter.ts";
import { compactRepetitiveSubtitleText } from "./subtitle-chunks.ts";
import { sampleSubtitlesForAnalysis } from "./subtitle-sampling.ts";
import type { TranslationSourceFingerprint } from "./translation-checkpoint.ts";
import {
  formatSubtitleAnalysis,
  subtitleAnalysisSchema,
} from "./analysis-output.ts";
import {
  createTranslationOutputValidationError,
  createTranslationRepairPrompt,
  isCompletedModelFinishReason,
  parseTranslationOutput,
  TranslationOutputRepetitionGuard,
  validateTranslationOutputForCore,
} from "./translation-output.ts";
import {
  addAssBilingualStyles,
  formatAssBilingualStyledText,
  type AssBilingualFontOptions,
} from "./ass-bilingual.ts";
import {
  assTextToPlainText,
  createDefaultAssSections,
  formatSrtOutputText,
  subtitleTimestampToMilliseconds,
  type SubtitleOutputFormat,
} from "./subtitle-output.ts";
import type {
  StageUsage,
  TranslationUsageSummary,
} from "./adaptive/types.ts";

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
  value?: Record<string, string> | string | string[];
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
  /** Optional request-level usage records persisted only in v2 checkpoints. */
  usage?: StageUsage[];
  /** Optional aggregate usage persisted only in v2 checkpoints. */
  usageSummary?: TranslationUsageSummary;
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

const translationUsageStages = new Set<StageUsage["stage"]>([
  "brief",
  "strict-translate",
  "adaptive-translate",
  "adaptive-repair",
  "strict-fallback",
]);

const stageUsageKeys = new Set([
  "stage",
  "model",
  "sceneId",
  "requestAttempt",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
  "durationMs",
  "finishReason",
]);

const usageSummaryKeys = new Set([
  "requestCount",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
  "byStage",
]);

const stageUsageSummaryKeys = new Set([
  "requestCount",
  "inputTokens",
  "outputTokens",
  "totalTokens",
]);

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function isOptionalNonNegativeSafeInteger(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === undefined || isNonNegativeSafeInteger(record[key]);
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>
): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isStageUsage(value: unknown): value is StageUsage {
  if (!isRecord(value) || Array.isArray(value)) return false;
  if (!hasOnlyKeys(value, stageUsageKeys)) return false;
  if (
    !translationUsageStages.has(value.stage as StageUsage["stage"]) ||
    typeof value.model !== "string" ||
    value.model.trim().length === 0 ||
    !isPositiveSafeInteger(value.requestAttempt) ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    (value.sceneId !== undefined && typeof value.sceneId !== "string") ||
    (value.finishReason !== undefined && typeof value.finishReason !== "string")
  ) {
    return false;
  }

  return (
    isOptionalNonNegativeSafeInteger(value, "inputTokens") &&
    isOptionalNonNegativeSafeInteger(value, "outputTokens") &&
    isOptionalNonNegativeSafeInteger(value, "totalTokens") &&
    isOptionalNonNegativeSafeInteger(value, "reasoningTokens") &&
    isOptionalNonNegativeSafeInteger(value, "cachedInputTokens")
  );
}

function isStageUsageSummary(value: unknown): boolean {
  if (!isRecord(value) || Array.isArray(value)) return false;
  if (!hasOnlyKeys(value, stageUsageSummaryKeys)) return false;
  return (
    isNonNegativeSafeInteger(value.requestCount) &&
    isOptionalNonNegativeSafeInteger(value, "inputTokens") &&
    isOptionalNonNegativeSafeInteger(value, "outputTokens") &&
    isOptionalNonNegativeSafeInteger(value, "totalTokens")
  );
}

function isTranslationUsageSummary(value: unknown): value is TranslationUsageSummary {
  if (!isRecord(value) || Array.isArray(value)) return false;
  if (!hasOnlyKeys(value, usageSummaryKeys)) return false;
  if (
    !isNonNegativeSafeInteger(value.requestCount) ||
    !isOptionalNonNegativeSafeInteger(value, "inputTokens") ||
    !isOptionalNonNegativeSafeInteger(value, "outputTokens") ||
    !isOptionalNonNegativeSafeInteger(value, "totalTokens") ||
    !isOptionalNonNegativeSafeInteger(value, "reasoningTokens") ||
    !isOptionalNonNegativeSafeInteger(value, "cachedInputTokens") ||
    !isRecord(value.byStage) ||
    Array.isArray(value.byStage)
  ) {
    return false;
  }

  return Object.entries(value.byStage).every(
    ([stage, summary]) =>
      translationUsageStages.has(stage as StageUsage["stage"]) &&
      isStageUsageSummary(summary)
  );
}

export function createTranslationCacheDocument({
  subtitle,
  sourceName,
  format,
  configFingerprint,
  analysis,
  sourceFingerprint,
  usage,
  usageSummary,
}: {
  subtitle: ParsedSubtitle;
  sourceName: string;
  format: SubtitleFileExtension;
  configFingerprint: string;
  analysis?: string;
  sourceFingerprint?: TranslationSourceFingerprint;
  usage?: StageUsage[];
  usageSummary?: TranslationUsageSummary;
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
    ...(usage !== undefined ? { usage } : {}),
    ...(usageSummary !== undefined ? { usageSummary } : {}),
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
    (value.analysis !== undefined && typeof value.analysis !== "string") ||
    (value.version === 1 &&
      (value.usage !== undefined || value.usageSummary !== undefined)) ||
    (value.version === 2 &&
      ((value.usage !== undefined &&
        (!Array.isArray(value.usage) || !value.usage.every(isStageUsage))) ||
        (value.usageSummary !== undefined &&
          !isTranslationUsageSummary(value.usageSummary))))
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

type UsageCallback = (usage: StageUsage) => void | Promise<void>;

interface NormalizedModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

function readUsageNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstUsageNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = readUsageNumber(value);
    if (numberValue !== undefined) return numberValue;
  }
  return undefined;
}

function normalizeModelUsage(value: unknown): NormalizedModelUsage {
  if (!isRecord(value)) return {};

  const inputTokenDetails = isRecord(value.inputTokenDetails)
    ? value.inputTokenDetails
    : undefined;
  const outputTokenDetails = isRecord(value.outputTokenDetails)
    ? value.outputTokenDetails
    : undefined;

  const normalized: NormalizedModelUsage = {};
  const inputTokens = firstUsageNumber(value.inputTokens, value.promptTokens);
  const outputTokens = firstUsageNumber(
    value.outputTokens,
    value.completionTokens
  );
  const totalTokens = firstUsageNumber(value.totalTokens);
  const reasoningTokens = firstUsageNumber(
    outputTokenDetails?.reasoningTokens,
    value.reasoningTokens
  );
  const cachedInputTokens = firstUsageNumber(
    inputTokenDetails?.cacheReadTokens,
    inputTokenDetails?.cachedInputTokens,
    value.cachedInputTokens,
    value.cacheReadTokens
  );

  if (inputTokens !== undefined) normalized.inputTokens = inputTokens;
  if (outputTokens !== undefined) normalized.outputTokens = outputTokens;
  if (totalTokens !== undefined) normalized.totalTokens = totalTokens;
  if (reasoningTokens !== undefined) {
    normalized.reasoningTokens = reasoningTokens;
  }
  if (cachedInputTokens !== undefined) {
    normalized.cachedInputTokens = cachedInputTokens;
  }

  return normalized;
}

function emitUsage(
  onUsage: UsageCallback | undefined,
  {
    model,
    stage,
    requestAttempt,
    startedAt,
    usage,
    finishReason,
  }: {
    model: string;
    stage: StageUsage["stage"];
    requestAttempt: number;
    startedAt: number;
    usage?: unknown;
    finishReason?: unknown;
  }
): void {
  if (!onUsage) return;

  const normalizedUsage = normalizeModelUsage(usage);
  const stageUsage: StageUsage = {
    stage,
    model,
    requestAttempt,
    ...normalizedUsage,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(typeof finishReason === "string" ? { finishReason } : {}),
  };

  try {
    const callbackResult = onUsage(stageUsage);
    if (
      callbackResult &&
      typeof callbackResult === "object" &&
      "then" in callbackResult &&
      typeof callbackResult.then === "function"
    ) {
      void Promise.resolve(callbackResult).catch(() => {
        // Usage reporting is observational and must not alter translation.
        console.warn("Translation usage callback failed.");
      });
    }
  } catch {
    // Usage reporting is observational and must not alter translation.
    console.warn("Translation usage callback failed.");
  }
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
    onUsage,
    requestAttemptOffset = 0,
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
    onUsage?: UsageCallback;
    requestAttemptOffset?: number;
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

  const repetitionController = new AbortController();
  const requestAbortSignal = abortSignal
    ? AbortSignal.any([abortSignal, repetitionController.signal])
    : repetitionController.signal;

  const translationOutput = Output.json();
  let requestAttempt = 0;

  const runTranslationRequest = async (requestPrompt: string) => {
    await requestRateLimiter?.waitForSlot(abortSignal);
    const currentRequestAttempt = requestAttemptOffset + ++requestAttempt;
    const requestStartedAt = Date.now();
    const repetitionGuards = new Map<
      string,
      TranslationOutputRepetitionGuard
    >();
    let stoppedForRepetition = false;

    let finishReason: unknown;
    let usage: unknown;
    try {
      const result = streamText({
        model: ai(model),
        temperature,
        system: systemPrompt,
        output: translationOutput,
        prompt: requestPrompt,
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

      const resultFinishReason = await result.finishReason;
      finishReason =
        typeof resultFinishReason === "string" ? resultFinishReason : undefined;
      usage = await result.usage;
      if (!isCompletedModelFinishReason(resultFinishReason)) {
        throw new Error(translationErrorCodes.incompleteModelOutput);
      }
      return parseTranslationOutput(await result.output);
    } catch (error) {
      if (stoppedForRepetition && !abortSignal?.aborted) {
        throw new Error(translationErrorCodes.repetitiveModelOutput);
      }
      throw error;
    } finally {
      emitUsage(onUsage, {
        model,
        stage: "strict-translate",
        requestAttempt: currentRequestAttempt,
        startedAt: requestStartedAt,
        usage,
        finishReason,
      });
    }
  };

  const initialPrompt =
    `Translate only the \`core\` subtitles. Use \`before\` and \`after\` only as context. ` +
    `Return a JSON object with one \`elements\` array containing exactly ${core.length} translated strings ` +
    `in the same order as \`core\`, with no other properties.\n` +
    `This is a one-to-one mapping: \`elements[0]\` translates \`core[0]\`, \`elements[1]\` translates \`core[1]\`, and so on. ` +
    `Do not add, remove, split, merge, summarize, explain, or renumber subtitles.\n\n` +
    `A bracketed note such as [source phrase repeats N times total] is input metadata, not subtitle text. ` +
    `Interpret repeated source phrases naturally and never output the bracketed note.\n\n` +
    JSON.stringify({
      before: compactedBefore,
      core: compactedCore,
      after: compactedAfter,
    });

  const output = await runTranslationRequest(initialPrompt);
  const validationError = createTranslationOutputValidationError(
    output,
    compactedCore
  );

  if (validationError) {
    const repairedOutput = await runTranslationRequest(
      createTranslationRepairPrompt({
        before: compactedBefore,
        core: compactedCore,
        after: compactedAfter,
        invalidOutput: output,
        validationError: validationError.message,
      })
    );
    validateTranslationOutputForCore(repairedOutput, compactedCore);
    return repairedOutput;
  }

  validateTranslationOutputForCore(output, compactedCore);
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
          !Array.isArray(line.value) &&
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

function createAssSubtitleFromCues(events: SubtitleCue[]): AssSubtitle {
  return {
    events,
    full: createDefaultAssSections(events) as AssSection[],
  };
}

function saveTranslated(
  outputPath: string,
  parsedSubtitle: ParsedSubtitle,
  outputFormat: SubtitleOutputFormat,
  assFonts: AssBilingualFontOptions = {}
): void {
  let newSubtitle = "";
  if (
    outputFormat === "srt-translation" ||
    outputFormat === "srt-bilingual" ||
    outputFormat === "srt-original-translation"
  ) {
    const sourceIsAss = !Array.isArray(parsedSubtitle);
    const translatedNodes = getSubtitleCues(parsedSubtitle).map((node) => {
      const originalText = sourceIsAss
        ? assTextToPlainText(node.data.text)
        : node.data.text;
      const translatedText = sourceIsAss
        ? assTextToPlainText(node.data.translatedText ?? node.data.text)
        : node.data.translatedText ?? node.data.text;
      return {
        type: node.type,
        data: {
          start: subtitleTimestampToMilliseconds(node.data.start),
          end: subtitleTimestampToMilliseconds(node.data.end),
          text: formatSrtOutputText({
            originalText,
            translatedText,
            outputFormat,
          }),
        },
      };
    });
    newSubtitle = stringifySync(translatedNodes as NodeList, { format: "SRT" });
  } else {
    const canPreserveAssStyles =
      !Array.isArray(parsedSubtitle) &&
      parsedSubtitle.full.some(
        (section) =>
          section.section === "V4+ Styles" &&
          section.body?.some((line) => line.key === "Style")
      );
    const assSubtitle = canPreserveAssStyles
      ? (parsedSubtitle as AssSubtitle)
      : createAssSubtitleFromCues(getSubtitleCues(parsedSubtitle));
    const { full, stylesBySource } = addAssBilingualStyles(
      assSubtitle.full,
      assFonts
    );
    const events = assSubtitle.events;
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
                  line.value !== null &&
                  !Array.isArray(line.value)
                    ? currentEvent.data.translatedText
                    : typeof line.value === "object" &&
                        line.value !== null &&
                        !Array.isArray(line.value)
                      ? line.value.Text ?? ""
                      : "";
                const value =
                  typeof line.value === "object" &&
                  line.value !== null &&
                  !Array.isArray(line.value)
                    ? line.value
                    : {};
                const styleNames =
                  stylesBySource.get(value.Style ?? "Default") ??
                  stylesBySource.get("Default") ??
                  stylesBySource.values().next().value;
                return {
                  key: "Dialogue",
                  value: {
                    ...value,
                    Text: styleNames
                      ? formatAssBilingualStyledText({
                          originalText: value.Text ?? "",
                          translatedText,
                          order:
                            outputFormat === "ass-original-translation"
                              ? "original+translate"
                              : "translate+original",
                          translationStyle: styleNames.translation,
                          originalStyle: styleNames.original,
                        })
                      : translatedText,
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
    onUsage,
    requestAttemptOffset = 0,
  }: {
    apiKeys: string[];
    apiHost: string;
    model: string;
    lang: string;
    temperature?: number;
    requestRateLimiter?: RequestRateLimiter;
    abortSignal?: AbortSignal;
    onUsage?: UsageCallback;
    requestAttemptOffset?: number;
  }
): Promise<string> {
  const sampledSubtitles = sampleSubtitlesForAnalysis(subtitles);
  if (sampledSubtitles.length === 0) return "";

  const ai = getAi({ apiKey: getFirstValidApiKey(apiKeys), apiHost });

  await requestRateLimiter?.waitForSlot(abortSignal);
  const requestStartedAt = Date.now();
  let finishReason: unknown;
  let usage: unknown;
  try {
    const result = await generateText({
      model: ai(model),
      temperature,
      output: Output.json(),
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

    finishReason = result.finishReason;
    usage = result.usage;
    if (!isCompletedModelFinishReason(result.finishReason)) {
      throw new Error(translationErrorCodes.incompleteModelOutput);
    }

    return formatSubtitleAnalysis(subtitleAnalysisSchema.parse(result.output));
  } finally {
    emitUsage(onUsage, {
      model,
      stage: "brief",
      requestAttempt: requestAttemptOffset + 1,
      startedAt: requestStartedAt,
      usage,
      finishReason,
    });
  }
}

export {
  translateSubtitleChunk,
  parseSubtitle,
  saveTranslated,
  analyzeSubtitlesForContext,
};
