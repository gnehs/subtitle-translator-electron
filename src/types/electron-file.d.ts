export {}; // ensure this file is treated as a module

declare global {
  interface File {
    /** Electron‐loader will populate this for you */
    path?: string;
  }

  interface Window {
    electron?: {
      webUtils?: {
        getPathForFile(file: File): string;
      };
    };
  }
}

// Electron webUtils 模塊類型定義
declare module 'electron' {
  export const webUtils: {
    getPathForFile(file: File): string;
  };
}
