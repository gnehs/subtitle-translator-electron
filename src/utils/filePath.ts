/**
 * 獲取文件路徑的兼容函數
 * 處理 Electron v32+ 中 file.path 被移除的問題
 * 使用 electron.webUtils.getPathForFile 作為替代方案
 */
export function getFilePath(file: File): string {
  // 首先嘗試使用傳統的 file.path（適用於 Electron v31 及更早版本）
  if (file.path) {
    return file.path;
  }

  // 對於 Electron v32+，使用 webUtils.getPathForFile
  try {
    // 方法1: 檢查是否在 window.electron 中定義了 webUtils
    if (window.electron && window.electron.webUtils) {
      return window.electron.webUtils.getPathForFile(file);
    }
    
    // 方法2: 檢查是否可以直接訪問 electron 模塊 (當 nodeIntegration: true 時)
    if ((window as any).require) {
      const { webUtils } = (window as any).require('electron');
      if (webUtils && webUtils.getPathForFile) {
        return webUtils.getPathForFile(file);
      }
    }
    
    // 方法3: 嘗試直接訪問全局的 electron 對象
    if ((window as any).electron && (window as any).electron.webUtils) {
      return (window as any).electron.webUtils.getPathForFile(file);
    }
  } catch (error) {
    console.warn('無法使用 webUtils.getPathForFile:', error);
  }

  // 如果所有方法都失敗，返回空字符串並記錄錯誤
  console.error('無法獲取文件路徑。請確保在 Electron 環境中運行。', {
    fileName: file.name,
    fileSize: file.size,
    hasPath: !!file.path,
    hasWebUtils: isWebUtilsSupported()
  });
  return '';
}

/**
 * 檢查是否支持新的 webUtils API
 */
export function isWebUtilsSupported(): boolean {
  try {
    // 檢查 window.electron
    if (window.electron && window.electron.webUtils) {
      return true;
    }
    
    // 檢查 require
    if ((window as any).require) {
      const { webUtils } = (window as any).require('electron');
      return !!(webUtils && webUtils.getPathForFile);
    }
    
    // 檢查全局 electron 對象
    if ((window as any).electron && (window as any).electron.webUtils) {
      return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

/**
 * 批量獲取文件路徑
 */
export function getFilePaths(files: File[]): string[] {
  return files.map(file => getFilePath(file));
}

/**
 * 獲取文件路徑的調試信息
 */
export function getFilePathDebugInfo(file: File): any {
  return {
    fileName: file.name,
    fileSize: file.size,
    hasPath: !!file.path,
    pathValue: file.path,
    isWebUtilsSupported: isWebUtilsSupported(),
    hasWindowElectron: !!(window as any).electron,
    hasRequire: !!(window as any).require
  };
}