import { createHash } from "node:crypto";
import path from "node:path";

const TRANSLATION_PIPELINE_VERSION = 2;

export interface TranslationSourceFingerprint {
  size: number;
  mtimeMs: number;
}

export interface TranslationConfigIdentityInput {
  apiHost: string;
  model: string;
  prompt: string;
  lang: string;
  additional: string;
  temperature: number;
  contextSize: number;
}

interface CheckpointIdentity {
  version?: 1 | 2;
  format: string;
  source: {
    name: string;
    fingerprint?: TranslationSourceFingerprint;
  };
  translation?: {
    configFingerprint: string;
  };
  analysis?: string;
}

export interface TranslationCheckpointResumeMetadata {
  analysis?: string;
  shouldBackupCheckpoint: boolean;
}

export function createTranslationConfigFingerprint(
  config: TranslationConfigIdentityInput
): string {
  const stableConfig = [
    TRANSLATION_PIPELINE_VERSION,
    config.apiHost,
    config.model,
    config.prompt,
    config.lang,
    config.additional,
    config.temperature,
    config.contextSize,
  ];

  return createHash("sha256").update(JSON.stringify(stableConfig)).digest("hex");
}

export function hasMatchingCheckpointSource(
  checkpoint: CheckpointIdentity,
  sourceName: string,
  sourceExtension: string,
  sourceFingerprint: TranslationSourceFingerprint
): boolean {
  const checkpointFingerprint = checkpoint.source.fingerprint;
  return (
    checkpoint.source.name === sourceName &&
    checkpoint.format === sourceExtension &&
    checkpointFingerprint?.size === sourceFingerprint.size &&
    checkpointFingerprint.mtimeMs === sourceFingerprint.mtimeMs
  );
}

export function hasMatchingTranslationConfig(
  checkpoint: CheckpointIdentity,
  configFingerprint: string
): boolean {
  return checkpoint.translation?.configFingerprint === configFingerprint;
}

/**
 * Keep completed cue translations when settings change, but invalidate
 * configuration-dependent analysis before continuing the translation.
 */
export function getTranslationCheckpointResumeMetadata(
  checkpoint: CheckpointIdentity,
  configFingerprint?: string
): TranslationCheckpointResumeMetadata {
  const hasMismatchedConfig = Boolean(
    configFingerprint &&
      checkpoint.version === 2 &&
      !hasMatchingTranslationConfig(checkpoint, configFingerprint)
  );

  return {
    analysis: hasMismatchedConfig ? undefined : checkpoint.analysis,
    shouldBackupCheckpoint: Boolean(
      configFingerprint &&
        (checkpoint.version === 1 || hasMismatchedConfig)
    ),
  };
}

/**
 * Return the stable checkpoint name first, followed by the short-lived name
 * used by version 1.8.0 so both existing formats remain discoverable.
 */
export function getTranslationCheckpointCandidates(
  filePath: string,
  sourceName = path.basename(filePath)
): string[] {
  if (path.extname(filePath).toLowerCase() === ".json") {
    return [filePath];
  }

  const directory = path.dirname(filePath);
  const basename = path.basename(sourceName, path.extname(sourceName));
  return [
    path.join(directory, `${basename}.translation.json`),
    path.join(directory, `${sourceName}.translation.json`),
  ];
}
