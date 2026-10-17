import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { translationErrorCodes } from "../../../shared/translation-error-codes.ts";

import type {
  AdaptiveCheckpointScene,
  AdaptiveTranslationCheckpointV3,
} from "./types";
import type { ParsedSubtitle } from "../translate";
import type { TranslationSourceFingerprint } from "../translation-checkpoint";
import { buildAdaptiveSourceCues } from "./source-cues.ts";
import { ADAPTIVE_TARGET_TEXT_MAX_LENGTH } from "./validator.ts";

/**
 * Version of the semantic settings encoded by this module.  This is kept
 * separate from the checkpoint schema version: a checkpoint can stay v3 while
 * changes to the translation contract invalidate its semantic blocks.
 */
export const ADAPTIVE_PIPELINE_VERSION = 1;
export const ADAPTIVE_AGENT_WORKFLOW = "agent-v1";
export const ADAPTIVE_CHECKPOINT_VERSION = 3 as const;
export const ADAPTIVE_CHECKPOINT_KIND = "adaptive" as const;

const HASH_PATTERN = /^[a-f\d]{64}$/i;
const ADAPTIVE_TARGET_TEXT_MAX_COUNT = 3;
const SCENE_STATUSES = new Set([
  "pending",
  "translating",
  "repairing",
  "fallback",
  "done",
  "error",
]);

type JsonRecord = Record<string, unknown>;

export interface AdaptiveSemanticFingerprintInput {
  pipelineVersion?: number;
  mode?: "adaptive" | string;
  apiHost?: string;
  host?: string;
  model?: string;
  targetLanguage?: string;
  lang?: string;
  adaptivePrompt?: string;
  prompt?: string;
  additionalInstructions?: string;
  additional?: string;
  temperature?: number;
  contextSize?: number;
  scenePolicyVersion?: number | string;
  maxTake?: number;
  maxTargets?: number;
  briefSchemaVersion?: number | string;
  placeholderStrategyVersion?: number | string;
  adaptiveWorkflow?: string;
  /**
   * Accepting extra keys keeps this helper useful at call sites, while the
   * implementation intentionally ignores operational and secret settings.
   */
  [key: string]: unknown;
}

export interface AdaptiveLayoutFingerprintInput {
  layoutEngineVersion?: number | string;
  engineVersion?: number | string;
  outputFormat?: "srt" | "vtt" | string;
  format?: "srt" | "vtt" | string;
  layoutOptions?: unknown;
  options?: unknown;
  targetLanguage?: string;
  lang?: string;
  layoutProfile?: string;
  profile?: string;
  [key: string]: unknown;
}

export interface AdaptiveCoverageRange {
  start: number;
  end: number;
}

export type AdaptiveResumeMode =
  | "resume"
  | "layout-only"
  | "restart"
  | "incompatible";

export interface AdaptiveCheckpointResumeMetadata {
  mode: AdaptiveResumeMode;
  shouldBackupCheckpoint: boolean;
  canReuseCompletedScenes: boolean;
  shouldRerenderLayout: boolean;
  pendingSceneIds: string[];
  completedSceneIds: string[];
  reason?:
    | "source-fingerprint-mismatch"
    | "semantic-fingerprint-mismatch"
    | "layout-fingerprint-mismatch";
}

export interface AdaptiveCheckpointResumeOptions {
  sourceName?: string;
  format?: string;
  sourceFingerprint?: TranslationSourceFingerprint;
  semanticFingerprint: string;
  layoutFingerprint?: string;
}

export interface AdaptiveCheckpointWriter {
  /** Queue a snapshot for a serialized atomic write. */
  write(checkpoint?: AdaptiveTranslationCheckpointV3): Promise<void>;
  /** Wait until every queued write has settled. */
  wait(): Promise<void>;
  /** Alias used by callers that call writers as a flushable resource. */
  flush(): Promise<void>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSourceFingerprint(value: unknown): value is TranslationSourceFingerprint {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.size) &&
    isFiniteNumber(value.mtimeMs) &&
    value.mtimeMs >= 0
  );
}

function hasForbiddenSensitiveKey(key: string): boolean {
  return (
    key === "apiKey" ||
    key === "apiKeys" ||
    key === "rawPrompt" ||
    key === "rawResponse" ||
    key === "prompt" ||
    key === "response"
  );
}

function containsForbiddenSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSensitiveKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => hasForbiddenSensitiveKey(key) || containsForbiddenSensitiveKey(child)
  );
}

function isSubtitleCue(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "cue" || !isRecord(value.data)) {
    return false;
  }
  const data = value.data;
  return (
    typeof data.text === "string" &&
    (typeof data.start === "number" || typeof data.start === "string") &&
    (typeof data.end === "number" || typeof data.end === "string") &&
    data.translatedText === undefined
  );
}

function isParsedSubtitle(value: unknown): value is ParsedSubtitle {
  if (Array.isArray(value)) {
    return value.every((node) => {
      if (isSubtitleCue(node)) return true;
      return (
        isRecord(node) &&
        node.type === "header" &&
        typeof node.data === "string"
      );
    });
  }

  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length === 0) {
    return false;
  }
  // Adaptive only accepts the serializable source event shape.  `full` is
  // optional here so parser implementations can keep their own metadata.
  return value.events.every(isSubtitleCue);
}

function isTranslationBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const sourceCueIds = value.sourceCueIds;
  const sourceStart = value.sourceStart;
  const sourceEnd = value.sourceEnd;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.sceneId) &&
    isNonNegativeInteger(sourceStart) &&
    isNonNegativeInteger(sourceEnd) &&
    sourceStart <= sourceEnd &&
    Array.isArray(sourceCueIds) &&
    sourceCueIds.length === sourceEnd - sourceStart + 1 &&
    sourceCueIds.every(isNonNegativeInteger) &&
    sourceCueIds[0] === sourceStart &&
    sourceCueIds.every((cueId, index) => cueId === sourceStart + index) &&
    Array.isArray(value.targetTexts) &&
    value.targetTexts.length > 0 &&
    value.targetTexts.length <= ADAPTIVE_TARGET_TEXT_MAX_COUNT &&
    value.targetTexts.every(
      (text) =>
        typeof text === "string" &&
        text.trim().length > 0 &&
        text.length <= ADAPTIVE_TARGET_TEXT_MAX_LENGTH
    ) &&
    (value.origin === "adaptive" ||
      value.origin === "repair" ||
      value.origin === "strict-fallback") &&
    typeof value.semanticFingerprint === "string" &&
    HASH_PATTERN.test(value.semanticFingerprint)
  );
}

function isAdaptiveScene(value: unknown): value is AdaptiveCheckpointScene {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonNegativeInteger(value.sourceStart) ||
    !isNonNegativeInteger(value.sourceEnd) ||
    value.sourceStart > value.sourceEnd ||
    typeof value.status !== "string" ||
    !SCENE_STATUSES.has(value.status) ||
    !Array.isArray(value.blocks) ||
    !value.blocks.every(isTranslationBlock) ||
    !Array.isArray(value.violations) ||
    !value.violations.every(isAdaptiveViolation) ||
    (value.status === "done" && value.blocks.length === 0)
  ) {
    return false;
  }
  return value.errorCode === undefined || typeof value.errorCode === "string";
}

function hasValidAdaptiveSceneCoverage(
  scenes: readonly AdaptiveCheckpointScene[],
  subtitle: ParsedSubtitle
): boolean {
  const sourceCues = buildAdaptiveSourceCues(subtitle);
  const requiredCueIndices = sourceCues
    .filter((cue) => !cue.flags.empty)
    .map((cue) => cue.sourceIndex);
  if (requiredCueIndices.length === 0) return scenes.length === 0;

  const sceneIds = new Set<string>();
  const blockIds = new Set<string>();
  let requiredCursor = 0;
  for (const scene of scenes) {
    if (
      sceneIds.has(scene.id) ||
      scene.sourceStart !== requiredCueIndices[requiredCursor] ||
      scene.sourceEnd >= sourceCues.length
    ) {
      return false;
    }
    sceneIds.add(scene.id);
    for (let cueIndex = scene.sourceStart; cueIndex <= scene.sourceEnd; cueIndex += 1) {
      if (requiredCueIndices[requiredCursor] !== cueIndex) return false;
      requiredCursor += 1;
    }

    let nextBlockStart = scene.sourceStart;
    for (const block of scene.blocks) {
      if (
        blockIds.has(block.id) ||
        block.sceneId !== scene.id ||
        block.sourceStart !== nextBlockStart ||
        block.sourceEnd > scene.sourceEnd
      ) {
        return false;
      }
      blockIds.add(block.id);
      nextBlockStart = block.sourceEnd + 1;
    }
    if (scene.status === "done" && nextBlockStart !== scene.sourceEnd + 1) {
      return false;
    }
  }
  return requiredCursor === requiredCueIndices.length;
}

function isAdaptiveViolation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.code) ||
    (value.severity !== "warning" && value.severity !== "error") ||
    !isNonEmptyString(value.message)
  ) {
    return false;
  }
  for (const key of ["sceneId", "blockId", "targetCueId"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false;
  }
  if (value.details === undefined) return true;
  if (!isRecord(value.details)) return false;
  return Object.values(value.details).every(
    (detail) =>
      detail === null ||
      typeof detail === "string" ||
      typeof detail === "number" ||
      typeof detail === "boolean"
  );
}

function isValidBrief(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (typeof value.summary !== "string" || !isRecord(value.style)) return false;
  const style = value.style;
  return (
    typeof style.tone === "string" &&
    typeof style.register === "string" &&
    Array.isArray(style.notes) &&
    style.notes.every((note) => typeof note === "string") &&
    Array.isArray(value.characters) &&
    value.characters.every(isBriefEntry) &&
    Array.isArray(value.glossary) &&
    value.glossary.every(isBriefEntry)
  );
}

function isBriefEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceName === "string" || typeof value.source === "string"
  ) &&
    typeof value.preferredTranslation === "string" &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === "string") &&
    (value.notes === undefined || value.notes === null || typeof value.notes === "string");
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.stage) &&
    isNonEmptyString(value.model) &&
    isNonNegativeInteger(value.requestAttempt) &&
    isFiniteNumber(value.durationMs) &&
    value.durationMs >= 0 &&
    (value.sceneId === undefined || typeof value.sceneId === "string")
  );
}

function isUsageSummary(value: unknown): boolean {
  if (!isRecord(value) || !isNonNegativeInteger(value.requestCount)) return false;
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
  ]) {
    if (value[key] !== undefined && !isNonNegativeInteger(value[key])) return false;
  }
  if (value.byStage === undefined) return true;
  if (!isRecord(value.byStage)) return false;
  return Object.values(value.byStage).every((stage) => {
    if (!isRecord(stage) || !isNonNegativeInteger(stage.requestCount)) return false;
    for (const key of ["inputTokens", "outputTokens", "totalTokens"]) {
      if (stage[key] !== undefined && !isNonNegativeInteger(stage[key])) return false;
    }
    return true;
  });
}

/**
 * Runtime guard for checkpoint JSON.  It deliberately rejects sensitive
 * fields instead of silently persisting data that the v3 contract forbids.
 */
export function isAdaptiveTranslationCheckpointV3(
  value: unknown
): value is AdaptiveTranslationCheckpointV3 {
  if (!isRecord(value) || containsForbiddenSensitiveKey(value)) return false;
  const source = value.source;
  const translation = value.translation;
  return (
    value.version === ADAPTIVE_CHECKPOINT_VERSION &&
    value.kind === ADAPTIVE_CHECKPOINT_KIND &&
    (value.state === "in-progress" || value.state === "complete") &&
    (value.format === "srt" || value.format === "vtt") &&
    isRecord(source) &&
    isNonEmptyString(source.name) &&
    (source.fingerprint === undefined || isSourceFingerprint(source.fingerprint)) &&
    isRecord(translation) &&
    translation.mode === "adaptive" &&
    isNonNegativeInteger(translation.pipelineVersion) &&
    isNonEmptyString(translation.semanticFingerprint) &&
    HASH_PATTERN.test(translation.semanticFingerprint) &&
    isNonEmptyString(translation.layoutFingerprint) &&
    HASH_PATTERN.test(translation.layoutFingerprint) &&
    isParsedSubtitle(value.subtitle) &&
    !hasAdaptiveTranslatedText(value.subtitle) &&
    isValidBrief(value.brief) &&
    Array.isArray(value.scenes) &&
    value.scenes.every(isAdaptiveScene) &&
    hasValidAdaptiveSceneCoverage(
      value.scenes as AdaptiveCheckpointScene[],
      value.subtitle as ParsedSubtitle
    ) &&
    (value.state !== "complete" ||
      value.scenes.every((scene) => scene.status === "done")) &&
    Array.isArray(value.usage) &&
    value.usage.every(isUsage) &&
    isUsageSummary(value.usageSummary)
  );
}

export const isAdaptiveCheckpointV3 = isAdaptiveTranslationCheckpointV3;

function checkpointError(message = "Invalid adaptive translation checkpoint"): Error {
  const error = new Error(translationErrorCodes.adaptiveInvalidCheckpoint);
  error.cause = message;
  return error;
}

/** Parse and validate a v3 checkpoint, rejecting source subtitles with results. */
export function parseAdaptiveCheckpoint(
  content: string
): AdaptiveTranslationCheckpointV3 {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw checkpointError("invalid JSON");
  }
  if (!isAdaptiveTranslationCheckpointV3(value)) {
    throw checkpointError();
  }
  return value;
}

/** Explicit v3 alias for code that names the schema version in its API. */
export const parseAdaptiveCheckpointV3 = parseAdaptiveCheckpoint;

function cloneWithoutSensitiveFields(value: unknown, stripTranslatedText = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneWithoutSensitiveFields(item, stripTranslatedText));
  }
  if (!isRecord(value)) return value;

  const cloned: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (hasForbiddenSensitiveKey(key)) continue;
    if (stripTranslatedText && key === "translatedText") continue;
    cloned[key] = cloneWithoutSensitiveFields(child, stripTranslatedText);
  }
  return cloned;
}

/**
 * Return a deep, non-mutating source copy with parser-side translatedText
 * fields removed.  Adaptive blocks remain the only translation result store.
 */
export function stripAdaptiveTranslations<T extends ParsedSubtitle>(
  subtitle: T
): T {
  return cloneWithoutSensitiveFields(subtitle, true) as T;
}

export function hasAdaptiveTranslatedText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAdaptiveTranslatedText);
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "translatedText")) return true;
  return Object.values(value).some(hasAdaptiveTranslatedText);
}

export function assertAdaptiveSourceSubtitleImmutable(subtitle: unknown): void {
  if (hasAdaptiveTranslatedText(subtitle)) {
    throw checkpointError("source subtitle contains translatedText");
  }
}

/** Alias kept for callers that use the shorter source-immutability name. */
export const assertSourceSubtitleImmutable = assertAdaptiveSourceSubtitleImmutable;

/**
 * Serialize only the v3 checkpoint contract.  Unknown or secret properties
 * are not copied, and subtitle translatedText fields are stripped first.
 */
export function serializeAdaptiveCheckpoint(
  checkpoint: AdaptiveTranslationCheckpointV3
): string {
  const sanitized = cloneWithoutSensitiveFields(checkpoint) as JsonRecord;
  sanitized.subtitle = stripAdaptiveTranslations(checkpoint.subtitle);
  if (!isAdaptiveTranslationCheckpointV3(sanitized)) {
    throw checkpointError();
  }
  // A trailing newline makes project files pleasant to inspect and mirrors the
  // existing checkpoint writer.
  return `${JSON.stringify(sanitized, null, 2)}\n`;
}

/** Alias used by a few pipeline callers. */
export const serializeAdaptiveCheckpointV3 = serializeAdaptiveCheckpoint;

function pickValue(
  input: AdaptiveSemanticFingerprintInput,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  return undefined;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function fingerprintPayload(domain: string, payload: unknown): string {
  return createHash("sha256")
    .update(`${domain}\n${JSON.stringify(canonicalize(payload))}`, "utf8")
    .digest("hex");
}

/**
 * Hash semantic settings only. Operational knobs (keys, concurrency, RPM,
 * delay, and output directory) are intentionally not represented here.
 */
export function createAdaptiveSemanticFingerprint(
  input: AdaptiveSemanticFingerprintInput
): string {
  const payload = {
    pipelineVersion:
      pickValue(input, "pipelineVersion") ?? ADAPTIVE_PIPELINE_VERSION,
    mode: pickValue(input, "mode") ?? "adaptive",
    apiHost: pickValue(input, "apiHost", "host") ?? "",
    model: pickValue(input, "model") ?? "",
    targetLanguage: pickValue(input, "targetLanguage", "lang") ?? "",
    adaptivePrompt: pickValue(input, "adaptivePrompt", "prompt") ?? "",
    additionalInstructions:
      pickValue(input, "additionalInstructions", "additional") ?? "",
    temperature: pickValue(input, "temperature") ?? 1,
    contextSize: pickValue(input, "contextSize") ?? 0,
    scenePolicyVersion: pickValue(input, "scenePolicyVersion") ?? 1,
    maxTake: pickValue(input, "maxTake") ?? 4,
    maxTargets: pickValue(input, "maxTargets") ?? 3,
    briefSchemaVersion: pickValue(input, "briefSchemaVersion") ?? 1,
    placeholderStrategyVersion:
      pickValue(input, "placeholderStrategyVersion") ?? 1,
    ...(input.adaptiveWorkflow !== undefined
      ? { adaptiveWorkflow: input.adaptiveWorkflow }
      : {}),
  };
  return fingerprintPayload("adaptive-semantic-v1", payload);
}

/** Hash layout-only settings used to materialize and render target cues. */
export function createAdaptiveLayoutFingerprint(
  input: AdaptiveLayoutFingerprintInput
): string {
  const payload = {
    layoutEngineVersion:
      input.layoutEngineVersion ?? input.engineVersion ?? 1,
    outputFormat: input.outputFormat ?? input.format ?? "srt",
    layoutOptions: input.layoutOptions ?? input.options ?? {},
    targetLanguage: input.targetLanguage ?? input.lang ?? "",
    layoutProfile: input.layoutProfile ?? input.profile ?? "default",
  };
  return fingerprintPayload("adaptive-layout-v1", payload);
}

function sourceMatches(
  checkpoint: AdaptiveTranslationCheckpointV3,
  options: Pick<AdaptiveCheckpointResumeOptions, "sourceName" | "format" | "sourceFingerprint">
): boolean {
  if (
    options.sourceName !== undefined &&
    checkpoint.source.name !== options.sourceName
  ) {
    return false;
  }
  if (options.format !== undefined && checkpoint.format !== options.format) {
    return false;
  }
  // A v3 checkpoint without a fingerprint cannot be safely auto-applied to a
  // source file.  If no current source fingerprint was supplied, leave this
  // check to the caller (e.g. tests inspecting semantic reuse in isolation).
  if (options.sourceFingerprint !== undefined) {
    const expected = checkpoint.source.fingerprint;
    return (
      expected !== undefined &&
      expected.size === options.sourceFingerprint.size &&
      expected.mtimeMs === options.sourceFingerprint.mtimeMs
    );
  }
  return true;
}

export function hasMatchingAdaptiveCheckpointSource(
  checkpoint: AdaptiveTranslationCheckpointV3,
  sourceName: string,
  format: string,
  sourceFingerprint: TranslationSourceFingerprint
): boolean {
  return sourceMatches(checkpoint, { sourceName, format, sourceFingerprint });
}

export const isAdaptiveCheckpointSourceCompatible =
  hasMatchingAdaptiveCheckpointSource;

export function hasMatchingAdaptiveSemanticFingerprint(
  checkpoint: AdaptiveTranslationCheckpointV3,
  semanticFingerprint: string
): boolean {
  return checkpoint.translation.semanticFingerprint === semanticFingerprint;
}

export function hasMatchingAdaptiveLayoutFingerprint(
  checkpoint: AdaptiveTranslationCheckpointV3,
  layoutFingerprint: string
): boolean {
  return checkpoint.translation.layoutFingerprint === layoutFingerprint;
}

function sceneIsComplete(scene: AdaptiveCheckpointScene): boolean {
  return scene.status === "done";
}

export function isAdaptiveSceneComplete(scene: AdaptiveCheckpointScene): boolean {
  return sceneIsComplete(scene);
}

export function getAdaptiveCompletedSceneIds(
  checkpoint: AdaptiveTranslationCheckpointV3
): string[] {
  return checkpoint.scenes.filter(sceneIsComplete).map((scene) => scene.id);
}

export function getAdaptivePendingSceneIds(
  checkpoint: AdaptiveTranslationCheckpointV3
): string[] {
  return checkpoint.scenes
    .filter((scene) => !sceneIsComplete(scene))
    .map((scene) => scene.id);
}

function mergeRanges(ranges: readonly AdaptiveCoverageRange[]): AdaptiveCoverageRange[] {
  const sorted = [...ranges]
    .filter(
      (range) =>
        Number.isSafeInteger(range.start) &&
        Number.isSafeInteger(range.end) &&
        range.start >= 0 &&
        range.start <= range.end
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: AdaptiveCoverageRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
    } else if (range.end > previous.end) {
      previous.end = range.end;
    }
  }
  return merged;
}

/** Return inclusive cue-index ranges covered by completed scene blocks. */
export function getAdaptiveCheckpointCoverage(
  checkpoint: AdaptiveTranslationCheckpointV3
): AdaptiveCoverageRange[] {
  const ranges: AdaptiveCoverageRange[] = [];
  for (const scene of checkpoint.scenes) {
    if (!sceneIsComplete(scene)) continue;
    for (const block of scene.blocks) {
      ranges.push({ start: block.sourceStart, end: block.sourceEnd });
    }
  }
  return mergeRanges(ranges);
}

export const getAdaptiveCompletedCoverage = getAdaptiveCheckpointCoverage;

export function getAdaptiveCompletedCueIndices(
  checkpoint: AdaptiveTranslationCheckpointV3
): number[] {
  const indices: number[] = [];
  for (const range of getAdaptiveCheckpointCoverage(checkpoint)) {
    for (let index = range.start; index <= range.end; index += 1) {
      indices.push(index);
    }
  }
  return indices;
}

/**
 * Validate that completed scene blocks cover each source cue exactly once.
 * Returns false for gaps, overlap, or an invalid total cue count.
 */
export function hasCompleteAdaptiveCoverage(
  checkpoint: AdaptiveTranslationCheckpointV3,
  totalCueCount?: number
): boolean {
  const completedScenes = checkpoint.scenes.filter(sceneIsComplete);
  if (completedScenes.length === 0) return false;
  const ranges = completedScenes.flatMap((scene) =>
    scene.blocks.map((block) => ({ start: block.sourceStart, end: block.sourceEnd }))
  );
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  let next = 0;
  for (const range of sorted) {
    if (range.start !== next || range.end < range.start) return false;
    next = range.end + 1;
  }
  return totalCueCount === undefined ? next > 0 : next === totalCueCount;
}

export function assertCompleteAdaptiveCoverage(
  checkpoint: AdaptiveTranslationCheckpointV3,
  totalCueCount?: number
): void {
  if (!hasCompleteAdaptiveCoverage(checkpoint, totalCueCount)) {
    throw checkpointError("completed scenes do not cover every source cue exactly once");
  }
}

export function canReuseAdaptiveCheckpoint(
  checkpoint: AdaptiveTranslationCheckpointV3,
  options: AdaptiveCheckpointResumeOptions
): boolean {
  return (
    checkpoint.state === "complete" &&
    sourceMatches(checkpoint, options) &&
    hasMatchingAdaptiveSemanticFingerprint(checkpoint, options.semanticFingerprint)
  );
}

export const canReuseCompletedAdaptiveCheckpoint = canReuseAdaptiveCheckpoint;

export function shouldRerenderAdaptiveLayout(
  checkpoint: AdaptiveTranslationCheckpointV3,
  options: AdaptiveCheckpointResumeOptions
): boolean {
  return (
    canReuseAdaptiveCheckpoint(checkpoint, options) &&
    options.layoutFingerprint !== undefined &&
    !hasMatchingAdaptiveLayoutFingerprint(checkpoint, options.layoutFingerprint)
  );
}

export const shouldPerformAdaptiveLayoutOnlyRerender = shouldRerenderAdaptiveLayout;

/**
 * Determine resume behaviour without mutating the checkpoint.  Semantic
 * changes require backup + restart; layout-only changes reuse all blocks.
 */
export function getAdaptiveCheckpointResumeMetadata(
  checkpoint: AdaptiveTranslationCheckpointV3,
  options: AdaptiveCheckpointResumeOptions
): AdaptiveCheckpointResumeMetadata {
  const completedSceneIds = getAdaptiveCompletedSceneIds(checkpoint);
  const pendingSceneIds = getAdaptivePendingSceneIds(checkpoint);
  if (!sourceMatches(checkpoint, options)) {
    return {
      mode: "incompatible",
      shouldBackupCheckpoint: false,
      canReuseCompletedScenes: false,
      shouldRerenderLayout: false,
      pendingSceneIds,
      completedSceneIds,
      reason: "source-fingerprint-mismatch",
    };
  }

  if (!hasMatchingAdaptiveSemanticFingerprint(checkpoint, options.semanticFingerprint)) {
    return {
      mode: "restart",
      shouldBackupCheckpoint: true,
      canReuseCompletedScenes: false,
      shouldRerenderLayout: false,
      pendingSceneIds: [],
      completedSceneIds: [],
      reason: "semantic-fingerprint-mismatch",
    };
  }

  const layoutChanged =
    options.layoutFingerprint !== undefined &&
    !hasMatchingAdaptiveLayoutFingerprint(checkpoint, options.layoutFingerprint);
  if (checkpoint.state === "complete") {
    return {
      mode: layoutChanged ? "layout-only" : "layout-only",
      shouldBackupCheckpoint: false,
      canReuseCompletedScenes: true,
      shouldRerenderLayout: layoutChanged,
      pendingSceneIds: [],
      completedSceneIds,
      ...(layoutChanged ? { reason: "layout-fingerprint-mismatch" as const } : {}),
    };
  }

  return {
    mode: "resume",
    shouldBackupCheckpoint: false,
    canReuseCompletedScenes: true,
    shouldRerenderLayout: layoutChanged,
    pendingSceneIds,
    completedSceneIds,
    ...(layoutChanged ? { reason: "layout-fingerprint-mismatch" as const } : {}),
  };
}

export const getAdaptiveResumePlan = getAdaptiveCheckpointResumeMetadata;

function makeTemporaryPath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = makeTemporaryPath(filePath);
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Create a serialized writer.  Every call snapshots and queues its payload;
 * writes therefore cannot interleave when scenes finish concurrently.
 */
export function createAdaptiveCheckpointWriter(
  checkpointPath: string,
  createCheckpoint?: () => AdaptiveTranslationCheckpointV3
): AdaptiveCheckpointWriter {
  let pending: Promise<void> = Promise.resolve();
  let completedState: "in-progress" | "complete" | undefined;
  let committedRank: readonly [number, number, number] | undefined;

  const rank = (
    snapshot: AdaptiveTranslationCheckpointV3
  ): readonly [number, number, number] => [
    snapshot.state === "complete" ? 1 : 0,
    snapshot.scenes.filter((scene) => scene.status === "done").length,
    snapshot.usage.length,
  ];

  const isOlder = (
    candidate: readonly [number, number, number],
    committed: readonly [number, number, number]
  ): boolean => {
    for (let index = 0; index < candidate.length; index += 1) {
      const difference = candidate[index]! - committed[index]!;
      if (difference !== 0) return difference < 0;
    }
    return false;
  };

  const write = (checkpoint?: AdaptiveTranslationCheckpointV3): Promise<void> => {
    const snapshot = checkpoint ?? createCheckpoint?.();
    if (!snapshot) {
      return Promise.reject(
        new TypeError("createAdaptiveCheckpointWriter.write requires a checkpoint")
      );
    }
    const content = serializeAdaptiveCheckpoint(snapshot);
    const snapshotRank = rank(snapshot);
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        // A complete state is monotonic.  A late scene callback must not put
        // an older in-progress snapshot over the completed project file.
        if (completedState === "complete" && snapshot.state === "in-progress") {
          return;
        }
        if (committedRank && isOlder(snapshotRank, committedRank)) return;
        await writeAtomic(checkpointPath, content);
        committedRank = snapshotRank;
        if (snapshot.state === "complete") completedState = "complete";
        else if (completedState === undefined) completedState = "in-progress";
      });
    return pending;
  };

  const wait = (): Promise<void> => pending;
  return { write, wait, flush: wait };
}

/** Convenience single-write API for callers that do not need a writer handle. */
export async function writeAdaptiveCheckpointAtomic(
  checkpointPath: string,
  checkpoint: AdaptiveTranslationCheckpointV3
): Promise<void> {
  await writeAtomic(checkpointPath, serializeAdaptiveCheckpoint(checkpoint));
}

/** Return a unique sibling path used before semantic-settings migration. */
export function getAdaptiveCheckpointBackupPath(
  checkpointPath: string,
  suffix = "backup.json"
): string {
  return `${checkpointPath}.${Date.now()}.${randomUUID()}.${suffix}`;
}

/** Rename an old checkpoint before restarting with different semantic settings. */
export async function backupAdaptiveCheckpoint(
  checkpointPath: string,
  backupPath = getAdaptiveCheckpointBackupPath(checkpointPath)
): Promise<string> {
  await rename(checkpointPath, backupPath);
  return backupPath;
}
