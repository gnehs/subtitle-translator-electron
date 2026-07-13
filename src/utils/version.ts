type ParsedVersion = {
  major: string;
  minor: string;
  patch: string;
  preRelease: string[];
};

const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i;

function compareNumericStrings(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function comparePreReleaseIdentifiers(left: string, right: string): number {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    return compareNumericStrings(left, right);
  }
  if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function parseVersion(version: string): ParsedVersion | null {
  const normalized = version.trim();
  const match = VERSION_PATTERN.exec(normalized);
  if (!match) return null;

  const preRelease = match[4]?.split(".") ?? [];
  if (
    preRelease.some(
      (identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
    )
  ) {
    return null;
  }

  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    preRelease,
  };
}

/** Returns true only when candidateVersion is a valid SemVer greater than currentVersion. */
export function isNewerVersion(currentVersion: string, candidateVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const candidate = parseVersion(candidateVersion);
  if (!current || !candidate) return false;

  for (const key of ["major", "minor", "patch"] as const) {
    const comparison = compareNumericStrings(candidate[key], current[key]);
    if (comparison !== 0) return comparison > 0;
  }

  if (current.preRelease.length === 0 || candidate.preRelease.length === 0) {
    return current.preRelease.length > 0 && candidate.preRelease.length === 0;
  }

  const identifierCount = Math.max(current.preRelease.length, candidate.preRelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const currentIdentifier = current.preRelease[index];
    const candidateIdentifier = candidate.preRelease[index];
    if (currentIdentifier === undefined) return true;
    if (candidateIdentifier === undefined) return false;

    const comparison = comparePreReleaseIdentifiers(candidateIdentifier, currentIdentifier);
    if (comparison !== 0) return comparison > 0;
  }

  return false;
}
