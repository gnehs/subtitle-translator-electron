import { layoutAdaptiveBlock } from "./layout.ts";
import type {
  AdaptiveLayoutOptions,
  AdaptiveScene,
  AdaptiveSceneDraft,
  AdaptiveSubtitleViolation,
  TranslationBlock,
} from "./types.ts";
import {
  ADAPTIVE_TARGET_TEXT_MAX_LENGTH,
  normalizeAdaptiveTargetText,
  validateAdaptiveBlockPlaceholders,
  validateAdaptiveDraft,
} from "./validator.ts";

export const ADAPTIVE_WORKSPACE_MAX_SPAN = 4;
export const ADAPTIVE_WORKSPACE_MAX_TARGETS = 3;

/** Inclusive range of scene core cue indices (0-based). */
export interface CueRange {
  from: number;
  to: number;
}

export interface WorkspaceBlock extends CueRange {
  targets: readonly string[];
}

export interface WorkspaceDiagnostic extends CueRange {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export type WorkspaceEditResult =
  | {
      ok: true;
      block: WorkspaceBlock;
      replaced: CueRange[];
      uncovered: CueRange[];
    }
  | { ok: false; errors: WorkspaceDiagnostic[] };

export interface WorkspaceCheck {
  ok: boolean;
  errors: WorkspaceDiagnostic[];
  warnings: WorkspaceDiagnostic[];
}

export interface SceneWorkspace {
  readonly scene: AdaptiveScene;
  readonly blocks: readonly WorkspaceBlock[];
  readonly submitted: boolean;
  edit(input: WorkspaceBlock): WorkspaceEditResult;
  view(): string;
  uncovered(): CueRange[];
  toDraft(): AdaptiveSceneDraft | undefined;
  check(): WorkspaceCheck;
  submit(): WorkspaceCheck;
}

export interface SceneWorkspaceOptions {
  layoutOptions?: Partial<AdaptiveLayoutOptions>;
}

function diagnostic(
  range: CueRange,
  severity: WorkspaceDiagnostic["severity"],
  code: string,
  message: string,
): WorkspaceDiagnostic {
  return { from: range.from, to: range.to, severity, code, message };
}

function rangesOf(indices: readonly number[]): CueRange[] {
  const sorted = [...indices].sort((left, right) => left - right);
  const ranges: CueRange[] = [];
  for (const index of sorted) {
    const last = ranges.at(-1);
    if (last && last.to === index - 1) last.to = index;
    else ranges.push({ from: index, to: index });
  }
  return ranges;
}

function overlaps(left: CueRange, right: CueRange): boolean {
  return left.from <= right.to && right.from <= left.to;
}

function formatDuration(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function createSceneWorkspace(
  scene: AdaptiveScene,
  options: SceneWorkspaceOptions = {},
): SceneWorkspace {
  const cueCount = scene.core.length;
  const lastIndex = cueCount - 1;
  const locked =
    scene.lockedOneToOne || scene.core.some((cue) => cue.flags.lockedOneToOne);
  const whole: CueRange = { from: 0, to: lastIndex };
  let blocks: WorkspaceBlock[] = [];
  let submitted = false;

  const validateEdit = (input: WorkspaceBlock): WorkspaceDiagnostic[] => {
    const errors: WorkspaceDiagnostic[] = [];
    const range = { from: input.from, to: input.to };
    if (
      !Number.isSafeInteger(input.from) ||
      !Number.isSafeInteger(input.to) ||
      input.from < 0 ||
      input.to > lastIndex ||
      input.from > input.to
    ) {
      errors.push(
        diagnostic(
          range,
          "error",
          "adaptive.workspace.invalidRange",
          `Range must satisfy 0 <= from <= to <= ${lastIndex}.`,
        ),
      );
      return errors;
    }
    const span = input.to - input.from + 1;
    if (span > ADAPTIVE_WORKSPACE_MAX_SPAN) {
      errors.push(
        diagnostic(
          range,
          "error",
          "adaptive.workspace.spanTooLarge",
          `A block may cover at most ${ADAPTIVE_WORKSPACE_MAX_SPAN} cues; this one covers ${span}.`,
        ),
      );
    }
    const targets = input.targets.map(normalizeAdaptiveTargetText);
    if (targets.length < 1 || targets.length > ADAPTIVE_WORKSPACE_MAX_TARGETS) {
      errors.push(
        diagnostic(
          range,
          "error",
          "adaptive.workspace.invalidTargetCount",
          `A block needs 1 to ${ADAPTIVE_WORKSPACE_MAX_TARGETS} targets; got ${targets.length}.`,
        ),
      );
    }
    if (targets.some((text) => text.length === 0)) {
      errors.push(
        diagnostic(range, "error", "adaptive.workspace.emptyTarget", "Every target must be non-empty."),
      );
    }
    if (targets.some((text) => text.length > ADAPTIVE_TARGET_TEXT_MAX_LENGTH)) {
      errors.push(
        diagnostic(
          range,
          "error",
          "adaptive.workspace.targetTooLong",
          `Every target must be at most ${ADAPTIVE_TARGET_TEXT_MAX_LENGTH} characters.`,
        ),
      );
    }
    if (locked && (span !== 1 || targets.length !== 1)) {
      errors.push(
        diagnostic(
          range,
          "error",
          "adaptive.workspace.lockedOneToOne",
          "This scene is locked one-to-one: each block must cover exactly one cue with exactly one target.",
        ),
      );
    }
    if (errors.length > 0) return errors;
    const cues = scene.core.slice(input.from, input.to + 1);
    const probe: TranslationBlock = {
      id: `${scene.id}-edit`,
      sceneId: scene.id,
      sourceStart: cues[0]!.sourceIndex,
      sourceEnd: cues.at(-1)!.sourceIndex,
      sourceCueIds: cues.map((cue) => cue.id),
      targetTexts: targets,
      origin: "adaptive",
      semanticFingerprint: "",
    };
    for (const violation of validateAdaptiveBlockPlaceholders(probe, cues)) {
      errors.push(diagnostic(range, "error", violation.code, violation.message));
    }
    return errors;
  };

  const uncovered = (): CueRange[] => {
    const covered = new Set<number>();
    for (const block of blocks) {
      for (let index = block.from; index <= block.to; index += 1) covered.add(index);
    }
    const missing: number[] = [];
    for (let index = 0; index < cueCount; index += 1) {
      if (!covered.has(index)) missing.push(index);
    }
    return rangesOf(missing);
  };

  const toDraft = (): AdaptiveSceneDraft | undefined => {
    if (uncovered().length > 0) return undefined;
    return {
      blocks: blocks.map((block) => ({
        take: block.to - block.from + 1,
        targets: [...block.targets],
      })),
    };
  };

  const toDiagnostic = (
    violation: AdaptiveSubtitleViolation,
    range: CueRange,
  ): WorkspaceDiagnostic =>
    diagnostic(range, violation.severity, violation.code, violation.message);

  const rangeForBlockId = (blockId: string | undefined): CueRange => {
    const match = blockId?.match(/-block-(\d+)$/);
    const block = match ? blocks[Number(match[1])] : undefined;
    return block ? { from: block.from, to: block.to } : whole;
  };

  const check = (): WorkspaceCheck => {
    const errors: WorkspaceDiagnostic[] = [];
    const warnings: WorkspaceDiagnostic[] = [];
    for (const gap of uncovered()) {
      errors.push(
        diagnostic(
          gap,
          "error",
          "adaptive.workspace.uncovered",
          gap.from === gap.to
            ? `Cue ${gap.from} has no translation.`
            : `Cues ${gap.from}-${gap.to} have no translation.`,
        ),
      );
    }
    if (errors.length > 0) return { ok: false, errors, warnings };

    const validation = validateAdaptiveDraft(toDraft()!, scene);
    for (const violation of validation.violations) {
      const item = toDiagnostic(violation, rangeForBlockId(violation.blockId));
      (item.severity === "error" ? errors : warnings).push(item);
    }
    (validation.blocks ?? []).forEach((block, index) => {
      const range = blocks[index] ?? whole;
      const layout = layoutAdaptiveBlock(block, scene.core, options.layoutOptions);
      for (const violation of layout.violations) {
        const item = toDiagnostic(violation, range);
        (item.severity === "error" ? errors : warnings).push(item);
      }
    });
    return { ok: errors.length === 0, errors, warnings };
  };

  const view = (): string => {
    const lines: string[] = [];
    const blockEndingAt = new Map(blocks.map((block) => [block.to, block]));
    const covered = new Set(
      blocks.flatMap((block) =>
        Array.from({ length: block.to - block.from + 1 }, (_, i) => block.from + i),
      ),
    );
    scene.core.forEach((cue, index) => {
      const gap = cue.gapAfterMs === null ? "-" : formatDuration(cue.gapAfterMs);
      lines.push(
        `${index} | ${formatDuration(cue.durationMs)} | gap ${gap} | ${cue.modelText}`,
      );
      const block = blockEndingAt.get(index);
      if (block) {
        const label = block.from === block.to ? `${block.from}` : `${block.from}-${block.to}`;
        lines.push(`  => [${label}] ${block.targets.map((text) => JSON.stringify(text)).join(" / ")}`);
      } else if (!covered.has(index)) {
        lines.push(`  => [${index}] (untranslated)`);
      }
    });
    return lines.join("\n");
  };

  return {
    scene,
    get blocks() {
      return blocks;
    },
    get submitted() {
      return submitted;
    },
    edit(input) {
      const errors = validateEdit(input);
      if (errors.length > 0) return { ok: false, errors };
      const block: WorkspaceBlock = {
        from: input.from,
        to: input.to,
        targets: input.targets.map(normalizeAdaptiveTargetText),
      };
      const removed = blocks.filter((item) => overlaps(item, block));
      const leftover: number[] = [];
      for (const item of removed) {
        for (let index = item.from; index <= item.to; index += 1) {
          if (index < block.from || index > block.to) leftover.push(index);
        }
      }
      blocks = [...blocks.filter((item) => !overlaps(item, block)), block].sort(
        (left, right) => left.from - right.from,
      );
      submitted = false;
      return {
        ok: true,
        block,
        replaced: removed.map((item) => ({ from: item.from, to: item.to })),
        uncovered: rangesOf(leftover),
      };
    },
    view,
    uncovered,
    toDraft,
    check,
    submit() {
      const result = check();
      submitted = result.ok;
      return result;
    },
  };
}
