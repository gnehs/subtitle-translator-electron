/**
 * Resolve a user-selected file through the preload bridge.
 * Electron removed the legacy File.path property in v32.
 */
export function getFilePath(file: File): string {
  const filePath = window.electronAPI?.getFilePath(file);
  if (filePath) return filePath;

  throw new Error(`Unable to resolve the selected file: ${file.name}`);
}
