import path from "node:path";

export function getPathClaimKey(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalizedPath = path.resolve(filePath).normalize("NFC");
  return platform === "win32" || platform === "darwin"
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

export function hasPathClaimConflict(
  keys: readonly string[],
  batchClaims: ReadonlySet<string>,
  activeClaims: ReadonlySet<string>
): boolean {
  return (
    new Set(keys).size !== keys.length ||
    keys.some((key) => batchClaims.has(key) || activeClaims.has(key))
  );
}
