import type { SubtitleCuePreview } from "../../../src/types/electron-api";
import type { SubtitleCue } from "./translate";

const savedSubtitleSeparators = ["\r\n", "\n", "\\N", "\\n"] as const;

/** Recover the translation portion from a cue saved in bilingual mode. */
export function getTranslatedPreviewText(
  savedText: string,
  originalText: string
): string {
  if (!savedText || !originalText || savedText === originalText) {
    return savedText;
  }

  for (const separator of savedSubtitleSeparators) {
    const originalFirst = `${originalText}${separator}`;
    if (savedText.startsWith(originalFirst)) {
      return savedText.slice(originalFirst.length);
    }

    const originalLast = `${separator}${originalText}`;
    if (savedText.endsWith(originalLast)) {
      return savedText.slice(0, -originalLast.length);
    }
  }

  return savedText;
}

export function createSubtitlePreview(
  subtitle: SubtitleCue[],
  translatedSubtitle?: SubtitleCue[]
): SubtitleCuePreview[] {
  const translatedCuesArray = translatedSubtitle?.map(
    (cue) => cue.data.translatedText || cue.data.text
  );

  return subtitle.map((cue, index) => {
    // Translation and checkpoint writes preserve cue order. Sequential
    // alignment also keeps distinct cues that intentionally share timestamps.
    const savedTranslation = translatedCuesArray?.[index];
    return {
      text: cue.data.text,
      translatedText:
        typeof savedTranslation === "string"
          ? getTranslatedPreviewText(savedTranslation, cue.data.text)
          : undefined,
      start: cue.data.start,
      end: cue.data.end,
    };
  });
}
