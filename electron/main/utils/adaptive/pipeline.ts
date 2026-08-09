import type {
  AdaptiveSceneLike,
  StageUsage,
  TranslationUsageSummary,
} from "./model-client.ts";
import { createUsageSummary } from "./model-client.ts";
import { AdaptiveTranslator, translateAdaptiveScene } from "./translator.ts";
import type {
  AdaptiveSceneTranslationResult,
  AdaptiveTranslatorOptions,
  TranslationBlock,
} from "./translator.ts";

export interface AdaptivePipelineProgress {
  completedScenes: number;
  totalScenes: number;
  coveredSourceCueCount: number;
  totalSourceCueCount: number;
  sceneId?: string;
  origin?: AdaptiveSceneTranslationResult["origin"];
}

export interface AdaptivePipelineInput {
  scenes: readonly AdaptiveSceneLike[];
  translator?: AdaptiveTranslator;
  translatorOptions?: Omit<AdaptiveTranslatorOptions, "client"> &
    Partial<Pick<AdaptiveTranslatorOptions, "client">>;
  /** A callback makes it possible to inject a checkpoint-aware runtime. */
  translateScene?: (
    scene: AdaptiveSceneLike,
    index: number,
    abortSignal: AbortSignal
  ) => Promise<AdaptiveSceneTranslationResult>;
  concurrency?: number;
  abortSignal?: AbortSignal;
  onSceneStart?: (scene: AdaptiveSceneLike) => void;
  onSceneComplete?: (
    result: AdaptiveSceneTranslationResult,
    progress: AdaptivePipelineProgress
  ) => void | Promise<void>;
  onProgress?: (progress: AdaptivePipelineProgress) => void;
}

export interface AdaptivePipelineResult {
  scenes: readonly AdaptiveSceneTranslationResult[];
  blocks: readonly TranslationBlock[];
  usages: readonly StageUsage[];
  usage: TranslationUsageSummary;
  coverage: readonly number[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
  }
}

function combineAbortSignals(
  signals: readonly (AbortSignal | undefined)[]
): AbortSignal {
  const present = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined
  );
  if (present.length === 1) return present[0]!;
  return AbortSignal.any(present);
}

function validateConcurrency(value: number | undefined): number {
  const concurrency = value ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Adaptive pipeline concurrency must be a positive integer");
  }
  return concurrency;
}

/**
 * Translate independent scenes concurrently while keeping committed results
 * deterministic by source order. The pipeline itself has no filesystem side
 * effects; callers can persist each completed result atomically via callbacks.
 */
export async function processAdaptiveScenes(
  input: AdaptivePipelineInput
): Promise<AdaptivePipelineResult> {
  const scenes = [...input.scenes];
  const concurrency = validateConcurrency(input.concurrency);
  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.id)) {
      throw new Error(`Duplicate adaptive scene id: ${scene.id}`);
    }
    seen.add(scene.id);
  }

  const cancellationController = new AbortController();
  const effectiveAbortSignal = combineAbortSignals([
    input.abortSignal,
    input.translatorOptions?.abortSignal,
    cancellationController.signal,
  ]);

  const results: Array<AdaptiveSceneTranslationResult | undefined> = Array.from(
    { length: scenes.length },
    () => undefined
  );
  let nextIndex = 0;
  let firstFailure: unknown;
  let failed = false;
  let completedScenes = 0;
  let coveredSourceCueCount = 0;
  const coveredSourceIds = new Set<number>();
  const totalSourceCueCount = scenes.reduce(
    (sum, scene) => sum + scene.core.length,
    0
  );

  const failFast = (error: unknown): void => {
    if (failed) return;
    failed = true;
    firstFailure = error;
    cancellationController.abort(error);
  };

  const runScene = async (scene: AdaptiveSceneLike, index: number) => {
    throwIfAborted(effectiveAbortSignal);
    input.onSceneStart?.(scene);
    throwIfAborted(effectiveAbortSignal);
    const result = input.translateScene
      ? await input.translateScene(scene, index, effectiveAbortSignal)
      : input.translator
        ? await input.translator.translateScene(scene, {
            abortSignal: effectiveAbortSignal,
          })
        : input.translatorOptions
          ? await translateAdaptiveScene(scene, {
              ...input.translatorOptions,
              abortSignal: effectiveAbortSignal,
            } as AdaptiveTranslatorOptions)
          : (() => {
              throw new Error(
                "Adaptive pipeline requires translator, translatorOptions, or translateScene"
              );
            })();
    throwIfAborted(effectiveAbortSignal);
    results[index] = result;
    completedScenes += 1;
    // Scene core is immutable and source coverage is counted by cue id, not by
    // completion order. This prevents duplicate progress increments when a
    // caller resumes with overlapping scene descriptors.
    scene.core.forEach((cue, cueIndex) => {
      const id =
        typeof cue.id === "number" && Number.isSafeInteger(cue.id)
          ? cue.id
          : typeof cue.sourceIndex === "number" && Number.isSafeInteger(cue.sourceIndex)
            ? cue.sourceIndex
            : scene.sourceStart + cueIndex;
      coveredSourceIds.add(id);
    });
    coveredSourceCueCount = coveredSourceIds.size;
    const progress: AdaptivePipelineProgress = {
      completedScenes,
      totalScenes: scenes.length,
      coveredSourceCueCount,
      totalSourceCueCount,
      sceneId: scene.id,
      origin: result.origin,
    };
    input.onProgress?.(progress);
    await input.onSceneComplete?.(result, progress);
  };

  const worker = async () => {
    while (true) {
      try {
        throwIfAborted(effectiveAbortSignal);
        if (failed) return;
        const index = nextIndex++;
        if (index >= scenes.length) return;
        await runScene(scenes[index]!, index);
      } catch (error) {
        failFast(error);
        return;
      }
    }
  };

  const workerResults = await Promise.allSettled(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, scenes.length)) },
      () => worker()
    )
  );
  if (failed) throw firstFailure;
  const rejectedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejectedWorker) throw rejectedWorker.reason;

  const orderedResults = results.filter(
    (result): result is AdaptiveSceneTranslationResult => result !== undefined
  );
  if (orderedResults.length !== scenes.length) {
    throw new Error("Adaptive pipeline completed with missing scene results");
  }
  const blocks = orderedResults
    .flatMap((result) => result.blocks)
    .sort((left, right) =>
      left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    );
  const usages = orderedResults.flatMap((result) => result.usages);
  const coveredIds = new Set<number>();
  for (const block of blocks) {
    for (const sourceId of block.sourceCueIds) coveredIds.add(sourceId);
  }
  return {
    scenes: orderedResults,
    blocks,
    usages,
    usage: createUsageSummary(usages),
    coverage: [...coveredIds].sort((left, right) => left - right),
  };
}

export const translateAdaptiveScenes = processAdaptiveScenes;
export const runAdaptivePipeline = processAdaptiveScenes;

export type {
  AdaptiveSceneLike,
  StageUsage,
  TranslationUsageSummary,
} from "./model-client.ts";
