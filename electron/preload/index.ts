import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AvailableModel,
  BatchProgress,
  BatchTranslationRequest,
} from "../../src/types/electron-api";

const electronAPI = {
  getFilePath(file: File): string {
    return webUtils.getPathForFile(file);
  },

  selectDirectory(defaultPath?: string): Promise<string | null> {
    return ipcRenderer.invoke("select-directory", defaultPath);
  },

  listModels(request: { apiKey: string; apiHost: string }): Promise<AvailableModel[]> {
    return ipcRenderer.invoke("list-models", request);
  },

  translateBatch(request: BatchTranslationRequest) {
    return ipcRenderer.invoke("batch-translate", request);
  },

  getSubtitlePreview(filePath: string) {
    return ipcRenderer.invoke("get-subtitle-preview", filePath);
  },

  getAnalysis(filePath: string) {
    return ipcRenderer.invoke("get-analysis", filePath);
  },

  openExternal(url: string) {
    return ipcRenderer.invoke("open-external", url);
  },

  onBatchProgress(listener: (data: BatchProgress) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: BatchProgress) => {
      listener(data);
    };

    ipcRenderer.on("batch-progress", handler);
    return () => ipcRenderer.removeListener("batch-progress", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
