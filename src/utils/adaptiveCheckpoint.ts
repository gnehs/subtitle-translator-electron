/**
 * Metadata read from a translation checkpoint before it enters the main
 * process.  The UI intentionally keeps this structural so it can reject an
 * incompatible file when the user switches modes without trusting arbitrary
 * JSON as a valid checkpoint.
 */
export interface AdaptiveCheckpointHeader {
  version?: unknown;
  kind?: unknown;
  format?: unknown;
}

/**
 * Adaptive mode can resume only its v3 checkpoints whose source is SRT/VTT.
 * ASS/SSA checkpoints are not part of the Adaptive source contract, even if
 * they carry the same schema version.
 */
export function isAdaptiveCheckpointHeader(
  value: unknown
): value is AdaptiveCheckpointHeader {
  if (typeof value !== "object" || value === null) return false;
  const header = value as AdaptiveCheckpointHeader;
  return (
    header.version === 3 &&
    header.kind === "adaptive" &&
    (header.format === "srt" || header.format === "vtt")
  );
}
