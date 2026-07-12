export interface SubtitleFile {
  path: string;
  name: string;
}

export interface AvailableModel {
  id: string;
  ownedBy?: string;
}

export type TranslationStatus =
  | "pending"
  | "analyzing"
  | "translating"
  | "done"
  | "error";

export const translationErrorCodes = {
  unsupportedInputFile: "ERR_UNSUPPORTED_TRANSLATION_INPUT_FILE",
  inputPathNotFile: "ERR_TRANSLATION_INPUT_NOT_FILE",
  unsupportedSubtitleFormat: "ERR_UNSUPPORTED_SUBTITLE_FORMAT",
  invalidCheckpoint: "ERR_INVALID_TRANSLATION_CHECKPOINT",
  incompatibleCheckpoint: "ERR_INCOMPATIBLE_TRANSLATION_CHECKPOINT",
  noValidApiKeys: "ERR_NO_VALID_API_KEYS",
  unsupportedFileExtension: "ERR_UNSUPPORTED_FILE_EXTENSION",
} as const;

export interface TranslationParams {
  apiKeys: string[];
  apiHost: string;
  model: string;
  prompt: string;
  lang: string;
  additional: string;
  temperature: number;
  multiLangSave: "none" | "translate+original" | "original+translate";
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
  error?: string;
  totalCues?: number;
  currentCue?: number;
  analysis?: string;
}

export interface SubtitleCuePreview {
  text: string;
  translatedText?: string;
  start?: number | string;
  end?: number | string;
}

export interface ElectronAPI {
  getFilePath(file: File): string;
  selectDirectory(defaultPath?: string): Promise<string | null>;
  listModels(request: {
    apiKey: string;
    apiHost: string;
  }): Promise<AvailableModel[]>;
  translateBatch(request: BatchTranslationRequest): Promise<{ success: true }>;
  getSubtitlePreview(filePath: string): Promise<{ cues: SubtitleCuePreview[] }>;
  getAnalysis(filePath: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  setMenuLocale(locale: string): Promise<void>;
  onBatchProgress(listener: (data: BatchProgress) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
