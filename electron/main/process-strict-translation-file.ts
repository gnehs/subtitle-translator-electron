import fs from "node:fs";
import { randomUUID } from "node:crypto";

import pool from "tiny-async-pool";

import type {
  BatchProgress,
  BatchTranslationRequest,
  StageUsage,
} from "../../src/types/electron-api";
import {
  analyzeSubtitlesForContext,
  createTranslationCacheDocument,
  getSubtitleCues,
  saveTranslated,
  translateSubtitleChunk,
  type ParsedSubtitle,
  type SubtitleCue,
  type SubtitleFileExtension,
  type TranslationCacheDocument,
} from "./utils/translate";
import { createSubtitlePreview } from "./utils/subtitle-preview";
import { RequestRateLimiter } from "./utils/request-rate-limiter";
import {
  type TranslationSourceFingerprint,
} from "./utils/translation-checkpoint";
import {
  isSubtitleCueComplete,
  splitIntoChunk,
} from "./utils/subtitle-chunks";
import { shouldAnalyzeSubtitles } from "./utils/subtitle-sampling";
import { createUsageSummary } from "./utils/adaptive/usage";

const MIN_CUES_FOR_CONTEXT_ANALYSIS = 40;
const DEFAULT_CONTEXT_SIZE = 5;

/**
 * Parsed source/checkpoint data needed by the Strict file processor.
 *
 * The main process still owns input validation and checkpoint source matching;
 * this shape keeps the file workflow independent from the IPC handler while
 * preserving the existing resume data and checkpoint metadata.
 */
export interface StrictTranslationInput {
  parsed: ParsedSubtitle;
  sourceName: string;
  sourceExtension: SubtitleFileExtension;
  analysis?: string;
  cacheDocument?: TranslationCacheDocument;
  sourceFingerprint?: TranslationSourceFingerprint;
  checkpointPath: string;
  shouldBackupCheckpoint: boolean;
}

export interface StrictTranslationFileInput {
  file: BatchTranslationRequest["files"][number];
  params: BatchTranslationRequest["params"];
  abortSignal: AbortSignal;
  requestRateLimiter: RequestRateLimiter;
  translationConfigFingerprint: string;
  input: StrictTranslationInput;
  outputPath: string;
  usageRecords: StageUsage[];
  analysisCache: Map<string, string>;
  retryRequest?: <T>(
    fn: () => Promise<T>,
    delay: number,
    abortSignal: AbortSignal
  ) => Promise<T>;
  sendProgress: (progress: BatchProgress) => void;
}

function createCheckpointWriter(
  checkpointPath: string,
  createDocument: () => TranslationCacheDocument
): { write: () => Promise<void>; wait: () => Promise<void> } {
  let pending = Promise.resolve();

  const write = () => {
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
        const content = `${JSON.stringify(createDocument(), null, 2)}\n`;
        await fs.promises.writeFile(temporaryPath, content, "utf8");
        try {
          await fs.promises.rename(temporaryPath, checkpointPath);
        } catch {
          await fs.promises.writeFile(checkpointPath, content, "utf8");
          await fs.promises.unlink(temporaryPath).catch(() => undefined);
        }
      });

    return pending;
  };

  return {
    write,
    wait: () => pending,
  };
}

async function backupTranslationCheckpoint(
  checkpointPath: string
): Promise<string> {
  const backupPath = `${checkpointPath}.${Date.now()}.${randomUUID()}.backup.json`;
  await fs.promises.rename(checkpointPath, backupPath);
  return backupPath;
}

async function removeTranslationCheckpoint(checkpointPath: string): Promise<void> {
  try {
    await fs.promises.unlink(checkpointPath);
  } catch (error: unknown) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (errorCode !== "ENOENT") {
      console.warn("Failed to remove translation checkpoint:", error);
    }
  }
}

/**
 * Execute one Strict translation file. The IPC handler remains responsible for
 * sender validation, request-level concurrency, path claims, and error
 * reporting; this function owns the per-file translation/checkpoint workflow.
 */
export async function processStrictTranslationFile(
  input: StrictTranslationFileInput
): Promise<void> {
  const {
    file,
    params,
    abortSignal,
    requestRateLimiter,
    translationConfigFingerprint,
    input: translationInput,
    outputPath,
    usageRecords,
    analysisCache,
  } = input;
  const sendStrictProgress = (progress: BatchProgress): void => {
    input.sendProgress({
      ...progress,
      mode: "strict",
      usageSummary: createUsageSummary(usageRecords),
    });
  };
  const retryRequest =
    input.retryRequest ??
    (async <T>(fn: () => Promise<T>): Promise<T> => fn());

  abortSignal.throwIfAborted();

  const parsed = translationInput.parsed;
  const subtitle = getSubtitleCues(parsed);
  const totalCues = subtitle.length;
  let completedCues = subtitle.filter(isSubtitleCueComplete).length;

  // 建立原始索引對照，供後續「上下文視窗」策略使用
  const indexMap = new Map<SubtitleCue, number>();
  subtitle.forEach((cue, idx) => indexMap.set(cue, idx));

  let analysisData = translationInput.analysis;
  analysisCache.delete(file.path);
  const checkpointPath = translationInput.checkpointPath;
  if (translationInput.shouldBackupCheckpoint) {
    abortSignal.throwIfAborted();
    const backupPath = await backupTranslationCheckpoint(checkpointPath);
    console.warn(
      `Preserved an incompatible translation checkpoint at: ${backupPath}`
    );
  }
  const checkpointWriter = createCheckpointWriter(
    checkpointPath,
    () =>
      createTranslationCacheDocument({
        subtitle: parsed,
        sourceName: translationInput.sourceName,
        format: translationInput.sourceExtension,
        configFingerprint: translationConfigFingerprint,
        analysis: analysisData,
        sourceFingerprint: translationInput.sourceFingerprint,
        usage: usageRecords,
        usageSummary: createUsageSummary(usageRecords),
      })
  );
  const persistCheckpoint = async () => {
    try {
      await checkpointWriter.write();
    } catch (error: unknown) {
      console.warn("Failed to write translation checkpoint:", error);
    }
  };

  await persistCheckpoint();
  abortSignal.throwIfAborted();

  const chunks = splitIntoChunk(subtitle, 20);
  if (chunks.length === 0) {
    abortSignal.throwIfAborted();
    saveTranslated(
      outputPath,
      parsed,
      params.outputFormat,
      params.assFonts
    );
    await checkpointWriter.wait().catch((error: unknown) => {
      console.warn("Failed to finish translation checkpoint:", error);
    });
    sendStrictProgress({
      filePath: file.path,
      progress: 100,
      status: "done",
      totalCues,
      currentCue: totalCues,
      analysis: analysisData,
      outputPath,
      previewCues: createSubtitlePreview(subtitle, subtitle),
    });
    await removeTranslationCheckpoint(checkpointPath);
    return;
  }

  // Build analysis context (plot summary + glossary) and attach to all requests
  const allTexts = subtitle
    .map((cue) => cue.data.text)
    .filter((t: string) => t && t.length > 0);

  const shouldAnalyze = shouldAnalyzeSubtitles(
    analysisData,
    allTexts.length,
    MIN_CUES_FOR_CONTEXT_ANALYSIS
  );
  if (shouldAnalyze) {
    abortSignal.throwIfAborted();
    sendStrictProgress({
      filePath: file.path,
      progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
      status: "analyzing",
      totalCues,
      currentCue: completedCues,
      analysis: null,
      outputPath,
    });
  }

  let combinedAdditional = params.additional || "";
  if (analysisData) {
    combinedAdditional = `${
      combinedAdditional ? combinedAdditional + "\n\n" : ""
    }[Context]\n${analysisData}`;
    analysisCache.set(file.path, analysisData);
  } else if (shouldAnalyze) {
    try {
      let analysisRequestAttemptOffset = 0;
      const analysis = await retryRequest(
        () =>
          analyzeSubtitlesForContext(allTexts, {
            apiKeys: params.apiKeys || [],
            apiHost: params.apiHost || "https://api.openai.com/v1",
            model: params.model || "",
            lang: params.lang || "",
            temperature: 0.3,
            requestRateLimiter,
            abortSignal,
            requestAttemptOffset: analysisRequestAttemptOffset,
            onUsage: (usage) => {
              usageRecords.push(usage);
              analysisRequestAttemptOffset = Math.max(
                analysisRequestAttemptOffset,
                usage.requestAttempt
              );
            },
          }),
        params.delay,
        abortSignal
      );
      if (analysis) {
        combinedAdditional = `${
          combinedAdditional ? combinedAdditional + "\n\n" : ""
        }[Context]\n${analysis}`;

        analysisData = analysis;
        analysisCache.set(file.path, analysis);
        await persistCheckpoint();
        sendStrictProgress({
          filePath: file.path,
          progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
          status: "analyzing",
          totalCues,
          currentCue: completedCues,
          analysis,
          outputPath,
        });
      }
    } catch (analysisErr) {
      abortSignal.throwIfAborted();
      console.warn(
        "Context analysis failed, continue without it:",
        analysisErr
      );
    }
  }

  abortSignal.throwIfAborted();
  sendStrictProgress({
    filePath: file.path,
    progress: totalCues > 0 ? (completedCues / totalCues) * 100 : 0,
    status: "translating",
    totalCues,
    currentCue: completedCues,
    analysis: analysisData ?? null,
    outputPath,
  });

  // Translate
  const chunkProcessor = async (block: SubtitleCue[]) => {
    abortSignal.throwIfAborted();
    // 以原始索引建立「核心段」和「上下文視窗」
    const contextSize =
      typeof params.contextSize === "number" ? params.contextSize : DEFAULT_CONTEXT_SIZE;

    const coreIndices = block
      .map((cue) => indexMap.get(cue))
      .filter((n): n is number => typeof n === "number")
      .sort((a: number, b: number) => a - b);

    if (coreIndices.length === 0) return;

    const coreStart = coreIndices[0];
    const coreEnd = coreIndices[coreIndices.length - 1];

    const contextStart = Math.max(0, coreStart - contextSize);
    const contextEnd = Math.min(subtitle.length - 1, coreEnd + contextSize);

    const normalizeCueText = (cue: SubtitleCue) =>
      cue.data.text.replaceAll(/\n/g, " ").trim();
    const translationChunk = {
      before: subtitle.slice(contextStart, coreStart).map(normalizeCueText),
      core: block.map(normalizeCueText),
      after: subtitle
        .slice(coreEnd + 1, contextEnd + 1)
        .map(normalizeCueText),
    };

    // 每個區塊最多自動嘗試三次；失敗後直接交由使用者手動重試。
    let requestAttemptOffset = 0;
    const translatedWindow = await retryRequest(
      () =>
        (async () => {
          const result = await translateSubtitleChunk(translationChunk, {
            ...params,
            apiKeys: params.apiKeys || [],
            apiHost: params.apiHost || "https://api.openai.com/v1",
            model: params.model || "",
            prompt: params.prompt || "",
            lang: params.lang || "",
            additional: combinedAdditional || "",
            temperature:
              typeof params.temperature === "number" ? params.temperature : 1,
            requestRateLimiter,
            abortSignal,
            requestAttemptOffset,
            onUsage: (usage) => {
              usageRecords.push(usage);
              requestAttemptOffset = Math.max(
                requestAttemptOffset,
                usage.requestAttempt
              );
            },
          });

          if (!Array.isArray(result) || result.length !== block.length) {
            throw new Error(
              `Translation output validation failed: expected ${block.length} subtitles, got ${Array.isArray(result) ? result.length : "a non-array result"}`
            );
          }

          return result;
        })(),
      1000,
      abortSignal
    );

    abortSignal.throwIfAborted();
    // The model receives surrounding context but returns only the core block.
    let chunkCompleted = 0;
    for (const [index, cue] of block.entries()) {
      cue.data.translatedText = translatedWindow[index] ?? "";
      chunkCompleted++;
    }

    abortSignal.throwIfAborted();
    completedCues += chunkCompleted;
    const progress = totalCues > 0 ? (completedCues / totalCues) * 100 : 100;
    const currentCue = Math.min(completedCues, totalCues);
    sendStrictProgress({
      filePath: file.path,
      progress,
      status: "translating",
      totalCues,
      currentCue,
      analysis: analysisData ?? null,
      outputPath,
    });

    // 寫入部分成果供即時預覽
    try {
      saveTranslated(
        outputPath,
        parsed,
        params.outputFormat,
        params.assFonts
      );
    } catch (e) {
      console.warn("Failed to write partial translated file:", e);
    }

    await persistCheckpoint();
  };

  const activeChunkProcessors = new Set<Promise<void>>();
  const trackedChunkProcessor = (block: SubtitleCue[]) => {
    const processing = chunkProcessor(block).finally(() => {
      activeChunkProcessors.delete(processing);
    });
    activeChunkProcessors.add(processing);
    return processing;
  };

  try {
    for await (const _ of pool(params.concurrency, chunks, trackedChunkProcessor)) {
      // Process chunks with the configured per-file concurrency.
    }
  } catch (error: unknown) {
    await Promise.allSettled([...activeChunkProcessors]);
    await checkpointWriter.wait().catch(() => undefined);
    throw error;
  }

  // Final write
  abortSignal.throwIfAborted();
  saveTranslated(outputPath, parsed, params.outputFormat, params.assFonts);
  await checkpointWriter.wait().catch((error: unknown) => {
    console.warn("Failed to finish translation checkpoint:", error);
  });
  sendStrictProgress({
    filePath: file.path,
    progress: 100,
    status: "done",
    totalCues,
    currentCue: totalCues,
    analysis: analysisData ?? null,
    outputPath,
    previewCues: createSubtitlePreview(subtitle, subtitle),
  });
  await removeTranslationCheckpoint(checkpointPath);
  console.log(`Saved translated file to: ${outputPath}`);
}
