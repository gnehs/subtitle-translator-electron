import { createHash } from "node:crypto";
import type {
  AdaptiveScene,
  AdaptiveSceneDraft,
  AdaptiveSourceCue,
  AdaptiveSubtitleViolation,
  TranslationBlock,
  TranslationBlockOrigin,
} from "./types.ts";
import { extractPlaceholderSequence } from "./protected-tokens.ts";

type Severity = "warning" | "error";

const DRAFT_BLOCK_KEYS = new Set(["take", "targets"]);
const DRAFT_KEYS = new Set(["blocks"]);
const PLACEHOLDER_RE = /^__ST_[A-Z]+_\d+__$/;

/** Keep the foundation validator in lockstep with the canonical Zod schema. */
export const ADAPTIVE_TARGET_TEXT_MAX_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function violation(
  code: string,
  severity: Severity,
  message: string,
  context: Partial<Pick<AdaptiveSubtitleViolation, "sceneId" | "blockId" | "targetCueId">> = {},
  details?: Record<string, string | number | boolean | null>,
): AdaptiveSubtitleViolation {
  return {
    code,
    severity,
    message,
    ...context,
    ...(details ? { details } : {}),
  };
}

/** Safe normalization permitted before structural validation. */
export function normalizeAdaptiveTargetText(value: string): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    // Newlines not represented by a protected semantic-break placeholder are
    // presentation whitespace, not permission to emit another subtitle cue.
    .replace(/[\t ]*\n[\t ]*/g, " ")
    .replace(/[\t ]{2,}/g, " ")
    .trim();
}

/** British-spelling alias used by a few pipeline adapters. */
export const normaliseAdaptiveTargetText = normalizeAdaptiveTargetText;

function normalizedPlaceholderSequence(value: unknown): string[] {
  let extracted: unknown;
  try {
    extracted = extractPlaceholderSequence(String(value ?? ""));
  } catch {
    extracted = [];
  }
  if (!Array.isArray(extracted)) return [];
  return extracted.map((item) => {
    if (typeof item === "string") return item;
    if (isRecord(item)) {
      if (typeof item.placeholder === "string") return item.placeholder;
      if (typeof item.raw === "string") return item.raw;
    }
    return String(item);
  });
}

function sourceTextForPlaceholders(cue: AdaptiveSourceCue): string {
  // `modelText` is the protected form by contract.  The fallback keeps this
  // validator useful with hand-built fixtures that only provide originalText.
  return cue.modelText || cue.originalText || cue.plainText || "";
}

function compactPlaceholderSequence(values: readonly string[]): string[] {
  return values.filter((value) => value.length > 0);
}

function blockPlaceholderViolations(
  sourceCues: readonly AdaptiveSourceCue[],
  targetTexts: readonly string[],
  context: { sceneId: string; blockId: string },
): AdaptiveSubtitleViolation[] {
  const sourceSequence = compactPlaceholderSequence(
    sourceCues.flatMap((cue) => normalizedPlaceholderSequence(sourceTextForPlaceholders(cue))),
  );
  const targetSequence = compactPlaceholderSequence(
    targetTexts.flatMap((text) => normalizedPlaceholderSequence(text)),
  );
  const violations: AdaptiveSubtitleViolation[] = [];

  const sourceCounts = new Map<string, number>();
  for (const placeholder of sourceSequence) {
    sourceCounts.set(placeholder, (sourceCounts.get(placeholder) ?? 0) + 1);
  }
  const targetCounts = new Map<string, number>();
  for (const placeholder of targetSequence) {
    targetCounts.set(placeholder, (targetCounts.get(placeholder) ?? 0) + 1);
  }
  for (const [placeholder, count] of targetCounts) {
    if (!sourceCounts.has(placeholder) || count > (sourceCounts.get(placeholder) ?? 0)) {
      violations.push(
        violation(
          "adaptive.placeholder.unknown",
          "error",
          `Target contains placeholder ${placeholder} that is not present in the source block.`,
          context,
          { placeholder, sourceCount: sourceCounts.get(placeholder) ?? 0, targetCount: count },
        ),
      );
    }
  }
  for (const [placeholder, count] of sourceCounts) {
    if ((targetCounts.get(placeholder) ?? 0) < count) {
      violations.push(
        violation(
          "adaptive.placeholder.missing",
          "error",
          `Target is missing source placeholder ${placeholder}.`,
          context,
          { placeholder, sourceCount: count, targetCount: targetCounts.get(placeholder) ?? 0 },
        ),
      );
    }
  }
  if (sourceSequence.length !== targetSequence.length) {
    violations.push(
      violation(
        "adaptive.placeholder.countMismatch",
        "error",
        "Source and target placeholder counts differ.",
        context,
        { sourceCount: sourceSequence.length, targetCount: targetSequence.length },
      ),
    );
  } else if (sourceSequence.some((placeholder, index) => placeholder !== targetSequence[index])) {
    violations.push(
      violation(
        "adaptive.placeholder.orderMismatch",
        "error",
        "Source and target placeholder order differs.",
        context,
      ),
    );
  }
  return violations;
}

export interface AdaptivePartitionValidationResult {
  valid: boolean;
  violations: AdaptiveSubtitleViolation[];
}

/** Validate only the draft partition contract (without materializing blocks). */
export function validateAdaptiveDraftPartition(
  draft: AdaptiveSceneDraft,
  scene: Pick<AdaptiveScene, "id" | "core" | "lockedOneToOne">,
): AdaptivePartitionValidationResult {
  const violations: AdaptiveSubtitleViolation[] = [];
  const sceneId = scene.id;
  const draftValue = draft as unknown as Record<string, unknown>;
  if (!isRecord(draftValue) || !Array.isArray(draftValue.blocks)) {
    violations.push(
      violation(
        "adaptive.partition.missingBlocks",
        "error",
        "Adaptive draft must contain a blocks array.",
        { sceneId },
      ),
    );
    return { valid: false, violations };
  }
  for (const key of Object.keys(draftValue)) {
    if (!DRAFT_KEYS.has(key)) {
      violations.push(
        violation(
          "adaptive.partition.extraProperty",
          "error",
          `Adaptive draft contains unsupported property ${key}.`,
          { sceneId },
          { property: key },
        ),
      );
    }
  }
  const blocks = draftValue.blocks;
  if (blocks.length === 0) {
    violations.push(
      violation("adaptive.partition.empty", "error", "Adaptive draft contains no blocks.", { sceneId }),
    );
  }
  if (blocks.length > 32) {
    violations.push(
      violation("adaptive.partition.tooManyBlocks", "error", "Adaptive draft contains too many blocks.", { sceneId }, { count: blocks.length }),
    );
  }

  let consumed = 0;
  const lockedOneToOne =
    scene.lockedOneToOne || scene.core.some((cue) => cue.flags.lockedOneToOne);
  blocks.forEach((value, index) => {
    const blockId = `${sceneId}-block-${index}`;
    if (!isRecord(value)) {
      violations.push(
        violation("adaptive.partition.invalidBlock", "error", "Adaptive draft block must be an object.", { sceneId, blockId }),
      );
      return;
    }
    for (const key of Object.keys(value)) {
      if (!DRAFT_BLOCK_KEYS.has(key)) {
        violations.push(
          violation(
            "adaptive.partition.extraProperty",
            "error",
            `Adaptive draft block contains unsupported property ${key}.`,
            { sceneId, blockId },
            { property: key },
          ),
        );
      }
    }
    const take = value.take;
    if (typeof take !== "number" || !Number.isInteger(take)) {
      violations.push(
        violation("adaptive.partition.takeNotInteger", "error", "Block take must be an integer.", { sceneId, blockId }),
      );
    } else {
      if (take < 1) {
        violations.push(
          violation("adaptive.partition.takeTooSmall", "error", "Block take must be at least 1.", { sceneId, blockId }, { take }),
        );
      }
      if (take > 4) {
        violations.push(
          violation("adaptive.partition.takeTooLarge", "error", "Block take must not exceed 4.", { sceneId, blockId }, { take }),
        );
      }
      consumed += take;
    }
    const targets = value.targets;
    if (!Array.isArray(targets)) {
      violations.push(
        violation("adaptive.partition.targetsNotArray", "error", "Block targets must be an array.", { sceneId, blockId }),
      );
      return;
    }
    if (targets.length < 1) {
      violations.push(
        violation("adaptive.partition.emptyTargets", "error", "Block must contain at least one target.", { sceneId, blockId }),
      );
    }
    if (targets.length > 3) {
      violations.push(
        violation("adaptive.partition.tooManyTargets", "error", "Block must not contain more than three targets.", { sceneId, blockId }, { count: targets.length }),
      );
    }
    targets.forEach((target, targetIndex) => {
      if (typeof target !== "string" || target.trim().length === 0) {
        violations.push(
          violation(
            "adaptive.partition.emptyTarget",
            "error",
            "Every target must be a non-empty string.",
            { sceneId, blockId, targetCueId: `${blockId}-target-${targetIndex}` },
          ),
        );
      } else if (target.trim().length > ADAPTIVE_TARGET_TEXT_MAX_LENGTH) {
        violations.push(
          violation(
            "adaptive.partition.targetTooLong",
            "error",
            "Every target must not exceed 1000 characters.",
            { sceneId, blockId, targetCueId: `${blockId}-target-${targetIndex}` },
            { maxLength: ADAPTIVE_TARGET_TEXT_MAX_LENGTH, length: target.trim().length },
          ),
        );
      }
    });

    if (lockedOneToOne && (take !== 1 || targets.length !== 1)) {
      violations.push(
        violation(
          "adaptive.partition.lockedOneToOne",
          "error",
          "A locked one-to-one scene must contain exactly one target for each source cue.",
          { sceneId, blockId },
        ),
      );
    }
  });

  const expected = scene.core.length;
  if (consumed < expected) {
    violations.push(
      violation(
        "adaptive.partition.sourceCoverageMissing",
        "error",
        "Adaptive draft does not cover every source cue.",
        { sceneId },
        { expected, consumed },
      ),
    );
  } else if (consumed > expected) {
    violations.push(
      violation(
        "adaptive.partition.sourceCoverageExceeded",
        "error",
        "Adaptive draft consumes source cues more than once or exceeds the scene range.",
        { sceneId },
        { expected, consumed },
      ),
    );
  }
  return { valid: violations.every((item) => item.severity !== "error"), violations };
}

export const validateDraftPartition = validateAdaptiveDraftPartition;
export const validatePartition = validateAdaptiveDraftPartition;

function simpleFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function materializeBlock(
  scene: AdaptiveScene,
  sourceCues: readonly AdaptiveSourceCue[],
  targets: readonly string[],
  blockIndex: number,
  origin: TranslationBlockOrigin,
): TranslationBlock {
  const first = sourceCues[0];
  const last = sourceCues[sourceCues.length - 1];
  const sourceStart = first?.sourceIndex ?? first?.id ?? scene.sourceStart;
  const sourceEnd = last?.sourceIndex ?? last?.id ?? scene.sourceEnd;
  const sourceCueIds = sourceCues.map((cue) => cue.id);
  const semanticFingerprint = simpleFingerprint(
    JSON.stringify({ sourceCueIds, targets }),
  );
  return {
    id: `${scene.id}-block-${blockIndex}`,
    sceneId: scene.id,
    sourceStart,
    sourceEnd,
    sourceCueIds,
    targetTexts: [...targets],
    origin,
    semanticFingerprint,
  };
}

export interface MaterializeAdaptiveDraftResult {
  blocks: TranslationBlock[];
  violations: AdaptiveSubtitleViolation[];
}

/** Convert a validated draft into source-ranged translation blocks. */
export function materializeAdaptiveDraft(
  draft: AdaptiveSceneDraft,
  scene: AdaptiveScene,
  origin: TranslationBlockOrigin = "adaptive",
): MaterializeAdaptiveDraftResult {
  const partition = validateAdaptiveDraftPartition(draft, scene);
  const violations = [...partition.violations];
  const blocks: TranslationBlock[] = [];
  const draftBlocks = isRecord(draft) && Array.isArray(draft.blocks) ? draft.blocks : [];
  let cursor = 0;
  draftBlocks.forEach((value, index) => {
    if (!isRecord(value)) return;
    const take = typeof value.take === "number" && Number.isInteger(value.take) ? value.take : 0;
    const targets = Array.isArray(value.targets)
      ? value.targets
          .filter((target): target is string => typeof target === "string")
          .map(normalizeAdaptiveTargetText)
      : [];
    const blockCues = take > 0 ? scene.core.slice(cursor, cursor + take) : [];
    const blockId = `${scene.id}-block-${index}`;
    if (blockCues.length === take && targets.length > 0) {
      const block = materializeBlock(scene, blockCues, targets, index, origin);
      blocks.push(block);
      violations.push(
        ...blockPlaceholderViolations(blockCues, targets, { sceneId: scene.id, blockId }),
      );
    }
    cursor += Math.max(0, take);
  });
  return { blocks, violations };
}

export interface AdaptiveDraftValidationResult {
  valid: boolean;
  violations: AdaptiveSubtitleViolation[];
  blocks?: TranslationBlock[];
}

/** Validate partition + placeholders and materialize when source ranges exist. */
export function validateAdaptiveDraft(
  draft: AdaptiveSceneDraft,
  scene: AdaptiveScene,
): AdaptiveDraftValidationResult {
  const materialized = materializeAdaptiveDraft(draft, scene);
  const valid = materialized.violations.every((item) => item.severity !== "error");
  return {
    valid,
    violations: materialized.violations,
    ...(materialized.blocks.length > 0 ? { blocks: materialized.blocks } : {}),
  };
}

export const validateAdaptiveDraftOutput = validateAdaptiveDraft;

/** Validate placeholders for a materialized block. */
export function validateAdaptiveBlockPlaceholders(
  block: TranslationBlock,
  sourceCues: readonly AdaptiveSourceCue[],
): AdaptiveSubtitleViolation[] {
  const byId = new Map(sourceCues.map((cue) => [cue.id, cue]));
  const cues = block.sourceCueIds
    .map((id) => byId.get(id))
    .filter((cue): cue is AdaptiveSourceCue => cue !== undefined);
  return blockPlaceholderViolations(cues, block.targetTexts, {
    sceneId: block.sceneId,
    blockId: block.id,
  });
}

export const validatePlaceholderContract = validateAdaptiveBlockPlaceholders;
export const validateAdaptivePlaceholders = validateAdaptiveBlockPlaceholders;
export const materializeTranslationBlocks = materializeAdaptiveDraft;

/** A compact helper for callers that only need the violation list. */
export function getAdaptiveDraftViolations(
  draft: AdaptiveSceneDraft,
  scene: AdaptiveScene,
): AdaptiveSubtitleViolation[] {
  return validateAdaptiveDraft(draft, scene).violations;
}

// Kept private but intentionally referenced in one place to make malformed
// placeholder fixtures obvious during development and tests.
void PLACEHOLDER_RE;
