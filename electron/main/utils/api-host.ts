function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "[::1]" ||
    normalizedHostname === "::1"
  );
}

export function parseAllowedApiHost(apiHost: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(apiHost);
  } catch {
    throw new Error("API host must be a valid URL");
  }

  if (parsed.username || parsed.password) {
    throw new Error("API host must not contain credentials");
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
  ) {
    throw new Error("API host must use HTTPS unless it is a local server");
  }

  return parsed;
}

export function isAllowedApiHost(apiHost: string): boolean {
  try {
    parseAllowedApiHost(apiHost);
    return true;
  } catch {
    return false;
  }
}
