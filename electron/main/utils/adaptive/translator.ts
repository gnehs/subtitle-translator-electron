import { translationErrorCodes } from "../../../shared/translation-error-codes.ts";
import { createAdaptiveAgentSession } from "./agent-tools.ts";
import { createAdaptiveFileIndex, type AdaptiveFileIndex } from "./file-index.ts";
import type {
  AdaptiveCallResult,
  AdaptiveModelClient,
  AdaptiveSceneRequest,
} from "./model-client.ts";
import { restoreProtectedTokens } from "./protected-tokens.ts";
import { createStrictFallbackOutputSchema } from "./schema.ts";
import type {
  AdaptiveLayoutOptions,
  AdaptiveScene,
  AdaptiveSceneDraft,
  AdaptiveSubtitleViolation,
  StageUsage,
  TranslationBlock,
  TranslationBlockOrigin,
  TranslationUsageSummary,
} from "./types.ts";
import { createUsageSummary } from "./usage.ts";
import { validateAdaptiveDraft } from "./validator.ts";
import { createSceneWorkspace, type SceneWorkspace } from "./workspace.ts";

export const ADAPTIVE_AGENT_MAX_STEPS = 16;

export class AdaptiveStrictFallbackError extends Error {
  readonly code = translationErrorCodes.adaptiveFallbackFailed;
  readonly violations: readonly AdaptiveSubtitleViolation[];

  constructor(violations: readonly AdaptiveSubtitleViolation[]) {
    super("Strict fallback did not produce a valid one-to-one translation");
    this.name = "AdaptiveStrictFallbackError";
    this.violations = violations;
  }
}

export interface AdaptiveSceneTranslationResult {
  sceneId: string;
  blocks: readonly TranslationBlock[];
  origin: TranslationBlockOrigin;
  violations: readonly AdaptiveSubtitleViolation[];
  warnings: readonly AdaptiveSubtitleViolation[];
  usages: readonly StageUsage[];
  usage: TranslationUsageSummary;
}

export interface AdaptiveTranslatorOptions {
  client: AdaptiveModelClient;
  targetLanguage?: string;
  brief?: unknown;
  prompt?: string;
  additional?: string;
  temperature?: number;
  abortSignal?: AbortSignal;
  maxSteps?: number;
  layoutOptions?: Partial<AdaptiveLayoutOptions>;
  fileIndex?: AdaptiveFileIndex;
  onUsage?: (usage: StageUsage) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  }
}

function violation(
  code: string,
  message: string,
  scene: AdaptiveScene,
  details?: AdaptiveSubtitleViolation["details"]
): AdaptiveSubtitleViolation {
  return {
    code,
    severity: "error",
    message,
    sceneId: scene.id,
    ...(details ? { details } : {}),
  };
}

function restoreBlockTokens(
  blocks: readonly TranslationBlock[],
  scene: AdaptiveScene,
  origin: TranslationBlockOrigin
): TranslationBlock[] {
  const byId = new Map(scene.core.map((cue) => [cue.id, cue]));
  return blocks.map((block) => {
    const tokens = block.sourceCueIds.flatMap((id) => byId.get(id)?.protectedTokens ?? []);
    return {
      ...block,
      origin,
      targetTexts: block.targetTexts.map((text) =>
        restoreProtectedTokens(text, tokens, { validate: false })
      ),
    };
  });
}

function strictFallbackDraft(
  result: AdaptiveCallResult,
  scene: AdaptiveScene
): AdaptiveSceneDraft | undefined {
  const value =
    result.translations !== undefined ? { elements: result.translations } : result.draft;
  const parsed = createStrictFallbackOutputSchema(scene.core.length).safeParse(value);
  if (!parsed.success) return undefined;
  return { blocks: parsed.data.elements.map((text) => ({ take: 1, targets: [text] })) };
}

function usageFor(
  result: { usage?: StageUsage; finishReason?: string },
  stage: StageUsage["stage"],
  scene: AdaptiveScene
): StageUsage {
  return result.usage
    ? { ...result.usage, sceneId: result.usage.sceneId ?? scene.id }
    : {
        stage,
        model: "unknown",
        sceneId: scene.id,
        requestAttempt: 1,
        durationMs: 0,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      };
}

/**
 * Run the scene agent (edit → check → finish) and, when it does not submit a
 * complete workspace within its step budget, the strict one-to-one fallback.
 */
export async function translateAdaptiveScene(
  scene: AdaptiveScene,
  options: AdaptiveTranslatorOptions
): Promise<AdaptiveSceneTranslationResult> {
  const usages: StageUsage[] = [];
  const record = (usage: StageUsage) => {
    usages.push(usage);
    options.onUsage?.(usage);
  };
  const request: AdaptiveSceneRequest = {
    scene,
    targetLanguage: options.targetLanguage,
    brief: options.brief,
    prompt: options.prompt,
    additional: options.additional,
    temperature: options.temperature,
    abortSignal: options.abortSignal,
  };
  const fileIndex =
    options.fileIndex ??
    createAdaptiveFileIndex([...scene.before, ...scene.core, ...scene.after]);
  const finish = (
    blocks: readonly TranslationBlock[],
    origin: TranslationBlockOrigin,
    violations: readonly AdaptiveSubtitleViolation[]
  ): AdaptiveSceneTranslationResult => ({
    sceneId: scene.id,
    blocks: restoreBlockTokens(blocks, scene, origin),
    origin,
    violations,
    warnings: violations.filter((item) => item.severity === "warning"),
    usages,
    usage: createUsageSummary(usages),
  });

  throwIfAborted(options.abortSignal);
  let workspace: SceneWorkspace | undefined;
  const session = await options.client.runAgentSession({
    ...request,
    maxSteps: options.maxSteps ?? ADAPTIVE_AGENT_MAX_STEPS,
    openSession: () => {
      workspace = createSceneWorkspace(scene, { layoutOptions: options.layoutOptions });
      return createAdaptiveAgentSession(workspace, fileIndex);
    },
  });
  record(usageFor(session, "adaptive-translate", scene));
  const draft = workspace?.submitted ? workspace.toDraft() : undefined;
  if (draft) {
    const validation = validateAdaptiveDraft(draft, scene);
    if (validation.valid && validation.blocks) {
      return finish(validation.blocks, "adaptive", validation.violations);
    }
  }

  throwIfAborted(options.abortSignal);
  const fallback = await options.client.translateStrictFallback(request);
  record(usageFor(fallback, "strict-fallback", scene));
  const fallbackDraft = strictFallbackDraft(fallback, scene);
  if (!fallbackDraft) {
    throw new AdaptiveStrictFallbackError([
      violation(
        "adaptive.fallback.invalidShape",
        `Strict fallback must return exactly ${scene.core.length} non-empty strings in elements`,
        scene,
        { expected: scene.core.length }
      ),
    ]);
  }
  const validation = validateAdaptiveDraft(fallbackDraft, scene);
  const errors = validation.violations.filter((item) => item.severity === "error");
  const finishReason = fallback.finishReason ?? fallback.usage?.finishReason;
  if (finishReason !== undefined && finishReason !== "stop") {
    errors.push(
      violation("adaptive.model.incomplete", "Model output did not finish normally", scene, {
        finishReason,
      })
    );
  }
  if (errors.length > 0 || !validation.blocks) {
    throw new AdaptiveStrictFallbackError(errors);
  }
  return finish(validation.blocks, "strict-fallback", validation.violations);
}

export type {
  AdaptiveModelClient,
  AdaptiveTranslateInput,
  StageUsage,
  TranslationUsageSummary,
} from "./model-client.ts";
