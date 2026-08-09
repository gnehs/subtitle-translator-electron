import { createHash } from "node:crypto";
import type {
  AdaptiveCallResult,
  AdaptiveModelClient,
  AdaptiveRepairInput,
  AdaptiveSceneLike,
  AdaptiveTranslateInput,
  StageUsage,
  TranslationUsageSummary,
} from "./model-client.ts";
import { createUsageSummary } from "./model-client.ts";
import { translationErrorCodes } from "../../../shared/translation-error-codes.ts";
import {
  restoreProtectedTokens as restoreProtectedTokenQueue,
} from "./protected-tokens.ts";
import type { ProtectedToken } from "./types.ts";
import { validateAdaptiveDraft as validateFoundationAdaptiveDraft } from "./validator.ts";

export type ViolationSeverity = "warning" | "error";

export interface AdaptiveSubtitleViolation {
  code: string;
  severity: ViolationSeverity;
  message: string;
  sceneId?: string;
  blockId?: string;
  targetCueId?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface TranslationBlock {
  id: string;
  sceneId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceCueIds: number[];
  targetTexts: string[];
  origin: "adaptive" | "repair" | "strict-fallback";
  semanticFingerprint: string;
}

export interface AdaptiveSceneDraft {
  blocks: readonly AdaptiveDraftBlock[];
}

export interface AdaptiveDraftBlock {
  take: number;
  targets: readonly string[];
  [key: string]: unknown;
}

export interface DraftValidationResult {
  valid: boolean;
  violations: AdaptiveSubtitleViolation[];
  /** Materialized blocks from a custom validator/layout engine. */
  blocks?: readonly TranslationBlock[];
}

export type AdaptiveDraftValidator = (
  draft: unknown,
  scene: AdaptiveSceneLike
) => DraftValidationResult;

export interface SceneGenerationBudget {
  initial: number;
  repair: number;
  strictFallback: number;
}

export const defaultSceneGenerationBudget: SceneGenerationBudget = {
  initial: 1,
  repair: 1,
  strictFallback: 1,
};

export class AdaptiveGenerationBudgetError extends Error {
  readonly code = translationErrorCodes.adaptiveGenerationBudgetExceeded;
  readonly stage: keyof SceneGenerationBudget;

  constructor(stage: keyof SceneGenerationBudget) {
    super(translationErrorCodes.adaptiveGenerationBudgetExceeded);
    this.name = "AdaptiveGenerationBudgetError";
    this.stage = stage;
  }
}

export class AdaptiveStrictFallbackError extends Error {
  readonly code = "adaptive.scene.strictFallbackFailed";
  readonly violations: readonly AdaptiveSubtitleViolation[];

  constructor(violations: readonly AdaptiveSubtitleViolation[]) {
    super("Strict fallback did not produce a valid one-to-one translation");
    this.name = "AdaptiveStrictFallbackError";
    this.violations = violations;
  }
}

export interface SceneGenerationBudgetGuard {
  readonly counts: Readonly<SceneGenerationBudget>;
  consume(stage: keyof SceneGenerationBudget): void;
}

export function createSceneGenerationBudgetGuard(
  budget: Partial<SceneGenerationBudget> = {}
): SceneGenerationBudgetGuard {
  const limits: SceneGenerationBudget = {
    ...defaultSceneGenerationBudget,
    ...budget,
  };
  for (const stage of ["initial", "repair", "strictFallback"] as const) {
    if (!Number.isSafeInteger(limits[stage]) || limits[stage] < 0) {
      throw new RangeError(`Invalid generation budget for ${stage}`);
    }
  }
  const counts: SceneGenerationBudget = { initial: 0, repair: 0, strictFallback: 0 };
  return {
    get counts() {
      return { ...counts };
    },
    consume(stage) {
      if (counts[stage] >= limits[stage]) {
        throw new AdaptiveGenerationBudgetError(stage);
      }
      counts[stage] += 1;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asDraft(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.blocks)) return value;
  if (Array.isArray(value)) return { blocks: value };
  return value;
}

function resultDraft(result: AdaptiveCallResult): unknown {
  if (result.draft !== undefined) return result.draft;
  if (result.output !== undefined) return result.output;
  if (result.blocks !== undefined) return { blocks: result.blocks };
  return undefined;
}

function violation(
  code: string,
  message: string,
  scene: AdaptiveSceneLike,
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

function sourceCueId(cue: AdaptiveSceneLike["core"][number], index: number): number {
  if (typeof cue.id === "number" && Number.isSafeInteger(cue.id)) return cue.id;
  if (
    typeof cue.sourceIndex === "number" &&
    Number.isSafeInteger(cue.sourceIndex)
  ) {
    return cue.sourceIndex;
  }
  return index;
}

function sourceText(cue: AdaptiveSceneLike["core"][number]): string {
  if (typeof cue.modelText === "string") return cue.modelText;
  if (typeof cue.originalText === "string") return cue.originalText;
  if (typeof cue.plainText === "string") return cue.plainText;
  return "";
}

function placeholderSequence(text: string): string[] {
  const placeholders: string[] = [];
  const pattern = /__(?:ST|SUBTITLE)_[A-Z0-9_-]+__/g;
  for (const match of text.matchAll(pattern)) placeholders.push(match[0]);
  return placeholders;
}

function cleanTargetText(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function validatePlaceholderSequences(
  sourceCues: readonly AdaptiveSceneLike["core"][number][],
  targets: readonly string[],
  scene: AdaptiveSceneLike,
  blockIndex: number
): AdaptiveSubtitleViolation[] {
  const source = sourceCues.flatMap((cue) => placeholderSequence(sourceText(cue)));
  const target = targets.flatMap((text) => placeholderSequence(text));
  if (source.length === 0 && target.length === 0) return [];
  if (source.length !== target.length) {
    return [
      violation(
        "adaptive.placeholder.mismatch",
        `Block ${blockIndex} changed the number of protected placeholders`,
        scene,
        { block: blockIndex, sourceCount: source.length, targetCount: target.length }
      ),
    ];
  }
  if (source.some((placeholder, index) => placeholder !== target[index])) {
    return [
      violation(
        "adaptive.placeholder.mismatch",
        `Block ${blockIndex} changed protected placeholder order`,
        scene,
        { block: blockIndex }
      ),
    ];
  }
  return [];
}

/** A deterministic baseline validator used when a layout validator is not injected. */
export function validateAdaptiveDraft(
  draftValue: unknown,
  scene: AdaptiveSceneLike
): DraftValidationResult {
  const draft = asDraft(draftValue);
  const errors: AdaptiveSubtitleViolation[] = [];
  if (!isRecord(draft) || !Array.isArray(draft.blocks)) {
    errors.push(violation("adaptive.schema.invalid", "Draft must contain a blocks array", scene));
    return { valid: false, violations: errors };
  }
  if (draft.blocks.length === 0 || draft.blocks.length > 32) {
    errors.push(
      violation("adaptive.partition.invalidBlockCount", "Draft block count is outside the allowed range", scene, {
        blockCount: draft.blocks.length,
      })
    );
  }

  let consumed = 0;
  const materialized: TranslationBlock[] = [];
  for (const [blockIndex, rawBlock] of draft.blocks.entries()) {
    if (!isRecord(rawBlock)) {
      errors.push(violation("adaptive.schema.invalidBlock", `Block ${blockIndex} is not an object`, scene));
      continue;
    }
    const take = rawBlock.take;
    const targets = rawBlock.targets;
    if (typeof take !== "number" || !Number.isSafeInteger(take) || take < 1 || take > 4) {
      errors.push(violation("adaptive.partition.invalidTake", `Block ${blockIndex} has an invalid take`, scene, { block: blockIndex }));
      continue;
    }
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 3 || targets.some((text) => typeof text !== "string" || cleanTargetText(text).length === 0)) {
      errors.push(violation("adaptive.partition.invalidTargets", `Block ${blockIndex} has invalid targets`, scene, { block: blockIndex }));
      continue;
    }
    if ((scene.lockedOneToOne || scene.core.some((cue) => cue.flags?.lockedOneToOne)) && (take !== 1 || targets.length !== 1)) {
      errors.push(violation("adaptive.partition.lockedOneToOne", `Block ${blockIndex} violates a locked one-to-one scene`, scene, { block: blockIndex }));
    }
    if (consumed + take > scene.core.length) {
      errors.push(violation("adaptive.partition.overConsumed", `Block ${blockIndex} consumes beyond the scene core`, scene, { block: blockIndex }));
      continue;
    }
    const sourceCues = scene.core.slice(consumed, consumed + take);
    const cleanTargets = (targets as string[]).map(cleanTargetText);
    errors.push(...validatePlaceholderSequences(sourceCues, cleanTargets, scene, blockIndex));
    const ids = sourceCues.map((cue, index) => sourceCueId(cue, consumed + index));
    const start = ids[0] ?? scene.sourceStart + consumed;
    const end = ids.at(-1) ?? start;
    materialized.push({
      id: `${scene.id}-block-${blockIndex}`,
      sceneId: scene.id,
      sourceStart: start,
      sourceEnd: end,
      sourceCueIds: ids,
      targetTexts: cleanTargets,
      origin: "adaptive",
      semanticFingerprint: createSemanticFingerprint(scene.id, ids, cleanTargets),
    });
    consumed += take;
  }
  if (consumed !== scene.core.length) {
    errors.push(
      violation("adaptive.partition.coverage", "Draft does not cover the scene core exactly once", scene, {
        consumed,
        expected: scene.core.length,
      })
    );
  }
  return {
    valid: errors.every((item) => item.severity !== "error"),
    violations: errors,
    ...(errors.some((item) => item.severity === "error") ? {} : { blocks: materialized }),
  };
}

function validateDraftWithFoundationFallback(
  draft: unknown,
  scene: AdaptiveSceneLike
): DraftValidationResult {
  const hasFoundationCueShape = scene.core.every(
    (cue) =>
      typeof cue.id === "number" &&
      typeof cue.sourceIndex === "number" &&
      typeof cue.startMs === "number" &&
      typeof cue.endMs === "number" &&
      typeof cue.modelText === "string" &&
      Array.isArray(cue.protectedTokens) &&
      typeof cue.flags?.lockedOneToOne === "boolean"
  );
  if (!hasFoundationCueShape) {
    // Hand-built DI fixtures may intentionally use the smaller structural
    // scene shape. Production source scenes always take the canonical path.
    return validateAdaptiveDraft(draft, scene);
  }
  return validateFoundationAdaptiveDraft(
    draft as Parameters<typeof validateFoundationAdaptiveDraft>[0],
    scene as Parameters<typeof validateFoundationAdaptiveDraft>[1]
  ) as DraftValidationResult;
}

function createSemanticFingerprint(
  sceneId: string,
  sourceCueIds: readonly number[],
  targets: readonly string[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ sceneId, sourceCueIds, targets }))
    .digest("hex");
}

function restoreSceneProtectedTokens(
  text: string,
  sourceCues: readonly AdaptiveSceneLike["core"][number][]
): string {
  const tokens: ProtectedToken[] = [];
  for (const cue of sourceCues) {
    for (const token of cue.protectedTokens ?? []) {
      if (!isRecord(token)) continue;
      if (
        typeof token.placeholder === "string" &&
        typeof token.raw === "string" &&
        (token.kind === "markup" ||
          token.kind === "semantic-line-break" ||
          token.kind === "url" ||
          token.kind === "email") &&
        typeof token.order === "number"
      ) {
        tokens.push(token as unknown as ProtectedToken);
      }
    }
  }
  return restoreProtectedTokenQueue(text, tokens, { validate: false });
}

function materializeWithOrigin(
  validation: DraftValidationResult,
  draftValue: unknown,
  scene: AdaptiveSceneLike,
  origin: TranslationBlock["origin"]
): TranslationBlock[] {
  if (validation.blocks) {
    return validation.blocks.map((block) => {
      const cueStart = scene.core.findIndex(
        (cue, index) => sourceCueId(cue, index) === block.sourceStart
      );
      const sourceCues =
        cueStart >= 0
          ? scene.core.slice(cueStart, cueStart + block.sourceCueIds.length)
          : scene.core;
      return {
        ...block,
        origin,
        targetTexts: block.targetTexts.map((text) =>
          restoreSceneProtectedTokens(text, sourceCues)
        ),
      };
    });
  }
  const fallbackValidation = validateAdaptiveDraft(draftValue, scene);
  return (fallbackValidation.blocks ?? []).map((block) => {
    const cueStart = scene.core.findIndex(
      (cue, index) => sourceCueId(cue, index) === block.sourceStart
    );
    const sourceCues =
      cueStart >= 0
        ? scene.core.slice(cueStart, cueStart + block.sourceCueIds.length)
        : scene.core;
    return {
      ...block,
      origin,
      targetTexts: block.targetTexts.map((text) =>
        restoreSceneProtectedTokens(text, sourceCues)
      ),
      semanticFingerprint: createSemanticFingerprint(scene.id, block.sourceCueIds, block.targetTexts),
    };
  });
}

function structuralViolations(
  result: AdaptiveCallResult,
  validation: DraftValidationResult,
  scene: AdaptiveSceneLike
): AdaptiveSubtitleViolation[] {
  // Warnings (for example soft CPS or line-wrap hints) are intentionally not
  // semantic retry triggers. Only hard structural errors may consume repair or
  // strict-fallback generation budget.
  const violations = validation.violations.filter(
    (item) =>
      item.severity === "error" &&
      // A hard CPS threshold is a presentational quality signal, not a
      // semantic retry trigger. The layout engine may still surface it to the
      // user. Timing/materialization errors (including insufficient duration)
      // remain repairable because target count can make them impossible.
      item.code !== "adaptive.layout.hardCpsExceeded"
  );
  if (result.finishReason !== undefined && result.finishReason !== "stop") {
    violations.push(
      violation("adaptive.model.incomplete", "Model output did not finish normally", scene, {
        finishReason: result.finishReason,
      })
    );
  }
  return violations;
}

function appendValidationViolations(
  allViolations: AdaptiveSubtitleViolation[],
  validation: DraftValidationResult,
  structural: readonly AdaptiveSubtitleViolation[]
): void {
  allViolations.push(...validation.violations);
  for (const item of structural) {
    if (!validation.violations.includes(item)) allViolations.push(item);
  }
}

function runDraftValidator(
  validator: AdaptiveDraftValidator,
  draft: unknown,
  scene: AdaptiveSceneLike
): DraftValidationResult {
  try {
    return validator(draft, scene);
  } catch {
    // A Zod/parser exception is itself a repairable schema violation. Keep the
    // exception text out of usage/checkpoint data to avoid leaking model output.
    return {
      valid: false,
      violations: [
        violation("adaptive.schema.invalid", "Adaptive draft could not be parsed", scene),
      ],
    };
  }
}

export interface AdaptiveSceneTranslationResult {
  sceneId: string;
  blocks: readonly TranslationBlock[];
  origin: TranslationBlock["origin"];
  violations: readonly AdaptiveSubtitleViolation[];
  warnings: readonly AdaptiveSubtitleViolation[];
  usages: readonly StageUsage[];
  usage: TranslationUsageSummary;
  budget: Readonly<SceneGenerationBudget>;
}

export interface AdaptiveTranslatorOptions {
  client: AdaptiveModelClient;
  targetLanguage?: string;
  lang?: string;
  brief?: unknown;
  prompt?: string;
  additional?: string;
  temperature?: number;
  abortSignal?: AbortSignal;
  budget?: Partial<SceneGenerationBudget>;
  validateDraft?: AdaptiveDraftValidator;
  /** Optional fallback override for DI clients that expose only the two core methods. */
  strictFallback?: (
    input: AdaptiveTranslateInput
  ) => Promise<AdaptiveCallResult>;
  onUsage?: (usage: StageUsage) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  }
}

function toInput(
  scene: AdaptiveSceneLike,
  options: AdaptiveTranslatorOptions
): AdaptiveTranslateInput {
  return {
    scene,
    targetLanguage: options.targetLanguage ?? options.lang,
    brief: options.brief,
    prompt: options.prompt,
    additional: options.additional,
    temperature: options.temperature,
    abortSignal: options.abortSignal,
  };
}

function collectUsage(
  usages: StageUsage[],
  result: AdaptiveCallResult | undefined,
  stage: StageUsage["stage"],
  sceneId: string,
  onUsage?: (usage: StageUsage) => void
): void {
  if (!result) return;
  const usage = result.usage
    ? { ...result.usage, stage: result.usage.stage ?? stage, sceneId: result.usage.sceneId ?? sceneId }
    : {
        stage,
        model: "unknown",
        sceneId,
        requestAttempt: 1,
        durationMs: 0,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      };
  usages.push(usage);
  onUsage?.(usage);
}

function strictFallbackDraft(
  result: AdaptiveCallResult,
  scene: AdaptiveSceneLike
): unknown {
  if (result.translations) {
    return {
      blocks: result.translations.map((text) => ({ take: 1, targets: [text] })),
    };
  }
  const value = resultDraft(result);
  if (Array.isArray(value)) {
    return { blocks: value.map((text) => ({ take: 1, targets: [text] })) };
  }
  if (isRecord(value) && Array.isArray(value.elements)) {
    return {
      blocks: value.elements.map((text) => ({ take: 1, targets: [text] })),
    };
  }
  if (isRecord(value) && Array.isArray(value.blocks)) return value;
  // Keep a useful error path for clients which accidentally return no payload.
  return { blocks: scene.core.map(() => ({ take: 1, targets: [""] })) };
}

function strictFallbackContractViolations(
  draftValue: unknown,
  scene: AdaptiveSceneLike
): AdaptiveSubtitleViolation[] {
  const draft = asDraft(draftValue);
  if (!isRecord(draft) || !Array.isArray(draft.blocks)) return [];
  const isOneToOne =
    draft.blocks.length === scene.core.length &&
    draft.blocks.every(
      (block) =>
        isRecord(block) &&
        block.take === 1 &&
        Array.isArray(block.targets) &&
        block.targets.length === 1
    );
  return isOneToOne
    ? []
    : [
        violation(
          "adaptive.partition.lockedOneToOne",
          "Strict fallback must return exactly one target for each source cue",
          scene,
          { expected: scene.core.length, actual: draft.blocks.length }
        ),
      ];
}

/**
 * Execute the bounded adaptive semantic workflow:
 * initial → at most one repair → at most one strict fallback.
 */
export async function translateAdaptiveScene(
  scene: AdaptiveSceneLike,
  options: AdaptiveTranslatorOptions
): Promise<AdaptiveSceneTranslationResult> {
  const guard = createSceneGenerationBudgetGuard(options.budget);
  const validator = options.validateDraft ?? validateDraftWithFoundationFallback;
  const usages: StageUsage[] = [];
  const allViolations: AdaptiveSubtitleViolation[] = [];
  const initialInput = toInput(scene, options);

  throwIfAborted(options.abortSignal);
  guard.consume("initial");
  const initial = await options.client.translateScene(initialInput);
  collectUsage(usages, initial, "adaptive-translate", scene.id, options.onUsage);
  let validation = runDraftValidator(validator, resultDraft(initial), scene);
  let structural = structuralViolations(initial, validation, scene);
  appendValidationViolations(allViolations, validation, structural);
  let finalOrigin: TranslationBlock["origin"] = "adaptive";
  let finalBlocks: TranslationBlock[] = [];

  if (structural.length === 0) {
    finalBlocks = materializeWithOrigin(validation, resultDraft(initial), scene, "adaptive");
  } else {
    throwIfAborted(options.abortSignal);
    guard.consume("repair");
    const repairInput: AdaptiveRepairInput = {
      ...initialInput,
      invalidDraft: resultDraft(initial),
      violations: structural,
    };
    const repaired = await options.client.repairScene(repairInput);
    collectUsage(usages, repaired, "adaptive-repair", scene.id, options.onUsage);
    validation = runDraftValidator(validator, resultDraft(repaired), scene);
    structural = structuralViolations(repaired, validation, scene);
    // A successful repair supersedes structural errors from the invalid
    // initial draft. Persist only diagnostics for the draft we will render.
    allViolations.length = 0;
    appendValidationViolations(allViolations, validation, structural);
    if (structural.length === 0) {
      finalOrigin = "repair";
      finalBlocks = materializeWithOrigin(validation, resultDraft(repaired), scene, "repair");
    } else {
      throwIfAborted(options.abortSignal);
      guard.consume("strictFallback");
      let strictFallback: ((input: AdaptiveTranslateInput) => Promise<AdaptiveCallResult>) | undefined;
      let strictFallbackOwner: AdaptiveModelClient | undefined;
      if (options.strictFallback) {
        strictFallback = options.strictFallback;
      } else if (options.client.translateStrictFallback) {
        strictFallback = options.client.translateStrictFallback;
        strictFallbackOwner = options.client;
      } else if (options.client.strictFallback) {
        strictFallback = options.client.strictFallback;
        strictFallbackOwner = options.client;
      } else if (options.client.fallbackScene) {
        strictFallback = options.client.fallbackScene;
        strictFallbackOwner = options.client;
      }
      if (!strictFallback) {
        throw new AdaptiveStrictFallbackError(structural);
      }
      const fallback = await strictFallback.call(strictFallbackOwner, initialInput);
      collectUsage(usages, fallback, "strict-fallback", scene.id, options.onUsage);
      const fallbackDraft = strictFallbackDraft(fallback, scene);
      const fallbackValidation = runDraftValidator(validator, fallbackDraft, scene);
      const fallbackStructural = structuralViolations(fallback, fallbackValidation, scene);
      fallbackStructural.push(
        ...strictFallbackContractViolations(fallbackDraft, scene)
      );
      // Strict fallback is the final scene result, so prior repair failures
      // must not poison final renderer validation.
      allViolations.length = 0;
      appendValidationViolations(allViolations, fallbackValidation, fallbackStructural);
      if (fallbackStructural.length > 0) {
        throw new AdaptiveStrictFallbackError(fallbackStructural);
      }
      finalOrigin = "strict-fallback";
      finalBlocks = materializeWithOrigin(fallbackValidation, fallbackDraft, scene, "strict-fallback");
    }
  }

  const warnings = allViolations.filter((item) => item.severity === "warning");
  return {
    sceneId: scene.id,
    blocks: finalBlocks,
    origin: finalOrigin,
    violations: allViolations,
    warnings,
    usages,
    usage: createUsageSummary(usages),
    budget: guard.counts,
  };
}

export class AdaptiveTranslator {
  private readonly options: AdaptiveTranslatorOptions;

  constructor(options: AdaptiveTranslatorOptions) {
    this.options = options;
  }

  translateScene(
    scene: AdaptiveSceneLike,
    overrides: Partial<AdaptiveTranslatorOptions> = {}
  ): Promise<AdaptiveSceneTranslationResult> {
    return translateAdaptiveScene(scene, { ...this.options, ...overrides });
  }
}

export function createAdaptiveTranslator(
  options: AdaptiveTranslatorOptions
): AdaptiveTranslator {
  return new AdaptiveTranslator(options);
}

export type { AdaptiveModelClient, AdaptiveRepairInput, AdaptiveTranslateInput, StageUsage, TranslationUsageSummary } from "./model-client.ts";
