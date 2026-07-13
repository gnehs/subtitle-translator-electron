interface TranslatableSubtitleCue {
  data: {
    text: string;
    translatedText?: string;
  };
}

const MIN_REPETITION_COUNT = 16;
const MAX_REPETITION_PATTERN_LENGTH = 3;
const MAX_REPETITION_PREVIEW_COUNT = 3;

export function isSubtitleCueComplete(
  cue: TranslatableSubtitleCue
): boolean {
  return (
    cue.data.text.trim().length === 0 ||
    (typeof cue.data.translatedText === "string" &&
      cue.data.translatedText.trim().length > 0)
  );
}

/**
 * Keep pathological repeated subtitle text from consuming the whole model
 * context or output budget while retaining enough source text to translate it
 * naturally. Only exact short-token cycles are compacted.
 */
export function compactRepetitiveSubtitleText(text: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const tokens = normalizedText.split(" ").filter(Boolean);
  if (tokens.length < MIN_REPETITION_COUNT) return normalizedText;

  for (
    let patternLength = 1;
    patternLength <= MAX_REPETITION_PATTERN_LENGTH;
    patternLength++
  ) {
    if (tokens.length % patternLength !== 0) continue;

    const repetitionCount = tokens.length / patternLength;
    if (repetitionCount < MIN_REPETITION_COUNT) continue;

    const pattern = tokens.slice(0, patternLength);
    const isExactCycle = tokens.every(
      (token, index) => token === pattern[index % patternLength]
    );
    if (!isExactCycle) continue;

    const previewCount = Math.min(
      MAX_REPETITION_PREVIEW_COUNT,
      repetitionCount
    );
    const preview = Array.from({ length: previewCount }, () =>
      pattern.join(" ")
    ).join(" ");
    return `${preview} … [source phrase repeats ${repetitionCount} times total]`;
  }

  return normalizedText;
}

/** Split only contiguous untranslated regions into bounded request chunks. */
export function splitIntoChunk<T extends TranslatableSubtitleCue>(
  cues: readonly T[],
  requestedChunkSize = 5
): T[][] {
  const chunkSize = Number.isFinite(requestedChunkSize)
    ? Math.max(1, Math.floor(requestedChunkSize))
    : 5;
  const chunks: T[][] = [];
  let chunk: T[] = [];

  const flushChunk = () => {
    if (chunk.length === 0) return;
    chunks.push(chunk);
    chunk = [];
  };

  for (const cue of cues) {
    if (isSubtitleCueComplete(cue)) {
      flushChunk();
      continue;
    }

    chunk.push(cue);
    if (chunk.length === chunkSize) flushChunk();
  }

  flushChunk();
  return chunks;
}
