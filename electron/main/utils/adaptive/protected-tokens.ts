import type { ProtectedToken, ProtectedTokenKind } from "./types.ts";

export interface ProtectedText {
  text: string;
  tokens: ProtectedToken[];
}

export interface ProtectedTokenValidation {
  valid: boolean;
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
  message?: string;
}

const PLACEHOLDER_PATTERN = /__ST_(?:TAG|BR|URL|EMAIL)_\d+__/g;

const PLACEHOLDER_PREFIX: Record<ProtectedTokenKind, string> = {
  markup: "TAG",
  "semantic-line-break": "BR",
  url: "URL",
  email: "EMAIL",
};

interface Candidate {
  index: number;
  raw: string;
  kind: ProtectedTokenKind;
}

/**
 * Protect subtitle markup, semantic line breaks, URLs, and email addresses
 * before model generation. The scanner is intentionally small and
 * deterministic; it is not an HTML parser and does not execute any content.
 */
export function protectSubtitleText(
  input: string,
  options: { placeholderOffset?: number } = {}
): ProtectedText {
  const value = String(input);
  const offset = Number.isSafeInteger(options.placeholderOffset)
    ? Math.max(0, options.placeholderOffset as number)
    : 0;

  const candidatesAt = (from: number): Candidate | undefined => {
    const candidates: Candidate[] = [];

    const lineBreak = /(?:\r\n|\n|\r|\\N|\\n)/g;
    lineBreak.lastIndex = from;
    const breakMatch = lineBreak.exec(value);
    if (breakMatch) {
      candidates.push({
        index: breakMatch.index,
        raw: breakMatch[0],
        kind: "semantic-line-break",
      });
    }

    const url = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi;
    url.lastIndex = from;
    const urlMatch = url.exec(value);
    if (urlMatch) {
      let raw = urlMatch[0];
      // Sentence punctuation adjacent to a URL is normal subtitle text.
      const trailing = raw.match(/[.,!?;:)}\]]+$/)?.[0] ?? "";
      if (trailing) raw = raw.slice(0, -trailing.length);
      if (raw.length > 0) {
        candidates.push({ index: urlMatch.index, raw, kind: "url" });
      }
    }

    const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    email.lastIndex = from;
    const emailMatch = email.exec(value);
    if (emailMatch) {
      candidates.push({ index: emailMatch.index, raw: emailMatch[0], kind: "email" });
    }

    const markup = /<\/?[A-Za-z][^<>\r\n]*>/g;
    markup.lastIndex = from;
    const markupMatch = markup.exec(value);
    if (markupMatch) {
      const raw = markupMatch[0];
      candidates.push({
        index: markupMatch.index,
        raw,
        kind: /^<br\b[^>]*\/?\s*>$/i.test(raw)
          ? "semantic-line-break"
          : "markup",
      });
    }

    candidates.sort((left, right) => {
      if (left.index !== right.index) return left.index - right.index;
      // At the same position prefer a URL/email over markup, and a semantic
      // break over a generic tag. This keeps matching deterministic.
      const rank: Record<ProtectedTokenKind, number> = {
        url: 0,
        email: 1,
        "semantic-line-break": 2,
        markup: 3,
      };
      return rank[left.kind] - rank[right.kind];
    });
    return candidates[0];
  };

  const tokens: ProtectedToken[] = [];
  const output: string[] = [];
  let cursor = 0;
  let order = 0;
  let tokenIndex = offset;

  while (cursor < value.length) {
    const candidate = candidatesAt(cursor);
    if (!candidate) break;

    // A trailing URL punctuation adjustment can make the candidate empty;
    // guard against an accidental non-progressing loop.
    if (candidate.index < cursor || candidate.raw.length === 0) break;

    output.push(value.slice(cursor, candidate.index));
    const placeholder = `__ST_${PLACEHOLDER_PREFIX[candidate.kind]}_${tokenIndex}__`;
    output.push(placeholder);
    tokens.push({
      placeholder,
      raw: candidate.raw,
      kind: candidate.kind,
      order,
    });
    order += 1;
    tokenIndex += 1;
    cursor = candidate.index + candidate.raw.length;
  }

  output.push(value.slice(cursor));
  return { text: output.join(""), tokens };
}

/** Return placeholders in source order without interpreting their contents. */
export function extractPlaceholderSequence(value: string): string[] {
  return String(value).match(PLACEHOLDER_PATTERN) ?? [];
}

function expectedPlaceholders(
  source: readonly ProtectedToken[] | string
): string[] {
  if (typeof source !== "string") return source.map((token) => token.placeholder);
  const placeholders = extractPlaceholderSequence(source);
  // Callers may pass either protected model text or the original subtitle
  // text. Derive the expected sequence from original text when needed.
  return placeholders.length > 0
    ? placeholders
    : protectSubtitleText(source).tokens.map((token) => token.placeholder);
}

/**
 * Compare source and model placeholder sequences. Exact sequence equality is
 * required: both missing/extra and reordered placeholders are hard errors.
 */
export function validateProtectedTokens(
  source: readonly ProtectedToken[] | string,
  target: string | readonly ProtectedToken[]
): ProtectedTokenValidation {
  const expected = expectedPlaceholders(source);
  const actual = expectedPlaceholders(target);
  const missing = expected.filter((placeholder, index) => actual[index] !== placeholder);
  const extra = actual.filter((placeholder, index) => expected[index] !== placeholder);
  const valid =
    expected.length === actual.length &&
    expected.every((placeholder, index) => actual[index] === placeholder);

  return {
    valid,
    expected,
    actual,
    missing,
    extra,
    ...(valid
      ? {}
      : {
          message:
            "Protected subtitle placeholders are missing, extra, or out of order",
        }),
  };
}

/** Throw a concise structural error when placeholders do not round-trip. */
export function assertProtectedTokens(
  source: readonly ProtectedToken[] | string,
  target: string | readonly ProtectedToken[]
): void {
  const result = validateProtectedTokens(source, target);
  if (!result.valid) {
    throw new Error(result.message ?? "Protected token validation failed");
  }
}

/**
 * Restore protected source tokens after a target passes exact sequence
 * validation. A queue is used for duplicate placeholders so restoration stays
 * deterministic even when multiple source cues use the same local index.
 */
export function restoreProtectedTokens(
  value: string,
  tokens: readonly ProtectedToken[],
  options: { validate?: boolean } = {}
): string {
  const validate = options.validate ?? true;
  if (validate) assertProtectedTokens(tokens, value);

  const byPlaceholder = new Map<string, string[]>();
  for (const token of tokens) {
    const values = byPlaceholder.get(token.placeholder) ?? [];
    values.push(token.raw);
    byPlaceholder.set(token.placeholder, values);
  }

  const consumed = new Map<string, number>();
  return value.replace(PLACEHOLDER_PATTERN, (placeholder) => {
    const values = byPlaceholder.get(placeholder);
    if (!values || values.length === 0) return placeholder;
    const index = consumed.get(placeholder) ?? 0;
    consumed.set(placeholder, index + 1);
    return values[index] ?? values[values.length - 1];
  });
}

/** Safe target cleanup allowed before structural validation. */
export function normalizeProtectedTarget(value: string): string {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export const protectText = protectSubtitleText;
export const restoreProtectedText = restoreProtectedTokens;
export const validatePlaceholders = validateProtectedTokens;
