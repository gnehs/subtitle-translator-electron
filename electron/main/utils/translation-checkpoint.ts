import { createHash } from "node:crypto";

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
  format: string;
  source: {
    name: string;
    fingerprint?: TranslationSourceFingerprint;
  };
  translation?: {
    configFingerprint: string;
  };
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
