export interface SubtitleFile {
  path: string;
  name: string;
}

export type TranslationStatus =
  | "pending"
  | "analyzing"
  | "translating"
  | "done"
  | "error";

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
  translateBatch(request: BatchTranslationRequest): Promise<{ success: true }>;
  getSubtitlePreview(filePath: string): Promise<{ cues: SubtitleCuePreview[] }>;
  getAnalysis(filePath: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  onBatchProgress(listener: (data: BatchProgress) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
