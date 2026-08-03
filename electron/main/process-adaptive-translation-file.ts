import fs from "node:fs";
import path from "node:path";

import type {
  BatchProgress,
  BatchTranslationRequest,
  StageUsage,
  TranslationParams,
  TranslationUsageSummary,
} from "../../src/types/electron-api.ts";
import {
  getSubtitleCues,
  parseSubtitle,
  type ParsedSubtitle,
} from "./utils/translate.ts";
import { RequestRateLimiter } from "./utils/request-rate-limiter.ts";
import { translationErrorCodes } from "../shared/translation-error-codes.ts";
import {
  backupAdaptiveCheckpoint,
  canReuseAdaptiveCheckpoint,
  createAdaptiveCheckpointWriter,
  createAdaptiveLayoutFingerprint,
  createAdaptiveSemanticFingerprint,
  getAdaptiveCheckpointResumeMetadata,
  getAdaptiveCompletedCueIndices,
  hasMatchingAdaptiveCheckpointSource,
  parseAdaptiveCheckpoint,
  stripAdaptiveTranslations,
  type AdaptiveCheckpointResumeOptions,
} from "./utils/adaptive/checkpoint.ts";
import { buildAdaptiveSourceCues } from "./utils/adaptive/source-cues.ts";
import {
  buildAdaptiveScenes,
  type AdaptiveSceneBuilderOptions,
} from "./utils/adaptive/scene-builder.ts";
import {
  createEmptyTranslationBrief,
  formatTranslationBrief,
  selectBriefForScene,
} from "./utils/adaptive/brief.ts";
import {
  generateTranslationBrief,
  type TranslationBriefResult,
} from "./utils/adaptive/brief-client.ts";
import {
  createAiSdkAdaptiveModelClient,
  type AdaptiveCallResult,
  type AdaptiveModelClient,
  type AdaptiveRepairInput,
  type AdaptiveTranslateInput,
} from "./utils/adaptive/model-client.ts";
import {
  processAdaptiveScenes,
  type AdaptivePipelineProgress,
} from "./utils/adaptive/pipeline.ts";
import { translateAdaptiveScene } from "./utils/adaptive/translator.ts";
import {
  renderAdaptiveSrt,
  type RenderAdaptiveSrtResult,
} from "./utils/adaptive/renderer.ts";
import { renderAdaptiveAss } from "./utils/adaptive/ass-renderer.ts";
import {
  defaultAdaptiveLayoutOptions,
  type AdaptiveCheckpointScene,
  type AdaptiveLayoutOptions,
  type AdaptiveScene,
  type AdaptiveSourceCue,
  type AdaptiveSubtitleViolation,
  type AdaptiveTranslationCheckpointV3,
} from "./utils/adaptive/types.ts";
import {
  createUsageSummary,
} from "./utils/adaptive/usage.ts";

type AdaptiveParams = TranslationParams & {
  adaptivePrompt?: string;
  adaptiveLayoutOptions?: Partial<AdaptiveLayoutOptions>;
};

export interface AdaptiveTranslationFileInput {
  file: BatchTranslationRequest["files"][number];
  params: AdaptiveParams;
  abortSignal: AbortSignal;
  requestRateLimiter: RequestRateLimiter;
  outputPath: string;
  checkpointPath: string;
  sourceName: string;
  sourceExtension: "srt" | "vtt";
  sourceFingerprint?: { size: number; mtimeMs: number };
  retryRequest?: <T>(
    fn: () => Promise<T>,
    delay: number,
    abortSignal: AbortSignal
  ) => Promise<T>;
  sendProgress: (progress: BatchProgress) => void;
  modelClient?: AdaptiveModelClient;
  generateBrief?: (
    subtitles: readonly string[]
  ) => Promise<TranslationBriefResult>;
}

interface AdaptiveSourceDocument {
  parsed: ParsedSubtitle;
  sourceName: string;
  sourceExtension: "srt" | "vtt";
  sourceFingerprint?: { size: number; mtimeMs: number };
  checkpoint?: AdaptiveTranslationCheckpointV3;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
  }
}

function readSourceDocument(input: AdaptiveTranslationFileInput): AdaptiveSourceDocument {
  const extension = path.extname(input.file.path).slice(1).toLowerCase();
  if (extension === "json") {
    const checkpoint = parseAdaptiveCheckpoint(
      fs.readFileSync(input.file.path, "utf8")
    );
    if (checkpoint.format !== input.sourceExtension) {
      throw new Error(translationErrorCodes.adaptiveIncompatibleCheckpoint);
    }
    return {
      parsed: stripAdaptiveTranslations(checkpoint.subtitle),
      sourceName: path.basename(checkpoint.source.name),
      sourceExtension: checkpoint.format,
      sourceFingerprint: checkpoint.source.fingerprint,
      checkpoint,
    };
  }

  const content = fs.readFileSync(input.file.path, "utf8");
  const parsed = stripAdaptiveTranslations(
    parseSubtitle(content, input.sourceExtension)
  );
  return {
    parsed,
    sourceName: input.sourceName,
    sourceExtension: input.sourceExtension,
    sourceFingerprint: input.sourceFingerprint,
  };
}

function readSidecarCheckpoint(
  checkpointPath: string,
  sourceName: string,
  sourceExtension: "srt" | "vtt",
  sourceFingerprint: { size: number; mtimeMs: number } | undefined
): {
  checkpoint?: AdaptiveTranslationCheckpointV3;
  shouldBackupLegacy: boolean;
} {
  if (!fs.existsSync(checkpointPath)) return { shouldBackupLegacy: false };
  let checkpoint: AdaptiveTranslationCheckpointV3;
  try {
    checkpoint = parseAdaptiveCheckpoint(
      fs.readFileSync(checkpointPath, "utf8")
    );
  } catch {
    try {
      const raw = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
        version?: unknown;
        kind?: unknown;
      };
      if (raw?.version === 3 || raw?.kind === "adaptive") {
        throw new Error(translationErrorCodes.adaptiveInvalidCheckpoint);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === translationErrorCodes.adaptiveInvalidCheckpoint
      ) {
        throw error;
      }
      // Non-JSON or a malformed legacy sidecar is preserved before v3 starts.
    }
    // A v1/v2 Strict checkpoint may share the sidecar name. It is not an
    // Adaptive checkpoint and is backed up before creating the v3 project.
    return { shouldBackupLegacy: true };
  }
  if (
    !sourceFingerprint ||
    !hasMatchingAdaptiveCheckpointSource(
      checkpoint,
      sourceName,
      sourceExtension,
      sourceFingerprint
    )
  ) {
    throw new Error(translationErrorCodes.adaptiveIncompatibleCheckpoint);
  }
  return { checkpoint, shouldBackupLegacy: false };
}

function getCueSourceText(cue: AdaptiveSourceCue): string {
  return cue.plainText || cue.originalText;
}

function countCoveredSourceCues(
  scenes: readonly AdaptiveCheckpointScene[]
): number {
  const ids = new Set<number>();
  for (const scene of scenes) {
    if (scene.status !== "done") continue;
    for (const block of scene.blocks) {
      for (const id of block.sourceCueIds) ids.add(id);
    }
  }
  return ids.size;
}

function toUsageSummary(
  usages: readonly StageUsage[]
): TranslationUsageSummary {
  return createUsageSummary(usages) as TranslationUsageSummary;
}

function createInitialCheckpoint({
  source,
  sourceName,
  sourceExtension,
  sourceFingerprint,
  scenes,
  semanticFingerprint,
  layoutFingerprint,
}: {
  source: ParsedSubtitle;
  sourceName: string;
  sourceExtension: "srt" | "vtt";
  sourceFingerprint?: { size: number; mtimeMs: number };
  scenes: readonly AdaptiveScene[];
  semanticFingerprint: string;
  layoutFingerprint: string;
}): AdaptiveTranslationCheckpointV3 {
  const checkpointScenes: AdaptiveCheckpointScene[] = scenes.map((scene) => ({
    id: scene.id,
    sourceStart: scene.sourceStart,
    sourceEnd: scene.sourceEnd,
    status: "pending",
    blocks: [],
    violations: [],
  }));
  const usage: StageUsage[] = [];
  return {
    version: 3,
    kind: "adaptive",
    state: "in-progress",
    format: sourceExtension,
    source: {
      name: sourceName,
      ...(sourceFingerprint ? { fingerprint: sourceFingerprint } : {}),
    },
    translation: {
      mode: "adaptive",
      pipelineVersion: 1,
      semanticFingerprint,
      layoutFingerprint,
    },
    subtitle: stripAdaptiveTranslations(source),
    scenes: checkpointScenes,
    usage,
    usageSummary: toUsageSummary(usage),
  };
}

function updateCheckpointScenes(
  checkpoint: AdaptiveTranslationCheckpointV3,
  scenes: readonly AdaptiveScene[]
): void {
  const known = new Set(checkpoint.scenes.map((scene) => scene.id));
  for (const scene of scenes) {
    if (known.has(scene.id)) continue;
    checkpoint.scenes.push({
      id: scene.id,
      sourceStart: scene.sourceStart,
      sourceEnd: scene.sourceEnd,
      status: "pending",
      blocks: [],
      violations: [],
    });
  }
}

function getLayoutOptions(params: AdaptiveParams): AdaptiveLayoutOptions {
  return {
    ...defaultAdaptiveLayoutOptions,
    ...(params.adaptiveLayoutOptions ?? {}),
  };
}

function getAdaptivePrompts(params: AdaptiveParams): {
  adaptivePrompt: string;
  strictPrompt: string;
} {
  return {
    adaptivePrompt: params.adaptivePrompt ?? params.prompt,
    strictPrompt: params.prompt,
  };
}

function createRetryingClient(
  base: AdaptiveModelClient,
  input: AdaptiveTranslationFileInput,
  onStage: (stage: "repairing" | "fallback", sceneId?: string) => void
): AdaptiveModelClient {
  const retry = input.retryRequest;
  const delay = input.params.delay;

  const call = <TInput extends { requestAttempt?: number }, TResult>(
    fn: (value: TInput) => Promise<TResult>,
    value: TInput
  ): Promise<TResult> => {
    let attempt = 0;
    const run = () => {
      attempt += 1;
      return fn({ ...value, requestAttempt: attempt });
    };
    return retry
      ? retry(run, delay, input.abortSignal)
      : run();
  };

  return {
    translateScene(sceneInput: AdaptiveTranslateInput): Promise<AdaptiveCallResult> {
      return call((value) => base.translateScene(value), sceneInput);
    },
    repairScene(sceneInput: AdaptiveRepairInput): Promise<AdaptiveCallResult> {
      onStage("repairing", sceneInput.scene.id);
      return call((value) => base.repairScene(value), sceneInput);
    },
    translateStrictFallback(
      sceneInput: AdaptiveTranslateInput
    ): Promise<AdaptiveCallResult> {
      onStage("fallback", sceneInput.scene.id);
      if (!base.translateStrictFallback) {
        return Promise.reject(
          new Error(translationErrorCodes.adaptiveFallbackFailed)
        );
      }
      return call((value) => base.translateStrictFallback!(value), sceneInput);
    },
  };
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, "utf8");
  try {
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    // Never truncate the destination as a fallback: if the atomic replacement
    // cannot complete, retain the previous output and surface the failure.
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function renderAdaptiveOutput(
  source: ParsedSubtitle,
  scenes: readonly AdaptiveCheckpointScene[],
  layoutOptions: Partial<AdaptiveLayoutOptions>,
  params: AdaptiveParams
): RenderAdaptiveSrtResult {
  return params.outputFormat === "ass-bilingual"
    ? renderAdaptiveAss(source, scenes, layoutOptions, {
        assFonts: params.assFonts,
      })
    : renderAdaptiveSrt(source, scenes, layoutOptions);
}

function createAdaptivePreview(
  rendered: RenderAdaptiveSrtResult,
  sourceCues: readonly AdaptiveSourceCue[],
  scenes: readonly AdaptiveCheckpointScene[]
): NonNullable<BatchProgress["previewCues"]> {
  const sourceById = new Map(sourceCues.map((cue) => [cue.id, cue]));
  const originByBlockId = new Map(
    scenes.flatMap((scene) =>
      scene.blocks.map((block) => [block.id, block.origin] as const)
    )
  );
  return rendered.targetCues.map((cue) => ({
    kind: "adaptive" as const,
    targetText: cue.renderedText,
    sourceStart: cue.sourceStart,
    sourceEnd: cue.sourceEnd,
    sourceTexts: cue.sourceCueIds.map(
      (sourceId) => sourceById.get(sourceId)?.originalText ?? ""
    ),
    start: cue.startMs,
    end: cue.endMs,
    origin: originByBlockId.get(cue.blockId) ?? "adaptive",
    warnings: cue.warnings,
  }));
}

/**
 * Execute the bounded Adaptive file workflow. All writes are owned by this
 * function so completion order never changes source ordering or checkpoint
 * state, and source parser objects remain immutable throughout the run.
 */
export async function processAdaptiveTranslationFile(
  input: AdaptiveTranslationFileInput
): Promise<void> {
  const { params, abortSignal } = input;
  throwIfAborted(abortSignal);

  const sourceDocument = readSourceDocument(input);
  const sourceName = sourceDocument.sourceName;
  const sourceExtension = sourceDocument.sourceExtension;
  const sourceFingerprint = sourceDocument.sourceFingerprint;
  const source = sourceDocument.parsed;
  const layoutOptions = getLayoutOptions(params);
  const prompts = getAdaptivePrompts(params);
  const semanticFingerprint = createAdaptiveSemanticFingerprint({
    mode: "adaptive",
    apiHost: params.apiHost,
    model: params.model,
    targetLanguage: params.lang,
    adaptivePrompt: prompts.adaptivePrompt,
    additional: params.additional,
    temperature: params.temperature,
    contextSize: params.contextSize ?? 5,
    scenePolicyVersion: 1,
    maxTake: 4,
    maxTargets: 3,
    briefSchemaVersion: 1,
    placeholderStrategyVersion: 1,
  });
  const layoutFingerprint = createAdaptiveLayoutFingerprint({
    layoutEngineVersion: 1,
    outputFormat: params.outputFormat,
    layoutOptions,
    targetLanguage: params.lang,
  });

  let checkpoint = sourceDocument.checkpoint;
  if (!checkpoint && path.extname(input.file.path).slice(1).toLowerCase() !== "json") {
    const sidecar = readSidecarCheckpoint(
      input.checkpointPath,
      sourceName,
      sourceExtension,
      sourceFingerprint
    );
    checkpoint = sidecar.checkpoint;
    if (sidecar.shouldBackupLegacy) {
      await backupAdaptiveCheckpoint(input.checkpointPath);
    }
  }

  const resumeOptions: AdaptiveCheckpointResumeOptions = {
    sourceName,
    format: sourceExtension,
    sourceFingerprint,
    semanticFingerprint,
    layoutFingerprint,
  };

  if (checkpoint) {
    const resume = getAdaptiveCheckpointResumeMetadata(checkpoint, resumeOptions);
    if (resume.mode === "incompatible") {
      throw new Error(translationErrorCodes.adaptiveIncompatibleCheckpoint);
    } else if (resume.mode === "restart") {
      await backupAdaptiveCheckpoint(input.checkpointPath).catch(() => undefined);
      checkpoint = undefined;
    } else if (
      checkpoint.state === "complete" &&
      canReuseAdaptiveCheckpoint(checkpoint, resumeOptions)
    ) {
      checkpoint.translation.layoutFingerprint = layoutFingerprint;
      const rendered = renderAdaptiveOutput(
        source,
        checkpoint.scenes,
        layoutOptions,
        params
      );
      if (rendered.violations.some((item) => item.severity === "error")) {
        throw new Error(translationErrorCodes.adaptiveIncompleteCoverage);
      }
      await writeAtomic(input.outputPath, rendered.content);
      const writer = createAdaptiveCheckpointWriter(input.checkpointPath);
      await writer.write(checkpoint);
      await writer.wait();
      input.sendProgress({
        filePath: input.file.path,
        mode: "adaptive",
        progress: 100,
        status: "done",
        totalCues: getSubtitleCues(source).length,
        currentCue: countCoveredSourceCues(checkpoint.scenes),
        outputPath: input.outputPath,
        usageSummary: checkpoint.usageSummary,
        warnings: rendered.violations.filter((item) => item.severity === "warning"),
        previewCues: createAdaptivePreview(
          rendered,
          buildAdaptiveSourceCues(source),
          checkpoint.scenes
        ),
      });
      return;
    }
  }

  const sourceCues = buildAdaptiveSourceCues(source);
  const completedSourceIndices = checkpoint
    ? new Set(getAdaptiveCompletedCueIndices(checkpoint))
    : new Set<number>();
  const sceneOptions: AdaptiveSceneBuilderOptions = {
    contextSize: params.contextSize ?? 5,
    completedSourceIndices,
    sourceFormat: sourceExtension,
  };
  const pendingScenes = buildAdaptiveScenes(sourceCues, sceneOptions).filter(
    (scene) => scene.core.some((cue) => !cue.flags.empty)
  );

  if (!checkpoint) {
    checkpoint = createInitialCheckpoint({
      source,
      sourceName,
      sourceExtension,
      sourceFingerprint,
      scenes: pendingScenes,
      semanticFingerprint,
      layoutFingerprint,
    });
  } else {
    checkpoint.subtitle = stripAdaptiveTranslations(source);
    checkpoint.translation.layoutFingerprint = layoutFingerprint;
    updateCheckpointScenes(checkpoint, pendingScenes);
  }

  const writer = createAdaptiveCheckpointWriter(input.checkpointPath);
  await writer.write(checkpoint);
  throwIfAborted(abortSignal);

  const totalTranslatable = sourceCues.filter((cue) => !cue.flags.empty).length;
  const usageRecords: StageUsage[] = [...checkpoint.usage];
  let outputWrite = Promise.resolve();
  const outputPath = input.outputPath;

  const sendAdaptiveProgress = (
    status: BatchProgress["status"],
    sceneProgress?: AdaptivePipelineProgress,
    warnings: readonly AdaptiveSubtitleViolation[] = [],
    previewCues?: BatchProgress["previewCues"]
  ) => {
    const covered = countCoveredSourceCues(checkpoint!.scenes);
    input.sendProgress({
      filePath: input.file.path,
      mode: "adaptive",
      progress: totalTranslatable > 0 ? (covered / totalTranslatable) * 100 : 100,
      status,
      totalCues: totalTranslatable,
      currentCue: covered,
      outputPath,
      usageSummary: toUsageSummary(usageRecords),
      warnings: [...warnings],
      ...(previewCues ? { previewCues } : {}),
      analysis: checkpoint!.brief
        ? formatTranslationBrief(checkpoint!.brief)
        : status === "analyzing"
          ? null
          : undefined,
    });
  };

  if (!checkpoint.brief) {
    if (sourceCues.length >= 40) {
      sendAdaptiveProgress("analyzing");
      try {
        const subtitles = sourceCues.map(getCueSourceText).filter(Boolean);
        const briefResult = input.generateBrief
          ? await input.generateBrief(subtitles)
          : await generateTranslationBrief(subtitles, {
              apiKeys: params.apiKeys,
              apiHost: params.apiHost,
              model: params.model,
              targetLanguage: params.lang,
              temperature: 0.3,
              additional: params.additional,
              requestRateLimiter: input.requestRateLimiter,
              abortSignal,
            });
        checkpoint.brief = briefResult.brief;
        if (briefResult.usage) usageRecords.push(briefResult.usage);
      } catch (error) {
        throwIfAborted(abortSignal);
        console.warn("Adaptive brief generation failed; continuing without it.");
        checkpoint.brief = createEmptyTranslationBrief();
      }
    } else {
      checkpoint.brief = createEmptyTranslationBrief();
    }
    checkpoint.usage = [...usageRecords];
    checkpoint.usageSummary = toUsageSummary(usageRecords);
    await writer.write(checkpoint);
  }

  const baseClient = input.modelClient ?? createAiSdkAdaptiveModelClient({
    apiKeys: params.apiKeys,
    apiHost: params.apiHost,
    model: params.model,
    targetLanguage: params.lang,
    adaptivePrompt: prompts.adaptivePrompt,
    strictPrompt: prompts.strictPrompt,
    additional: params.additional,
    temperature: params.temperature,
    requestRateLimiter: input.requestRateLimiter,
  });
  const client = createRetryingClient(baseClient, input, (stage, sceneId) => {
    const checkpointScene = checkpoint!.scenes.find(
      (scene) => scene.id === sceneId
    );
    if (checkpointScene) {
      checkpointScene.status = stage;
      void writer.write(checkpoint!);
    }
    sendAdaptiveProgress(stage);
  });

  let translateResult: Awaited<ReturnType<typeof processAdaptiveScenes>>;
  try {
    translateResult = await processAdaptiveScenes({
      scenes: pendingScenes,
      concurrency: params.concurrency,
      abortSignal,
      translateScene: async (scene) => {
        const sourceScene = pendingScenes.find((item) => item.id === scene.id);
        if (!sourceScene) {
          throw new Error(translationErrorCodes.adaptiveIncompleteCoverage);
        }
        return translateAdaptiveScene(scene, {
          client,
          targetLanguage: params.lang,
          brief: selectBriefForScene(
            checkpoint!.brief ?? createEmptyTranslationBrief(),
            sourceScene.core
          ),
          prompt: prompts.adaptivePrompt,
          additional: params.additional,
          temperature: params.temperature,
          abortSignal,
          onUsage: (usage) => {
            usageRecords.push(usage);
          },
        });
      },
      onSceneStart: (scene) => {
        const checkpointScene = checkpoint!.scenes.find(
          (item) => item.id === scene.id
        );
        if (checkpointScene) checkpointScene.status = "translating";
        sendAdaptiveProgress("translating");
      },
      onSceneComplete: async (result, progress) => {
        throwIfAborted(abortSignal);
        const checkpointScene = checkpoint!.scenes.find(
          (item) => item.id === result.sceneId
        );
        if (!checkpointScene) {
          throw new Error(translationErrorCodes.adaptiveIncompleteCoverage);
        }
        checkpointScene.status = "done";
        checkpointScene.blocks = [...result.blocks];
        checkpointScene.violations = [...result.violations];
        checkpoint!.usage = [...usageRecords];
        checkpoint!.usageSummary = toUsageSummary(usageRecords);
        await writer.write(checkpoint!);

        const completedScenes = checkpoint!.scenes.filter(
          (scene) => scene.status === "done"
        );
        const rendered = renderAdaptiveOutput(
          source,
          completedScenes,
          layoutOptions,
          params
        );
        const currentWarnings = rendered.violations.filter(
          (item) => item.severity === "warning"
        );
        outputWrite = outputWrite.then(() =>
          writeAtomic(outputPath, rendered.content)
        );
        await outputWrite;
        sendAdaptiveProgress(
          "rendering",
          progress,
          currentWarnings,
          createAdaptivePreview(rendered, sourceCues, completedScenes)
        );
      },
    });
  } catch (error) {
    if (!abortSignal.aborted) {
      for (const scene of checkpoint.scenes) {
        if (
          scene.status === "translating" ||
          scene.status === "repairing" ||
          scene.status === "fallback"
        ) {
          scene.status = "error";
          scene.errorCode =
            error instanceof Error &&
            (error.message.startsWith("ERR_") ||
              ("code" in error &&
                typeof error.code === "string" &&
                error.code.startsWith("ERR_")))
              ? ("code" in error && typeof error.code === "string"
                  ? error.code
                  : error.message)
              : translationErrorCodes.adaptiveFallbackFailed;
        }
      }
      checkpoint.usage = [...usageRecords];
      checkpoint.usageSummary = toUsageSummary(usageRecords);
      await writer.write(checkpoint);
      await writer.wait();
    } else {
      await writer.wait().catch(() => undefined);
    }
    throw error;
  }

  throwIfAborted(abortSignal);
  checkpoint.usage = [...usageRecords, ...translateResult.usages.filter((usage) => !usageRecords.includes(usage))];
  checkpoint.usageSummary = toUsageSummary(checkpoint.usage);
  const finalRender: RenderAdaptiveSrtResult = renderAdaptiveOutput(
    source,
    checkpoint.scenes,
    layoutOptions,
    params
  );
  if (finalRender.violations.some((item) => item.severity === "error")) {
    throw new Error(translationErrorCodes.adaptiveIncompleteCoverage);
  }
  await outputWrite;
  await writeAtomic(outputPath, finalRender.content);
  checkpoint.state = "complete";
  checkpoint.translation.layoutFingerprint = layoutFingerprint;
  await writer.write(checkpoint);
  await writer.wait();
  sendAdaptiveProgress(
    "done",
    undefined,
    finalRender.violations.filter((item) => item.severity === "warning"),
    createAdaptivePreview(finalRender, sourceCues, checkpoint.scenes)
  );
}
