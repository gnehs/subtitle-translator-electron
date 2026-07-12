export interface AnalysisSampleOptions {
  maxCharacters?: number;
  maxLines?: number;
}

const defaultOptions = {
  maxCharacters: 12_000,
  maxLines: 240,
} as const;

function getEvenlySpacedSample(
  subtitles: readonly string[],
  sampleSize: number
): string[] {
  if (sampleSize === 1) {
    return [subtitles[Math.floor((subtitles.length - 1) / 2)]];
  }

  const lastIndex = subtitles.length - 1;
  return Array.from({ length: sampleSize }, (_, index) =>
    subtitles[Math.round((index * lastIndex) / (sampleSize - 1))]
  );
}

function getJoinedCharacterCount(lines: string[]): number {
  return lines.reduce(
    (total, line, index) => total + line.length + (index === 0 ? 0 : 1),
    0
  );
}

/** Select a deterministic sample spread across the subtitle timeline. */
export function sampleSubtitlesForAnalysis(
  subtitles: readonly string[],
  {
    maxCharacters = defaultOptions.maxCharacters,
    maxLines = defaultOptions.maxLines,
  }: AnalysisSampleOptions = {}
): string[] {
  const characterBudget = Number.isFinite(maxCharacters)
    ? Math.max(0, Math.floor(maxCharacters))
    : 0;
  const lineBudget = Number.isFinite(maxLines)
    ? Math.max(0, Math.floor(maxLines))
    : 0;

  if (characterBudget === 0 || lineBudget === 0) return [];

  const normalizedSubtitles = subtitles
    .map((subtitle) => subtitle.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (normalizedSubtitles.length === 0) return [];

  let sampleSize = Math.min(lineBudget, normalizedSubtitles.length);
  let sample = getEvenlySpacedSample(normalizedSubtitles, sampleSize);
  let characterCount = getJoinedCharacterCount(sample);

  while (characterCount > characterBudget && sampleSize > 1) {
    sampleSize -= 1;
    sample = getEvenlySpacedSample(normalizedSubtitles, sampleSize);
    characterCount = getJoinedCharacterCount(sample);
  }

  if (characterCount <= characterBudget) return sample;
  return [sample[0].slice(0, characterBudget).trimEnd()].filter(Boolean);
}
