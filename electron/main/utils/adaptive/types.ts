import type { ParsedSubtitle } from "../translate.ts";
import type { TranslationSourceFingerprint } from "../translation-checkpoint.ts";

export type { ParsedSubtitle } from "../translate.ts";
export type { TranslationSourceFingerprint } from "../translation-checkpoint.ts";

/** The two translation workflows exposed by the application. */
export const translationModes = ["strict", "adaptive"] as const;
export type TranslationMode = (typeof translationModes)[number];

/** Layout knobs are kept together so semantic translation never depends on magic numbers. */
export interface AdaptiveLayoutOptions {
  maxLines: number;
  maxLineUnitsCjk: number;
  maxLineUnitsLatin: number;
  softMaxCpsCjk: number;
  hardMaxCpsCjk: number;
  softMaxCpsLatin: number;
  hardMaxCpsLatin: number;
  minCueDurationMs: number;
  boundarySnapToleranceMs: number;
}

export const defaultAdaptiveLayoutOptions: AdaptiveLayoutOptions = {
  maxLines: 2,
  maxLineUnitsCjk: 18,
  maxLineUnitsLatin: 42,
  softMaxCpsCjk: 12,
  hardMaxCpsCjk: 16,
  softMaxCpsLatin: 17,
  hardMaxCpsLatin: 22,
  minCueDurationMs: 500,
  boundarySnapToleranceMs: 250,
};

export type ProtectedTokenKind =
  | "markup"
  | "semantic-line-break"
  | "url"
  | "email";

export interface ProtectedToken {
  placeholder: string;
  raw: string;
  kind: ProtectedTokenKind;
  order: number;
}

export interface AdaptiveSourceCueFlags {
  empty: boolean;
  overlapping: boolean;
  multiSpeaker: boolean;
  lockedOneToOne: boolean;
}

/** Immutable, derived data used by the adaptive pipeline. */
export interface AdaptiveSourceCue {
  id: number;
  sourceIndex: number;

  startMs: number;
  endMs: number;

  originalText: string;
  modelText: string;
  plainText: string;

  durationMs: number;
  gapAfterMs: number | null;

  protectedTokens: ProtectedToken[];
  flags: AdaptiveSourceCueFlags;

  /** Optional parser metadata retained for barrier decisions. */
  format?: string;
}

export interface AdaptiveDraftBlock {
  /** Number of consecutive, not-yet-consumed core cues this block consumes. */
  take: number;
  /** One to three target-language subtitle strings without timestamps. */
  targets: string[];
}

export interface AdaptiveSceneDraft {
  blocks: AdaptiveDraftBlock[];
}

export interface AdaptiveScene {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  core: AdaptiveSourceCue[];
  before: AdaptiveSourceCue[];
  after: AdaptiveSourceCue[];
  lockedOneToOne: boolean;
}

export type TranslationBlockOrigin =
  | "adaptive"
  | "repair"
  | "strict-fallback";

export interface TranslationBlock {
  id: string;
  sceneId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceCueIds: number[];
  targetTexts: string[];
  origin: TranslationBlockOrigin;
  semanticFingerprint: string;
}

export interface AdaptiveTargetCue {
  id: string;
  blockId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceCueIds: number[];
  startMs: number;
  endMs: number;
  semanticText: string;
  renderedText: string;
  warnings: AdaptiveSubtitleViolation[];
}

export type ViolationSeverity = "warning" | "error";

export interface AdaptiveSubtitleViolation {
  code: string;
  severity: ViolationSeverity;
  message: string;
  sceneId?: string;
  blockId?: string;
  targetCueId?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface AdaptiveScenePolicy {
  preferredMaxCueCount: number;
  hardMaxCueCount: number;
  preferredMaxSourceChars: number;
  hardMaxSourceChars: number;
  preferredMaxDurationMs: number;
  hardMaxDurationMs: number;
  strongGapMs: number;
  hardGapMs: number;
}

export const adaptiveScenePolicy = {
  preferredMaxCueCount: 20,
  hardMaxCueCount: 28,
  preferredMaxSourceChars: 4_000,
  hardMaxSourceChars: 6_000,
  preferredMaxDurationMs: 90_000,
  hardMaxDurationMs: 120_000,
  strongGapMs: 1_500,
  hardGapMs: 4_000,
} as const satisfies AdaptiveScenePolicy;

/** Compact representation sent to a model for one source cue. */
export interface AdaptiveModelCue {
  i: number;
  d: number;
  g: number | null;
  t: string;
}

export interface TranslationBriefStyle {
  tone: string;
  register: string;
  notes: string[];
}

export interface TranslationBriefCharacter {
  sourceName: string;
  preferredTranslation: string;
  aliases: string[];
  notes: string | null;
}

export interface TranslationBriefGlossaryEntry {
  source: string;
  preferredTranslation: string;
  aliases: string[];
  notes: string | null;
}

export interface TranslationBrief {
  summary: string;
  style: TranslationBriefStyle;
  characters: TranslationBriefCharacter[];
  glossary: TranslationBriefGlossaryEntry[];
}

/** The scene-local subset of a full translation brief. */
export interface SceneBrief {
  summary: string;
  style: TranslationBriefStyle;
  characters: TranslationBriefCharacter[];
  glossary: TranslationBriefGlossaryEntry[];
}

export type TranslationUsageStage =
  | "brief"
  | "strict-translate"
  | "adaptive-translate"
  | "adaptive-repair"
  | "strict-fallback";

export interface StageUsage {
  stage: TranslationUsageStage;
  model: string;
  sceneId?: string;
  requestAttempt: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  durationMs: number;
  finishReason?: string;
}

export interface StageUsageSummary {
  requestCount: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface TranslationUsageSummary {
  requestCount: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  byStage: Partial<Record<TranslationUsageStage, StageUsageSummary>>;
}

export interface AdaptiveCheckpointScene {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  status:
    | "pending"
    | "translating"
    | "repairing"
    | "fallback"
    | "done"
    | "error";
  blocks: TranslationBlock[];
  violations: AdaptiveSubtitleViolation[];
  errorCode?: string;
}

export interface AdaptiveTranslationCheckpointV3 {
  version: 3;
  kind: "adaptive";
  state: "in-progress" | "complete";
  format: "srt" | "vtt";
  source: {
    name: string;
    fingerprint?: TranslationSourceFingerprint;
  };
  translation: {
    mode: "adaptive";
    pipelineVersion: number;
    semanticFingerprint: string;
    layoutFingerprint: string;
  };
  /** Original parsed data only; adaptive output lives in scenes[].blocks. */
  subtitle: ParsedSubtitle;
  brief?: TranslationBrief;
  scenes: AdaptiveCheckpointScene[];
  usage: StageUsage[];
  usageSummary: TranslationUsageSummary;
}

export interface AdaptiveSourceCueInput {
  text: string;
  start: number | string;
  end: number | string;
  lockedOneToOne?: boolean;
  multiSpeaker?: boolean;
  format?: string;
}
