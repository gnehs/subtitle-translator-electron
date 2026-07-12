interface TranslatableSubtitleCue {
  data: {
    text: string;
    translatedText?: string;
  };
}

export function isSubtitleCueComplete(
  cue: TranslatableSubtitleCue
): boolean {
  return (
    cue.data.text.trim().length === 0 ||
    (typeof cue.data.translatedText === "string" &&
      cue.data.translatedText.trim().length > 0)
  );
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
