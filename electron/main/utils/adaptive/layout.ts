import type {
  AdaptiveLayoutOptions,
  AdaptiveSourceCue,
  AdaptiveSubtitleViolation,
  AdaptiveTargetCue,
  TranslationBlock,
} from "./types.ts";
import { defaultAdaptiveLayoutOptions } from "./types.ts";

/**
 * Keep the layout implementation deterministic.  `Intl.Segmenter` is used at
 * grapheme granularity (rather than `String#length`) so surrogate pairs and
 * emoji count as one reading unit.  This is also the reason this module does
 * not use a word splitter for the primary unit calculation: word boundaries
 * are locale-sensitive while grapheme boundaries are stable for our layout
 * thresholds.
 */

const PLACEHOLDER_PATTERN = /__ST_[A-Z]+_\d+__/g;
const SEMANTIC_BREAK_PATTERN = /__ST_BR_\d+__/g;
const WRAP_TOKEN_PATTERN =
  /__ST_[A-Z]+_\d+__|(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|<\/?[A-Za-z][^>]*>/giu;
const CJK_GRAPHEME_PATTERN =
  /[\u1100-\u11ff\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u31a0-\u31bf\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff]/u;
const CJK_BREAK_AFTER_PATTERN = /[\u3001\u3002\uff0c\uff01\uff1f\uff1a\uff1b\u300d\u300f!?;:,.]/u;

type LayoutOptionsWithDefaults = AdaptiveLayoutOptions;

function getSegmenter(): Intl.Segmenter {
  // Node 24 (the project engine) implements Intl.Segmenter.  Keeping the
  // fallback makes this pure helper usable in older test runners as well,
  // without changing the production counting semantics.
  if (typeof Intl.Segmenter === "function") {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  }
  return {
    segment(value: string) {
      return Array.from(value, (segment, index) => ({
        segment,
        index,
        input: value,
      })) as unknown as Intl.Segments;
    },
    resolvedOptions() {
      return { locale: "und", granularity: "grapheme" } as Intl.ResolvedSegmenterOptions;
    },
  } as Intl.Segmenter;
}

function visibleText(value: string): string {
  return value
    // Materialized checkpoints may already have restored protected tokens.
    // Remove those forms as well as placeholder forms so CPS/CPL remains
    // stable across a checkpoint resume and a fresh render.
    .replace(PLACEHOLDER_PATTERN, "")
    .replace(/<[^>]*>/g, "")
    .replace(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()]+/giu, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "")
    .replace(/\\[Nn]/g, "")
    .replace(/[\t\r\n ]+/g, "")
    .trim();
}

function graphemes(value: string): string[] {
  return Array.from(getSegmenter().segment(value), (item) => item.segment);
}

function unitCount(value: string): number {
  return graphemes(visibleText(value)).length;
}

/** Count visible grapheme clusters, excluding whitespace and protected tokens. */
export function countReadingUnits(text: string): number {
  return unitCount(text);
}

/** Return the profile used to choose CJK/Latin layout thresholds. */
export function detectTextLayoutProfile(text: string): "cjk" | "latin" {
  const visible = graphemes(visibleText(text));
  if (visible.length === 0) return "latin";
  const cjkCount = visible.reduce(
    (count, grapheme) => count + (CJK_GRAPHEME_PATTERN.test(grapheme) ? 1 : 0),
    0,
  );
  return cjkCount / visible.length >= 0.35 ? "cjk" : "latin";
}

function optionsWithDefaults(
  options?: Partial<AdaptiveLayoutOptions>,
): LayoutOptionsWithDefaults {
  return { ...defaultAdaptiveLayoutOptions, ...(options ?? {}) };
}

function violation(
  code: string,
  severity: "warning" | "error",
  message: string,
  details?: Record<string, string | number | boolean | null>,
): AdaptiveSubtitleViolation {
  return { code, severity, message, ...(details ? { details } : {}) };
}

function isPlaceholder(value: string): boolean {
  return /^__ST_[A-Z]+_\d+__$/.test(value);
}

interface PlaceholderToken {
  key: string;
  value: string;
}

/** Replace placeholders with private-use sentinels while wrapping text. */
function protectForWrap(value: string): {
  text: string;
  placeholders: PlaceholderToken[];
} {
  const placeholders: PlaceholderToken[] = [];
  let index = 0;
  const text = value.replace(WRAP_TOKEN_PATTERN, (placeholder) => {
    const key = String.fromCodePoint(0xe000 + index);
    index += 1;
    placeholders.push({ key, value: placeholder });
    return key;
  });
  return { text, placeholders };
}

function restoreWrapPlaceholders(
  value: string,
  placeholders: readonly PlaceholderToken[],
): string {
  let result = value;
  for (const placeholder of placeholders) {
    result = result.replaceAll(placeholder.key, placeholder.value);
  }
  return result;
}

function countLineUnits(value: string): number {
  return unitCount(value);
}

function trimLine(value: string): string {
  // Trimming only horizontal whitespace is intentional: newline is a hard
  // break and is represented by the line array, not by a line's content.
  return value.replace(/^[\t ]+|[\t ]+$/g, "");
}

function boundaryCandidates(value: string): number[] {
  const units = graphemes(value);
  const result: number[] = [];
  for (let index = 1; index < units.length; index += 1) {
    const previous = units[index - 1] ?? "";
    const current = units[index] ?? "";
    if (/\s/u.test(previous) || CJK_BREAK_AFTER_PATTERN.test(previous)) {
      result.push(index);
      continue;
    }
    // Keep punctuation with the following CJK text when a sentence starts
    // with punctuation, but allow a fallback split at any grapheme boundary.
    if (CJK_BREAK_AFTER_PATTERN.test(current) && /[\u4e00-\u9fff]/u.test(previous)) {
      result.push(index);
    }
  }
  return result;
}

function chooseBalancedBreak(value: string, maxUnits: number): number | undefined {
  const units = graphemes(value);
  if (units.length < 2) return undefined;

  const candidates = boundaryCandidates(value);
  const allCandidates = candidates.length
    ? candidates
    : Array.from({ length: units.length - 1 }, (_, index) => index + 1);

  let best: { index: number; score: [number, number, number] } | undefined;
  const total = units.length;
  for (const index of allCandidates) {
    const left = units.slice(0, index).join("");
    const right = units.slice(index).join("");
    const leftUnits = countLineUnits(left);
    const rightUnits = countLineUnits(right);
    const maxOver = Math.max(0, leftUnits - maxUnits, rightUnits - maxUnits);
    const imbalance = Math.abs(leftUnits - rightUnits);
    const distance = Math.abs(index - total / 2);
    const score: [number, number, number] = [maxOver, imbalance, distance];
    if (
      !best ||
      score[0] < best.score[0] ||
      (score[0] === best.score[0] && score[1] < best.score[1]) ||
      (score[0] === best.score[0] &&
        score[1] === best.score[1] &&
        score[2] < best.score[2])
    ) {
      best = { index, score };
    }
  }
  return best?.index;
}

function wrapSingleHardLine(value: string, maxUnits: number): string[] {
  const trimmed = trimLine(value);
  if (trimmed.length === 0) return [""];
  if (countLineUnits(trimmed) <= maxUnits) return [trimmed];

  const split = chooseBalancedBreak(trimmed, maxUnits);
  if (split === undefined) return [trimmed];

  const units = graphemes(trimmed);
  const left = trimLine(units.slice(0, split).join(""));
  const right = trimLine(units.slice(split).join(""));
  return [left, right];
}

/**
 * Deterministically wrap subtitle text without ever dropping content.
 * Placeholders remain atomic and `__ST_BR_N__` is a hard line break.
 */
export function wrapSubtitleText(
  text: string,
  options: Partial<AdaptiveLayoutOptions> = {},
): {
  renderedText: string;
  lineCount: number;
  warnings: AdaptiveSubtitleViolation[];
} {
  const resolved = optionsWithDefaults(options);
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  // The semantic line-break placeholder is a hard break rather than visible
  // text.  Expand it before token protection so it cannot be split.
  const withSemanticBreaks = normalized
    .replace(SEMANTIC_BREAK_PATTERN, "\n")
    .replace(/<br\b[^>]*\/?\s*>/giu, "\n")
    .replace(/\\[Nn]/g, "\n");
  const { text: protectedText, placeholders } = protectForWrap(withSemanticBreaks);
  const withHardBreaks = protectedText;
  const hardLines = withHardBreaks.split("\n");
  const profile = detectTextLayoutProfile(normalized);
  const maxUnits =
    profile === "cjk" ? resolved.maxLineUnitsCjk : resolved.maxLineUnitsLatin;

  const lines: string[] = [];
  for (const hardLine of hardLines) {
    const wrapped = wrapSingleHardLine(hardLine, Math.max(1, maxUnits));
    lines.push(...wrapped);
  }

  const restoredLines = lines.map((line) =>
    restoreWrapPlaceholders(trimLine(line), placeholders),
  );
  const renderedText = restoredLines.join("\n");
  const warnings: AdaptiveSubtitleViolation[] = [];

  if (restoredLines.length > resolved.maxLines) {
    warnings.push(
      violation(
        "adaptive.layout.tooManyLines",
        "warning",
        `Subtitle requires ${restoredLines.length} lines; maximum is ${resolved.maxLines}.`,
        { lineCount: restoredLines.length, maxLines: resolved.maxLines },
      ),
    );
  }

  const maxObservedUnits = Math.max(0, ...restoredLines.map(countLineUnits));
  if (maxObservedUnits > maxUnits) {
    warnings.push(
      violation(
        "adaptive.layout.lineTooLong",
        "warning",
        `Subtitle line contains ${maxObservedUnits} reading units; maximum is ${maxUnits}.`,
        { lineUnits: maxObservedUnits, maxLineUnits: maxUnits },
      ),
    );
  }

  return { renderedText, lineCount: restoredLines.length, warnings };
}

function durationAndCps(
  text: string,
  startMs: number,
  endMs: number,
): { durationMs: number; cps: number } {
  const durationMs = Math.max(0, endMs - startMs);
  const cps = durationMs > 0 ? (countReadingUnits(text) * 1000) / durationMs : Infinity;
  return { durationMs, cps };
}

function targetCpsThresholds(
  text: string,
  options: LayoutOptionsWithDefaults,
): { soft: number; hard: number } {
  return detectTextLayoutProfile(text) === "cjk"
    ? { soft: options.softMaxCpsCjk, hard: options.hardMaxCpsCjk }
    : { soft: options.softMaxCpsLatin, hard: options.hardMaxCpsLatin };
}

function canUseDirectBoundaries(
  targetTexts: readonly string[],
  sourceCues: readonly AdaptiveSourceCue[],
  options: LayoutOptionsWithDefaults,
): boolean {
  if (targetTexts.length !== sourceCues.length || sourceCues.length === 0) {
    return false;
  }
  for (let index = 1; index < sourceCues.length; index += 1) {
    const previous = sourceCues[index - 1];
    const current = sourceCues[index];
    if (previous && current && current.startMs < previous.endMs) return false;
  }
  for (let index = 0; index < targetTexts.length; index += 1) {
    const cue = sourceCues[index];
    const text = targetTexts[index] ?? "";
    const { durationMs, cps } = durationAndCps(text, cue.startMs, cue.endMs);
    const thresholds = targetCpsThresholds(text, options);
    if (cue.startMs >= cue.endMs || durationMs < options.minCueDurationMs || cps > thresholds.hard) {
      return false;
    }
  }
  return true;
}

function mergeText(left: string, right: string): string {
  const separator =
    detectTextLayoutProfile(`${left}${right}`) === "cjk" ||
    /[\u4e00-\u9fff]$/u.test(left.trim()) ||
    /^[\u4e00-\u9fff]/u.test(right.trim())
      ? ""
      : " ";
  return `${left.trim()}${separator}${right.trim()}`.trim();
}

function mergeShortestAdjacent(targets: readonly string[]): string[] {
  if (targets.length <= 1) return [...targets];
  let pairIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < targets.length - 1; index += 1) {
    const score = Math.min(countReadingUnits(targets[index]), countReadingUnits(targets[index + 1]));
    if (score < bestScore) {
      bestScore = score;
      pairIndex = index;
    }
  }
  const merged = [...targets];
  const left = merged[pairIndex] ?? "";
  const right = merged[pairIndex + 1] ?? "";
  merged.splice(pairIndex, 2, mergeText(left, right));
  return merged;
}

function allocateWeightedDurations(
  count: number,
  blockStart: number,
  blockEnd: number,
  targets: readonly string[],
  minCueDurationMs: number,
): number[] {
  const duration = Math.max(0, Math.floor(blockEnd - blockStart));
  if (count <= 0) return [];
  const weights = targets.map((target) => Math.max(1, countReadingUnits(target)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const minimumTotal = count * minCueDurationMs;
  const durations = new Array<number>(count).fill(0);

  if (duration >= minimumTotal) {
    const remainder = duration - minimumTotal;
    let allocated = 0;
    const fractions = weights.map((weight, index) => {
      const exact = (remainder * weight) / weightTotal;
      const base = Math.floor(exact);
      durations[index] = minCueDurationMs + base;
      allocated += base;
      return { index, fraction: exact - base };
    });
    fractions.sort((left, right) => left.index - right.index);
    fractions.sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (let index = 0; index < remainder - allocated; index += 1) {
      const target = fractions[index % fractions.length];
      if (target) durations[target.index] += 1;
    }
    return durations;
  }

  // The caller should merge targets before reaching this branch.  Keep every
  // cue strictly positive as a final defensive measure; the resulting
  // insufficient-duration violation explains why the minimum could not hold.
  const positive = Math.max(1, Math.floor(duration / count));
  durations.fill(positive);
  let excess = durations.reduce((sum, value) => sum + value, 0) - duration;
  for (let index = durations.length - 1; index >= 0 && excess > 0; index -= 1) {
    const removable = Math.max(0, durations[index] - 1);
    const amount = Math.min(removable, excess);
    durations[index] -= amount;
    excess -= amount;
  }
  return durations;
}

function snapBoundaries(
  starts: number[],
  ends: number[],
  sourceCues: readonly AdaptiveSourceCue[],
  blockStart: number,
  blockEnd: number,
  options: LayoutOptionsWithDefaults,
): void {
  if (starts.length <= 1) return;
  const candidates = sourceCues
    .slice(0, -1)
    .map((cue) => cue.endMs)
    .filter((time) => time > blockStart && time < blockEnd);
  for (let index = 0; index < ends.length - 1; index += 1) {
    const current = ends[index];
    let nearest: number | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const candidateDistance = Math.abs(candidate - current);
      if (
        candidateDistance <= options.boundarySnapToleranceMs &&
        candidateDistance < distance &&
        candidate > (index === 0 ? blockStart : starts[index]) &&
        candidate < (index + 1 === ends.length - 1 ? blockEnd : ends[index + 1])
      ) {
        nearest = candidate;
        distance = candidateDistance;
      }
    }
    if (nearest === undefined) continue;
    const previousStart = index === 0 ? blockStart : starts[index];
    const nextEnd = index + 1 === ends.length - 1 ? blockEnd : ends[index + 1];
    if (
      nearest - previousStart >= options.minCueDurationMs &&
      nextEnd - nearest >= options.minCueDurationMs
    ) {
      ends[index] = nearest;
      starts[index + 1] = nearest;
    }
  }
}

function sourceCueFromBlock(
  block: TranslationBlock,
  sourceCues: readonly AdaptiveSourceCue[],
): AdaptiveSourceCue[] {
  const byId = new Map(sourceCues.map((cue) => [cue.id, cue]));
  return block.sourceCueIds
    .map((id) => byId.get(id))
    .filter((cue): cue is AdaptiveSourceCue => cue !== undefined);
}

export interface LayoutBlockResult {
  targetCues: AdaptiveTargetCue[];
  violations: AdaptiveSubtitleViolation[];
  targetTexts: string[];
}

/** Layout one materialized translation block into deterministic target cues. */
export function layoutAdaptiveBlock(
  block: TranslationBlock,
  sourceCues: readonly AdaptiveSourceCue[],
  options: Partial<AdaptiveLayoutOptions> = {},
): LayoutBlockResult {
  const resolved = optionsWithDefaults(options);
  const blockCues = sourceCueFromBlock(block, sourceCues);
  const violations: AdaptiveSubtitleViolation[] = [];
  if (blockCues.length === 0 || block.sourceCueIds.length !== blockCues.length) {
    violations.push(
      violation(
        "adaptive.layout.missingSourceCue",
        "error",
        "Translation block references a source cue that is not available.",
      ),
    );
    return { targetCues: [], violations, targetTexts: [...block.targetTexts] };
  }

  const blockStart = blockCues[0]?.startMs ?? 0;
  const blockEnd = blockCues[blockCues.length - 1]?.endMs ?? blockStart;
  let targetTexts = block.targetTexts.map((text) => String(text));

  if (targetTexts.length === 0) {
    violations.push(
      violation(
        "adaptive.layout.emptyTarget",
        "error",
        "Translation block has no target text.",
      ),
    );
    return { targetCues: [], violations, targetTexts };
  }

  while (
    targetTexts.length > 1 &&
    (blockEnd - blockStart < targetTexts.length * resolved.minCueDurationMs ||
      blockEnd - blockStart < targetTexts.length)
  ) {
    targetTexts = mergeShortestAdjacent(targetTexts);
  }

  const direct = canUseDirectBoundaries(targetTexts, blockCues, resolved);
  let starts: number[];
  let ends: number[];
  if (direct) {
    starts = blockCues.map((cue) => Math.floor(cue.startMs));
    ends = blockCues.map((cue) => Math.floor(cue.endMs));
  } else {
    const durations = allocateWeightedDurations(
      targetTexts.length,
      blockStart,
      blockEnd,
      targetTexts,
      resolved.minCueDurationMs,
    );
    starts = [];
    ends = [];
    let cursor = Math.floor(blockStart);
    for (const duration of durations) {
      starts.push(cursor);
      cursor += duration;
      ends.push(cursor);
    }
    if (ends.length > 0) ends[ends.length - 1] = Math.floor(blockEnd);
    if (starts.length > 1) starts[0] = Math.floor(blockStart);
    snapBoundaries(starts, ends, blockCues, blockStart, blockEnd, resolved);
  }

  if (blockEnd - blockStart < targetTexts.length * resolved.minCueDurationMs) {
    violations.push(
      violation(
        "adaptive.layout.insufficientDuration",
        "error",
        "Source block duration is too short for the target cue count.",
        {
          blockDurationMs: Math.max(0, blockEnd - blockStart),
          targetCount: targetTexts.length,
          minCueDurationMs: resolved.minCueDurationMs,
        },
      ),
    );
  }

  const targetCues: AdaptiveTargetCue[] = [];
  for (let index = 0; index < targetTexts.length; index += 1) {
    const semanticText = targetTexts[index] ?? "";
    const startMs = starts[index] ?? blockStart;
    const endMs = ends[index] ?? startMs;
    const cueViolations: AdaptiveSubtitleViolation[] = [];
    if (!(startMs < endMs)) {
      cueViolations.push(
        violation(
          "adaptive.layout.invalidDuration",
          "error",
          "Target cue must have a positive duration.",
          { startMs, endMs },
        ),
      );
    }
    if (startMs < blockStart || endMs > blockEnd) {
      cueViolations.push(
        violation(
          "adaptive.layout.outOfBounds",
          "error",
          "Target cue exceeds its source block span.",
          { startMs, endMs, blockStart, blockEnd },
        ),
      );
    }
    const { durationMs, cps } = durationAndCps(semanticText, startMs, endMs);
    const thresholds = targetCpsThresholds(semanticText, resolved);
    if (cps > thresholds.soft) {
      cueViolations.push(
        violation(
          cps > thresholds.hard
            ? "adaptive.layout.hardCpsExceeded"
            : "adaptive.layout.softCpsExceeded",
          cps > thresholds.hard ? "error" : "warning",
          `Target cue CPS is ${cps.toFixed(2)}; soft limit is ${thresholds.soft}.`,
          { cps, softCps: thresholds.soft, hardCps: thresholds.hard, durationMs },
        ),
      );
    }
    const wrapped = wrapSubtitleText(semanticText, resolved);
    cueViolations.push(...wrapped.warnings);
    const targetCue: AdaptiveTargetCue = {
      id: `${block.id}-target-${index}`,
      blockId: block.id,
      sourceStart: block.sourceStart,
      sourceEnd: block.sourceEnd,
      sourceCueIds: [...block.sourceCueIds],
      startMs,
      endMs,
      semanticText,
      renderedText: wrapped.renderedText,
      warnings: cueViolations,
    };
    targetCues.push(targetCue);
    violations.push(...cueViolations);
  }

  // A final monotonicity check catches accidental snap/allocation regressions.
  for (let index = 1; index < targetCues.length; index += 1) {
    const previous = targetCues[index - 1];
    const current = targetCues[index];
    if (previous && current && current.startMs < previous.endMs) {
      violations.push(
        violation(
          "adaptive.layout.overlap",
          "error",
          "Target cues must not overlap.",
          { previousEndMs: previous.endMs, startMs: current.startMs },
        ),
      );
    }
  }
  return { targetCues, violations, targetTexts };
}

/** Alias retained for callers that describe this operation as allocation. */
export const allocateTargetTimings = layoutAdaptiveBlock;
export const layoutTranslationBlock = layoutAdaptiveBlock;
export const allocateTargetCueTimings = layoutAdaptiveBlock;
export const layoutBlock = layoutAdaptiveBlock;
export const createAdaptiveTargetCues = layoutAdaptiveBlock;

/** Validate an already-rendered cue against layout thresholds. */
export function validateAdaptiveTargetCue(
  cue: Pick<AdaptiveTargetCue, "semanticText" | "renderedText" | "startMs" | "endMs">,
  options: Partial<AdaptiveLayoutOptions> = {},
): AdaptiveSubtitleViolation[] {
  const resolved = optionsWithDefaults(options);
  const warnings: AdaptiveSubtitleViolation[] = [];
  const wrapped = wrapSubtitleText(cue.semanticText, resolved);
  if (wrapped.renderedText !== cue.renderedText) {
    warnings.push(
      violation(
        "adaptive.layout.renderedTextMismatch",
        "error",
        "Rendered text does not match deterministic line wrapping.",
      ),
    );
  }
  const { cps } = durationAndCps(cue.semanticText, cue.startMs, cue.endMs);
  const thresholds = targetCpsThresholds(cue.semanticText, resolved);
  if (cps > thresholds.soft) {
    warnings.push(
      violation(
        cps > thresholds.hard
          ? "adaptive.layout.hardCpsExceeded"
          : "adaptive.layout.softCpsExceeded",
        cps > thresholds.hard ? "error" : "warning",
        `Target cue CPS is ${cps.toFixed(2)}; soft limit is ${thresholds.soft}.`,
        { cps, softCps: thresholds.soft, hardCps: thresholds.hard },
      ),
    );
  }
  return warnings;
}
