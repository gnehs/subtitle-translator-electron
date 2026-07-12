export const supportedLocales = ["en-US", "zh-TW", "zh-CN"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const fallbackLocale: SupportedLocale = "en-US";

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (supportedLocales as readonly string[]).includes(value)
  );
}

export function parseStoredLocale(value: string | null): SupportedLocale {
  if (isSupportedLocale(value)) {
    return value;
  }

  if (value !== null) {
    try {
      const parsedValue: unknown = JSON.parse(value);
      if (isSupportedLocale(parsedValue)) {
        return parsedValue;
      }
    } catch {
      // Ignore values written by older or unrelated storage implementations.
    }
  }

  return fallbackLocale;
}
