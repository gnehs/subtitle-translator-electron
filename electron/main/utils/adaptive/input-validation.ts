import { translationErrorCodes } from "../../../shared/translation-error-codes.ts";
import type { SubtitleOutputFormat } from "../subtitle-output.ts";

export interface AdaptiveInputValidationInput {
  extension: string;
  outputFormat: SubtitleOutputFormat;
  checkpointHeader?: {
    version?: unknown;
    kind?: unknown;
    format?: unknown;
  };
}

/**
 * Return a stable product error code when an input cannot enter the Adaptive
 * pipeline. This helper deliberately only inspects already parsed metadata;
 * file I/O and full checkpoint schema validation remain in the main process.
 */
export function getAdaptiveInputValidationError({
  extension,
  outputFormat,
  checkpointHeader,
}: AdaptiveInputValidationInput): string | undefined {
  if (outputFormat !== "srt-translation") {
    return translationErrorCodes.adaptiveUnsupportedOutputFormat;
  }

  const normalizedExtension = extension.trim().toLowerCase();
  if (normalizedExtension === "srt" || normalizedExtension === "vtt") {
    return undefined;
  }

  if (normalizedExtension !== "json") {
    return translationErrorCodes.adaptiveUnsupportedInputFormat;
  }

  if (
    checkpointHeader?.version !== 3 ||
    checkpointHeader.kind !== "adaptive"
  ) {
    return translationErrorCodes.adaptiveIncompatibleCheckpoint;
  }

  return checkpointHeader.format === "srt" || checkpointHeader.format === "vtt"
    ? undefined
    : translationErrorCodes.adaptiveUnsupportedInputFormat;
}

export function assertAdaptiveInputValidation(
  input: AdaptiveInputValidationInput
): void {
  const errorCode = getAdaptiveInputValidationError(input);
  if (errorCode) throw new Error(errorCode);
}
