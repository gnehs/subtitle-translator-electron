export interface SubtitleFile {
  path: string;
  name: string;
}

export interface AvailableModel {
  id: string;
  ownedBy?: string;
}

export { translationErrorCodes } from "../../electron/shared/translation-error-codes";

export const translationConcurrencyOptions = [1, 2, 5, 10] as const;
export type TranslationConcurrency = (typeof translationConcurrencyOptions)[number];
export const translationModes = ["strict", "adaptive"] as const;
export type TranslationMode = (typeof translationModes)[number];

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

export type SubtitleOutputFormat =
  | "srt-translation"
  | "srt-bilingual"
  | "srt-original-translation"
  | "ass-bilingual"
  | "ass-original-translation";

export type TranslationStatus =
  | "pending"
  | "analyzing"
  | "translating"
  | "repairing"
  | "fallback"
  | "rendering"
  | "done"
  | "error";

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

export interface TranslationParams {
  apiKeys: string[];
  apiHost: string;
  model: string;
  prompt: string;
  mode: TranslationMode;
  lang: string;
  additional: string;
  temperature: number;
  outputFormat: SubtitleOutputFormat;
  assFonts: {
    translationFont: string;
    originalFont: string;
  };
  concurrency: TranslationConcurrency;
  delay: number;
  requestsPerMinute: number;
  outputDirectory?: string;
  contextSize?: number;
}

export interface BatchTranslationRequest {
  files: SubtitleFile[];
  params: TranslationParams;
}

export interface BatchProgress {
  filePath: string;
  progress: number;
  status: TranslationStatus;
  mode?: TranslationMode;
  error?: string;
  totalCues?: number;
  currentCue?: number;
  analysis?: string | null;
  outputPath?: string;
  previewCues?: SubtitleCuePreview[];
  usageSummary?: TranslationUsageSummary;
  warnings?: AdaptiveSubtitleViolation[];
}

export interface SubtitlePreviewRequest {
  filePath: string;
  outputPath?: string;
}

export interface StrictSubtitleCuePreview {
  kind: "strict";
  text: string;
  translatedText?: string;
  start?: number | string;
  end?: number | string;
}

export type AdaptivePreviewOrigin =
  | "adaptive"
  | "repair"
  | "strict-fallback";

export interface AdaptiveSubtitleCuePreview {
  kind: "adaptive";
  targetText: string;
  sourceStart: number;
  sourceEnd: number;
  sourceTexts: string[];
  start: number;
  end: number;
  origin: AdaptivePreviewOrigin;
  warnings: AdaptiveSubtitleViolation[];
}

export type SubtitleCuePreview =
  | StrictSubtitleCuePreview
  | AdaptiveSubtitleCuePreview;

export interface ElectronAPI {
  platform: string;
  getFilePath(file: File): string;
  selectDirectory(defaultPath?: string): Promise<string | null>;
  listModels(request: {
    apiKey: string;
    apiHost: string;
  }): Promise<AvailableModel[]>;
  translateBatch(request: BatchTranslationRequest): Promise<{ success: true }>;
  cancelTranslation(filePath: string): void;
  getSubtitlePreview(
    request: SubtitlePreviewRequest
  ): Promise<{ cues: SubtitleCuePreview[] }>;
  getAnalysis(filePath: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  setMenuLocale(locale: string): Promise<void>;
  onBatchProgress(listener: (data: BatchProgress) => void): () => void;
}

export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}
