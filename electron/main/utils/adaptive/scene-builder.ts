import type {
  AdaptiveScene,
  AdaptiveScenePolicy,
  AdaptiveSourceCue,
} from "./types.ts";
import { adaptiveScenePolicy } from "./types.ts";

export interface CompletedCoverageRange {
  sourceStart: number;
  sourceEnd: number;
}

export interface AdaptiveSceneBuilderOptions {
  contextSize?: number;
  policy?: Partial<AdaptiveScenePolicy>;
  scenePolicy?: Partial<AdaptiveScenePolicy>;
  completedSourceIndices?: ReadonlySet<number> | readonly number[];
  completedCoverage?: readonly CompletedCoverageRange[];
  completedScenes?: readonly CompletedCoverageRange[];
  /** Optional input-format marker used as an additional hard barrier. */
  sourceFormat?: string;
}

function mergePolicy(options: AdaptiveSceneBuilderOptions): AdaptiveScenePolicy {
  return {
    ...adaptiveScenePolicy,
    ...(options.policy ?? options.scenePolicy ?? {}),
  };
}

function normaliseContextSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(0, Math.floor(value as number));
}

function isInvalidTiming(cue: AdaptiveSourceCue): boolean {
  return (
    !Number.isFinite(cue.startMs) ||
    !Number.isFinite(cue.endMs) ||
    cue.endMs <= cue.startMs
  );
}

function isIntrinsicBarrier(cue: AdaptiveSourceCue): boolean {
  return (
    isInvalidTiming(cue) ||
    cue.flags.empty ||
    cue.flags.overlapping ||
    cue.flags.multiSpeaker ||
    cue.flags.lockedOneToOne
  );
}

function hasHardBarrier(
  previous: AdaptiveSourceCue,
  current: AdaptiveSourceCue,
  policy: AdaptiveScenePolicy,
  sourceFormat?: string
): boolean {
  if (isIntrinsicBarrier(previous) || isIntrinsicBarrier(current)) return true;
  if (previous.format !== undefined && current.format !== undefined) {
    if (previous.format !== current.format) return true;
  } else if (sourceFormat && previous.format && previous.format !== sourceFormat) {
    return true;
  }

  const gap = previous.gapAfterMs;
  if (gap === null || !Number.isFinite(gap)) return false;
  return gap < 0 || gap >= policy.hardGapMs;
}

function sourceCharacters(cue: AdaptiveSourceCue): number {
  return Array.from(cue.plainText).length;
}

function buildCharacterPrefix(cues: readonly AdaptiveSourceCue[]): number[] {
  const prefix = new Array<number>(cues.length + 1).fill(0);
  for (let index = 0; index < cues.length; index += 1) {
    prefix[index + 1] = prefix[index] + sourceCharacters(cues[index]);
  }
  return prefix;
}

function exceedsHardBudget(
  cues: readonly AdaptiveSourceCue[],
  start: number,
  endExclusive: number,
  policy: AdaptiveScenePolicy,
  characterPrefix?: readonly number[]
): boolean {
  const count = endExclusive - start;
  if (count > policy.hardMaxCueCount) return true;

  const sourceChars = characterPrefix
    ? characterPrefix[endExclusive] - characterPrefix[start]
    : cues
        .slice(start, endExclusive)
        .reduce((total, cue) => total + sourceCharacters(cue), 0);
  if (sourceChars > policy.hardMaxSourceChars) return true;

  const first = cues[start];
  const last = cues[endExclusive - 1];
  if (
    first &&
    last &&
    Number.isFinite(first.startMs) &&
    Number.isFinite(last.endMs) &&
    last.endMs - first.startMs > policy.hardMaxDurationMs
  ) {
    return true;
  }
  return false;
}

function exceedsPreferredBudget(
  cues: readonly AdaptiveSourceCue[],
  start: number,
  endExclusive: number,
  policy: AdaptiveScenePolicy,
  characterPrefix?: readonly number[]
): boolean {
  if (endExclusive - start > policy.preferredMaxCueCount) return true;

  const sourceChars = characterPrefix
    ? characterPrefix[endExclusive] - characterPrefix[start]
    : cues
        .slice(start, endExclusive)
        .reduce((total, cue) => total + sourceCharacters(cue), 0);
  if (sourceChars > policy.preferredMaxSourceChars) return true;

  const first = cues[start];
  const last = cues[endExclusive - 1];
  return Boolean(
    first &&
      last &&
      Number.isFinite(first.startMs) &&
      Number.isFinite(last.endMs) &&
      last.endMs - first.startMs > policy.preferredMaxDurationMs
  );
}

function boundaryScore(
  cues: readonly AdaptiveSourceCue[],
  index: number,
  policy: AdaptiveScenePolicy
): number {
  const cue = cues[index];
  if (!cue) return Number.NEGATIVE_INFINITY;
  const text = cue.plainText.trim();
  let score = 0;
  if (cue.gapAfterMs !== null && cue.gapAfterMs >= policy.strongGapMs) {
    score += 20;
  }
  if (/[.!?。？！…]$/.test(text)) score += 10;
  if (/[」』”’'\"]$/.test(text)) score += 5;
  if (/[,，、;；:：\-—]$/.test(text)) score -= 10;
  return score;
}

/** Select the best boundary in a bounded hard-budget window. */
function chooseCut(
  cues: readonly AdaptiveSourceCue[],
  start: number,
  endExclusive: number,
  policy: AdaptiveScenePolicy
): number {
  const lastBoundary = endExclusive - 1;
  let bestIndex = lastBoundary;
  let bestScore = Number.NEGATIVE_INFINITY;
  // HardMaxCueCount is intentionally small (28 by default), so this bounded
  // scan keeps the overall builder linear in the subtitle count.
  for (let index = lastBoundary; index >= start; index -= 1) {
    const score = boundaryScore(cues, index, policy);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function completedSet(options: AdaptiveSceneBuilderOptions): Set<number> {
  const result = new Set<number>();
  const indices = options.completedSourceIndices;
  if (indices instanceof Set) {
    for (const index of indices) result.add(index);
  } else if (indices) {
    for (const index of indices) {
      if (Number.isSafeInteger(index)) result.add(index);
    }
  }

  for (const range of [
    ...(options.completedCoverage ?? []),
    ...(options.completedScenes ?? []),
  ]) {
    if (!Number.isSafeInteger(range.sourceStart) || !Number.isSafeInteger(range.sourceEnd)) {
      continue;
    }
    const start = Math.min(range.sourceStart, range.sourceEnd);
    const end = Math.max(range.sourceStart, range.sourceEnd);
    for (let index = start; index <= end; index += 1) result.add(index);
  }
  return result;
}

function createScene(
  allCues: readonly AdaptiveSourceCue[],
  pendingSegment: readonly AdaptiveSourceCue[],
  start: number,
  endExclusive: number,
  contextSize: number,
  positionById: ReadonlyMap<number, number>
): AdaptiveScene | undefined {
  const core = pendingSegment.slice(start, endExclusive);
  if (core.length === 0) return undefined;
  const first = core[0];
  const last = core[core.length - 1];
  const firstAllIndex = positionById.get(first.id) ?? -1;
  const lastAllIndex = positionById.get(last.id) ?? -1;
  const beforeStart = Math.max(0, firstAllIndex - contextSize);
  const afterEnd = Math.min(allCues.length, lastAllIndex + contextSize + 1);

  return {
    id: `scene-${first.sourceIndex}-${last.sourceIndex}`,
    sourceStart: first.sourceIndex,
    sourceEnd: last.sourceIndex,
    core: [...core],
    before: firstAllIndex >= 0 ? allCues.slice(beforeStart, firstAllIndex) : [],
    after:
      lastAllIndex >= 0 ? allCues.slice(lastAllIndex + 1, afterEnd) : [],
    lockedOneToOne:
      core.length === 1 &&
      (core[0].flags.lockedOneToOne ||
        core[0].flags.overlapping ||
        core[0].flags.multiSpeaker ||
        core[0].flags.empty ||
        isInvalidTiming(core[0])),
  };
}

function pushScene(
  scenes: AdaptiveScene[],
  allCues: readonly AdaptiveSourceCue[],
  segment: readonly AdaptiveSourceCue[],
  start: number,
  endExclusive: number,
  contextSize: number,
  positionById: ReadonlyMap<number, number>
): void {
  const scene = createScene(
    allCues,
    segment,
    start,
    endExclusive,
    contextSize,
    positionById
  );
  if (scene) scenes.push(scene);
}

/**
 * Build deterministic, bounded scenes from immutable source cues. Completed
 * coverage is skipped and never crossed by a newly-created scene.
 */
export function buildAdaptiveScenes(
  sourceCues: readonly AdaptiveSourceCue[],
  options: AdaptiveSceneBuilderOptions = {}
): AdaptiveScene[] {
  const policy = mergePolicy(options);
  const contextSize = normaliseContextSize(options.contextSize);
  const completed = completedSet(options);
  const scenes: AdaptiveScene[] = [];

  // Preserve source order even when a caller passes a sparse array. This is a
  // shallow copy only; individual immutable cue objects are never modified.
  const ordered = [...sourceCues];
  const positionById = new Map<number, number>();
  ordered.forEach((cue, index) => positionById.set(cue.id, index));
  let segment: AdaptiveSourceCue[] = [];

  const flushSegment = () => {
    if (segment.length === 0) return;
    let start = 0;
    let index = 0;
    const characterPrefix = buildCharacterPrefix(segment);

    while (index < segment.length) {
      const cue = segment[index];
      const previous = segment[index - 1];

      if (index > start && previous && hasHardBarrier(previous, cue, policy, options.sourceFormat)) {
        pushScene(scenes, ordered, segment, start, index, contextSize, positionById);
        start = index;
        continue;
      }

      if (isIntrinsicBarrier(cue)) {
        if (index > start) {
          pushScene(scenes, ordered, segment, start, index, contextSize, positionById);
        }
        pushScene(
          scenes,
          ordered,
          segment,
          index,
          index + 1,
          contextSize,
          positionById
        );
        start = index + 1;
        index += 1;
        continue;
      }

      if (
        index > start &&
        exceedsHardBudget(segment, start, index + 1, policy, characterPrefix)
      ) {
        const cut = chooseCut(segment, start, index, policy);
        pushScene(
          scenes,
          ordered,
          segment,
          start,
          cut + 1,
          contextSize,
          positionById
        );
        start = cut + 1;
        // Revisit the suffix after the chosen boundary. The scan is bounded by
        // hardMaxCueCount and every cue is emitted at most once per window.
        continue;
      }

      // Once the preferred budget is crossed, honor a strong nearby boundary
      // (gap/sentence punctuation) immediately. If no positive boundary score
      // exists, continue toward the hard budget to avoid cutting mid-sentence.
      if (
        index > start &&
        exceedsPreferredBudget(segment, start, index + 1, policy, characterPrefix)
      ) {
        const cut = chooseCut(segment, start, index, policy);
        if (boundaryScore(segment, cut, policy) > 0) {
          pushScene(
            scenes,
            ordered,
            segment,
            start,
            cut + 1,
            contextSize,
            positionById
          );
          start = cut + 1;
          continue;
        }
      }

      index += 1;
    }

    if (start < segment.length) {
      pushScene(
        scenes,
        ordered,
        segment,
        start,
        segment.length,
        contextSize,
        positionById
      );
    }
    segment = [];
  };

  for (const cue of ordered) {
    if (completed.has(cue.sourceIndex)) {
      flushSegment();
      continue;
    }
    if (segment.length > 0) {
      const previous = segment[segment.length - 1];
      if (hasHardBarrier(previous, cue, policy, options.sourceFormat)) {
        flushSegment();
      }
    }
    segment.push(cue);
    if (isIntrinsicBarrier(cue)) flushSegment();
  }
  flushSegment();

  return scenes;
}

export const buildPendingAdaptiveScenes = buildAdaptiveScenes;
export const buildAdaptiveSceneRanges = buildAdaptiveScenes;
