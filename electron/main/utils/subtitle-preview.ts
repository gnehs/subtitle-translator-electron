import type {
  AdaptiveSubtitleCuePreview,
  SubtitleCuePreview,
} from "../../../src/types/electron-api";
import type { ParsedSubtitle, SubtitleCue } from "./translate.ts";
import { renderAdaptiveSrt } from "./adaptive/renderer.ts";
import type {
  AdaptiveCheckpointScene,
  AdaptiveLayoutOptions,
} from "./adaptive/types";

const savedSubtitleSeparators = ["\r\n", "\n", "\\N", "\\n"] as const;

function isSubtitleCue(value: unknown): value is SubtitleCue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const data = record.data;
  return (
    record.type === "cue" &&
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).text === "string"
  );
}

function getSourceCues(source: ParsedSubtitle): SubtitleCue[] {
  return Array.isArray(source)
    ? source.filter(isSubtitleCue)
    : source.events.filter(isSubtitleCue);
}

function toPlainAssText(value: string): string {
  return value
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

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

  const plainSavedText = toPlainAssText(savedText);
  const plainOriginalText = toPlainAssText(originalText);
  if (
    plainSavedText !== savedText ||
    plainOriginalText !== originalText
  ) {
    for (const separator of ["\r\n", "\n"] as const) {
      const originalFirst = `${plainOriginalText}${separator}`;
      if (plainSavedText.startsWith(originalFirst)) {
        return plainSavedText.slice(originalFirst.length);
      }

      const originalLast = `${separator}${plainOriginalText}`;
      if (plainSavedText.endsWith(originalLast)) {
        return plainSavedText.slice(0, -originalLast.length);
      }
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
      kind: "strict" as const,
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

/**
 * Materialize Adaptive checkpoint blocks into the discriminated preview shape
 * consumed by the renderer. Source ranges stay zero-based internally so the
 * UI can format them as user-facing cue numbers without losing provenance.
 */
export function createAdaptiveSubtitlePreview(
  source: ParsedSubtitle,
  scenes: readonly AdaptiveCheckpointScene[],
  layoutOptions: Partial<AdaptiveLayoutOptions> = {},
): AdaptiveSubtitleCuePreview[] {
  // Pending/error scenes may contain stale blocks from an interrupted older
  // attempt. Only committed scene results are eligible for preview.
  const completedScenes = scenes.filter((scene) => scene.status === "done");
  const rendered = renderAdaptiveSrt(source, completedScenes, layoutOptions);
  const sourceCues = getSourceCues(source);
  const blockOrigins = new Map<string, AdaptiveSubtitleCuePreview["origin"]>();
  for (const scene of completedScenes) {
    for (const block of scene.blocks ?? []) {
      blockOrigins.set(block.id, block.origin);
    }
  }

  return rendered.targetCues.map((cue) => ({
    kind: "adaptive",
    targetText: cue.renderedText,
    sourceStart: cue.sourceStart,
    sourceEnd: cue.sourceEnd,
    sourceTexts: cue.sourceCueIds.map(
      (sourceId) => sourceCues[sourceId]?.data.text ?? "",
    ),
    start: cue.startMs,
    end: cue.endMs,
    origin: blockOrigins.get(cue.blockId) ?? "adaptive",
    warnings: cue.warnings,
  }));
}
