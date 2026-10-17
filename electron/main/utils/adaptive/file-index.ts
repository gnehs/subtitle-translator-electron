import type { AdaptiveSourceCue } from "./types.ts";

export const ADAPTIVE_FILE_READ_MAX_CUES = 40;
export const ADAPTIVE_FILE_SEARCH_MAX_HITS = 20;

export interface FileCueView {
  /** Global cue index across the whole file. */
  index: number;
  text: string;
  translation?: string;
}

export interface FileReadResult {
  cues: FileCueView[];
  /** True when the requested range was cut at the read cap. */
  truncated: boolean;
}

/** Read-only view over the whole file so a scene agent can look beyond its window. */
export interface AdaptiveFileIndex {
  readonly cueCount: number;
  search(query: string, limit?: number): FileCueView[];
  read(from: number, to: number): FileReadResult;
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function createAdaptiveFileIndex(
  cues: readonly AdaptiveSourceCue[],
  lookupTranslation: (cueId: number) => string | undefined = () => undefined,
): AdaptiveFileIndex {
  const ordered = [...cues].sort((left, right) => left.id - right.id);
  const toView = (cue: AdaptiveSourceCue): FileCueView => {
    const translation = lookupTranslation(cue.id);
    return {
      index: cue.id,
      text: cue.plainText || cue.originalText,
      ...(translation !== undefined ? { translation } : {}),
    };
  };
  return {
    cueCount: ordered.length,
    search(query, limit = ADAPTIVE_FILE_SEARCH_MAX_HITS) {
      const needle = normalizeForMatch(query.trim());
      if (needle.length === 0) return [];
      const cap = clampInt(limit, 1, ADAPTIVE_FILE_SEARCH_MAX_HITS);
      const hits: FileCueView[] = [];
      for (const cue of ordered) {
        if (hits.length >= cap) break;
        if (normalizeForMatch(cue.plainText || cue.originalText).includes(needle)) {
          hits.push(toView(cue));
        }
      }
      return hits;
    },
    read(from, to) {
      if (ordered.length === 0) return { cues: [], truncated: false };
      const last = ordered.at(-1)!.id;
      const start = clampInt(from, 0, last);
      const requestedEnd = clampInt(to, start, last);
      const end = Math.min(requestedEnd, start + ADAPTIVE_FILE_READ_MAX_CUES - 1);
      return {
        cues: ordered.filter((cue) => cue.id >= start && cue.id <= end).map(toView),
        truncated: end < requestedEnd,
      };
    },
  };
}
