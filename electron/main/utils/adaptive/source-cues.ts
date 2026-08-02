import { subtitleTimestampToMilliseconds } from "../subtitle-output.ts";
import type {
  AdaptiveModelCue,
  AdaptiveSourceCue,
  AdaptiveSourceCueInput,
  ProtectedToken,
} from "./types.ts";
import { protectSubtitleText, restoreProtectedTokens } from "./protected-tokens.ts";

interface ParsedCueLike {
  type?: string;
  format?: string;
  data?: {
    text?: unknown;
    start?: unknown;
    end?: unknown;
    lockedOneToOne?: unknown;
    multiSpeaker?: unknown;
  };
  text?: unknown;
  start?: unknown;
  end?: unknown;
  lockedOneToOne?: unknown;
  multiSpeaker?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asCueList(value: unknown): ParsedCueLike[] {
  if (Array.isArray(value)) {
    return value.filter((candidate): candidate is ParsedCueLike => {
      if (!isRecord(candidate)) return false;
      if (candidate.type === "header") return false;
      const data = isRecord(candidate.data) ? candidate.data : candidate;
      return (
        typeof data.text === "string" &&
        (typeof data.start === "number" || typeof data.start === "string") &&
        (typeof data.end === "number" || typeof data.end === "string")
      );
    });
  }

  if (isRecord(value) && Array.isArray(value.events)) {
    return asCueList(value.events);
  }

  return [];
}

function cueData(cue: ParsedCueLike): Record<string, unknown> {
  if (isRecord(cue.data)) return cue.data;
  // ParsedCueLike intentionally models only fields we read. Use a structural
  // record for the fallback branch rather than requiring an index signature on
  // every parser node type.
  return cue as unknown as Record<string, unknown>;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
  }
  if (typeof value !== "string") return Number.NaN;
  try {
    return subtitleTimestampToMilliseconds(value);
  } catch {
    // Invalid times are retained as NaN so Scene Builder can make the cue a
    // hard barrier instead of discarding source content or aborting a file.
    return Number.NaN;
  }
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\\[Nn]/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A conservative detector for common two-speaker subtitle conventions. */
export function detectMultiSpeaker(value: string): boolean {
  const lines = value
    .split(/(?:\r\n|\n|\r|\\N|\\n)/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const labelledLines = lines.filter((line) =>
    /^(?:\[[^\]]{1,40}\]|[A-Za-z][A-Za-z0-9 _.'-]{0,38})\s*:\s*\S/.test(
      line
    )
  );
  if (labelledLines.length >= 2) return true;

  // A pair of dash-prefixed dialogue lines is another common format.
  return lines.filter((line) => /^[-–—]\s+\S/.test(line)).length >= 2;
}

export function normalizeSourceCuePlainText(
  originalText: string,
  modelText: string,
  tokens: readonly ProtectedToken[]
): string {
  // Restore only for local analysis; the resulting string never goes to the
  // model and therefore cannot reintroduce untrusted markup into a request.
  const restored = restoreProtectedTokens(modelText, tokens, { validate: false });
  return stripMarkup(restored || originalText);
}

export function buildAdaptiveSourceCue(
  input: AdaptiveSourceCueInput,
  sourceIndex = 0
): AdaptiveSourceCue {
  const originalText = String(input.text);
  const protectedText = protectSubtitleText(originalText);
  const plainText = normalizeSourceCuePlainText(
    originalText,
    protectedText.text,
    protectedText.tokens
  );
  const startMs = parseTimestamp(input.start);
  const endMs = parseTimestamp(input.end);
  const durationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - startMs)
      : 0;

  return {
    id: sourceIndex,
    sourceIndex,
    startMs,
    endMs,
    originalText,
    modelText: protectedText.text,
    plainText,
    durationMs,
    gapAfterMs: null,
    protectedTokens: protectedText.tokens,
    flags: {
      empty: plainText.trim().length === 0,
      overlapping: false,
      multiSpeaker: input.multiSpeaker ?? detectMultiSpeaker(originalText),
      lockedOneToOne: input.lockedOneToOne ?? false,
    },
    ...(input.format ? { format: input.format } : {}),
  };
}

/**
 * Convert parser output to immutable derived source cues. The input is never
 * mutated; translated text fields, when present in legacy checkpoints, are
 * intentionally ignored.
 */
export function buildAdaptiveSourceCues(source: unknown): AdaptiveSourceCue[] {
  const cues = asCueList(source).map((cue, index) => {
    const data = cueData(cue);
    return buildAdaptiveSourceCue(
      {
        text: String(data.text ?? ""),
        start: data.start as number | string,
        end: data.end as number | string,
        ...(typeof data.lockedOneToOne === "boolean"
          ? { lockedOneToOne: data.lockedOneToOne }
          : typeof cue.lockedOneToOne === "boolean"
            ? { lockedOneToOne: cue.lockedOneToOne }
            : {}),
        ...(typeof data.multiSpeaker === "boolean"
          ? { multiSpeaker: data.multiSpeaker }
          : typeof cue.multiSpeaker === "boolean"
            ? { multiSpeaker: cue.multiSpeaker }
            : {}),
        ...(typeof cue.format === "string" ? { format: cue.format } : {}),
      },
      index
    );
  });

  let furthestEnd = Number.NEGATIVE_INFINITY;
  let furthestEndIndex = -1;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const next = cues[index + 1];
    if (!next) {
      cue.gapAfterMs = null;
    } else if (Number.isFinite(cue.endMs) && Number.isFinite(next.startMs)) {
      cue.gapAfterMs = next.startMs - cue.endMs;
    } else {
      cue.gapAfterMs = null;
    }

    if (
      Number.isFinite(cue.startMs) &&
      Number.isFinite(cue.endMs) &&
      cue.startMs < furthestEnd &&
      furthestEndIndex >= 0
    ) {
      cue.flags.overlapping = true;
      cues[furthestEndIndex]!.flags.overlapping = true;
    }
    if (Number.isFinite(cue.endMs) && cue.endMs > furthestEnd) {
      furthestEnd = cue.endMs;
      furthestEndIndex = index;
    }
  }

  return cues;
}

export function toAdaptiveModelCue(
  cue: AdaptiveSourceCue,
  sceneLocalIndex: number
): AdaptiveModelCue {
  return {
    i: sceneLocalIndex,
    d: Number.isFinite(cue.durationMs) ? Math.max(0, Math.round(cue.durationMs)) : 0,
    g: cue.gapAfterMs === null ? null : Math.round(cue.gapAfterMs),
    t: cue.modelText,
  };
}

export function createAdaptiveModelCues(
  cues: readonly AdaptiveSourceCue[]
): AdaptiveModelCue[] {
  return cues.map((cue, index) => toAdaptiveModelCue(cue, index));
}

export const createAdaptiveSourceCues = buildAdaptiveSourceCues;
