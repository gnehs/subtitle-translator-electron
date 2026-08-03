import {
  normalizeAssFontName,
  type AssBilingualFontOptions,
} from "../ass-bilingual.ts";
import {
  millisecondsToAssTimestamp,
  subtitleTimestampToMilliseconds,
} from "../subtitle-output.ts";
import type { ParsedSubtitle, SubtitleCue } from "../translate.ts";
import { renderAdaptiveSrt } from "./renderer.ts";
import type {
  AdaptiveCheckpointScene,
  AdaptiveLayoutOptions,
  AdaptiveSubtitleViolation,
  AdaptiveTargetCue,
} from "./types.ts";

/** ASS event kinds emitted by the Adaptive bilingual renderer. */
export type AdaptiveAssEventKind = "original" | "translation";

/** A materialized ASS Dialogue event, before it is serialized. */
export interface AdaptiveAssEvent {
  kind: AdaptiveAssEventKind;
  /** Alias retained for callers that use `type` for event discrimination. */
  type: AdaptiveAssEventKind;
  layer: number;
  style: string;
  name: string;
  startMs: number;
  endMs: number;
  text: string;
  sourceCueId?: number;
  sourceCueIds?: number[];
  sourceStart?: number;
  sourceEnd?: number;
  blockId?: string;
  targetCueId?: string;
}

/** Options specific to the standalone Adaptive ASS output. */
export interface AdaptiveAssRenderOptions {
  /** Existing translation parameters use this name. */
  assFonts?: AssBilingualFontOptions;
  /** A convenient alias for callers that already use a `fonts` object. */
  fonts?: AssBilingualFontOptions;
  translationFont?: string;
  originalFont?: string;
  translationStyleName?: string;
  originalStyleName?: string;
  translationLayer?: number;
  originalLayer?: number;
  translationMarginV?: number;
  originalMarginV?: number;
  translationFontSize?: number;
  originalFontSize?: number;
  playResX?: number;
  playResY?: number;
  /** Source cues are preserved by default, including empty cues. */
  includeEmptySourceCues?: boolean;
  translationEventName?: string;
  originalEventName?: string;
}

/**
 * Options accepted as the third argument.  Keeping layout and ASS options in
 * one type lets existing Adaptive callers pass `{ assFonts }` without adding
 * a positional argument, while the fourth argument remains available for
 * explicit separation.
 */
export type AdaptiveAssRendererOptions = Partial<AdaptiveLayoutOptions> &
  AdaptiveAssRenderOptions;

export interface RenderAdaptiveAssResult {
  /** Complete UTF-8 ASS document, including Script Info, Styles, and Events. */
  content: string;
  /** Target cues materialized by the deterministic Adaptive layout engine. */
  targetCues: AdaptiveTargetCue[];
  /** Timing, coverage, layout, and serialization violations. */
  violations: AdaptiveSubtitleViolation[];
  /** Original source Dialogue events, in immutable source order. */
  originalEvents: AdaptiveAssEvent[];
  /** Translation Dialogue events, in Adaptive target order. */
  translationEvents: AdaptiveAssEvent[];
  /** Original events followed by translation events. */
  events: AdaptiveAssEvent[];
}

const ASS_STYLE_FORMAT = [
  "Name",
  "Fontname",
  "Fontsize",
  "PrimaryColour",
  "SecondaryColour",
  "OutlineColour",
  "BackColour",
  "Bold",
  "Italic",
  "Underline",
  "StrikeOut",
  "ScaleX",
  "ScaleY",
  "Spacing",
  "Angle",
  "BorderStyle",
  "Outline",
  "Shadow",
  "Alignment",
  "MarginL",
  "MarginR",
  "MarginV",
  "Encoding",
] as const;

const ASS_EVENT_FORMAT = [
  "Layer",
  "Start",
  "End",
  "Style",
  "Name",
  "MarginL",
  "MarginR",
  "MarginV",
  "Effect",
  "Text",
] as const;

const DEFAULT_ASS_FONT = "Arial";
const DEFAULT_TRANSLATION_STYLE = "ST Translation";
const DEFAULT_ORIGINAL_STYLE = "ST Original";
const DEFAULT_TRANSLATION_LAYER = 1;
const DEFAULT_ORIGINAL_LAYER = 0;
const DEFAULT_TRANSLATION_MARGIN_V = 24;
const DEFAULT_ORIGINAL_MARGIN_V = 24;
const DEFAULT_TRANSLATION_FONT_SIZE = 20;
const DEFAULT_ORIGINAL_FONT_SIZE = 16;
const DEFAULT_PLAY_RES_X = 384;
const DEFAULT_PLAY_RES_Y = 288;

const ASS_TAG_RE = /<\/?[A-Za-z][^>]*>/g;

function isCue(value: unknown): value is SubtitleCue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const data = record.data;
  return (
    record.type === "cue" &&
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).text === "string"
  );
}

function sourceEvents(source: ParsedSubtitle): SubtitleCue[] {
  return Array.isArray(source)
    ? source.filter(isCue)
    : Array.isArray(source.events)
      ? source.events.filter(isCue)
      : [];
}

function violation(
  code: string,
  severity: "warning" | "error",
  message: string,
  details?: Record<string, string | number | boolean | null>,
): AdaptiveSubtitleViolation {
  return {
    code,
    severity,
    message,
    ...(details ? { details } : {}),
  };
}

function parseTimestamp(value: number | string): number {
  try {
    const milliseconds = subtitleTimestampToMilliseconds(value);
    return Number.isFinite(milliseconds) && milliseconds >= 0
      ? Math.round(milliseconds)
      : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.round(parsed))
    : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(9_999, Math.round(parsed))
    : fallback;
}

function layerValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function normalizeAssIdentifier(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  // Style and Name fields are comma-delimited.  Braces/backslashes are also
  // rejected so a caller cannot inject an override block into the header.
  if (
    candidate.length === 0 ||
    candidate.length > 100 ||
    /[,{}\\\r\n]/u.test(candidate)
  ) {
    return fallback;
  }
  return candidate;
}

function normalizeFont(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_ASS_FONT;
  const trimmed = value.trim();
  // normalizeAssFontName rejects commas, braces, and backslashes according to
  // the same constraints used by the strict ASS renderer.
  return normalizeAssFontName(trimmed) || DEFAULT_ASS_FONT;
}

function assTagForHtmlTag(rawTag: string): string | undefined {
  const opening = /^<\s*([A-Za-z][\w-]*)\b[^>]*>$/u.exec(rawTag);
  const closing = /^<\s*\/\s*([A-Za-z][\w-]*)\s*>$/u.exec(rawTag);
  const tagName = (opening?.[1] ?? closing?.[1] ?? "").toLowerCase();
  const isClosing = Boolean(closing);
  if (tagName === "br") return isClosing ? undefined : "\\N";
  const tags: Record<string, string> = {
    b: "b",
    bold: "b",
    i: "i",
    em: "i",
    italic: "i",
    s: "s",
    strike: "s",
    strikeout: "s",
    u: "u",
    underline: "u",
  };
  const assTag = tags[tagName];
  if (!assTag || (!opening && !closing)) return undefined;
  return `{\\${assTag}${isClosing ? "0" : "1"}}`;
}

/**
 * Escape untrusted text for ASS while preserving the documented line-break,
 * hard-space, and lightweight HTML-style markup used by SRT/VTT files.
 *
 * Braces/backslashes are never copied into output unescaped; otherwise text
 * such as `{\\pos(0,0)}` could become a libass override block.  Literal braces
 * use libass/ASS's `\\{` and `\\}` escapes, while known tags are converted to
 * generated override blocks.
 */
export function escapeAdaptiveAssText(value: string): string {
  const normalized = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n");
  let result = "";
  let cursor = 0;
  for (const match of normalized.matchAll(ASS_TAG_RE)) {
    const index = match.index ?? 0;
    result += escapeAssFragment(normalized.slice(cursor, index));
    const rawTag = match[0] ?? "";
    result += assTagForHtmlTag(rawTag) ?? escapeAssFragment(rawTag);
    cursor = index + rawTag.length;
  }
  result += escapeAssFragment(normalized.slice(cursor));
  return result;
}

function escapeAssFragment(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "\n") {
      result += "\\N";
      continue;
    }
    if (character === "\\") {
      const next = value[index + 1] ?? "";
      if (next === "N" || next === "n") {
        result += "\\" + next;
        index += 1;
      } else if (next === "h") {
        result += "\\h";
        index += 1;
      } else {
        // `\\\\` is parsed as a literal backslash by libass-compatible
        // renderers and prevents accidental `\\t`, `\\pos`, etc. tags.
        result += "\\\\";
      }
      continue;
    }
    if (character === "{") {
      result += "\\{";
      continue;
    }
    if (character === "}") {
      result += "\\}";
      continue;
    }
    // ASS has no useful representation for C0 controls.  Keep tabs as spaces
    // and drop other controls instead of allowing physical line breaks or NULs
    // into an event record.
    if (character === "\t") {
      result += " ";
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) continue;
    result += character;
  }
  return result;
}

function formatAssTimestamp(milliseconds: number): string {
  return millisecondsToAssTimestamp(Math.max(0, Math.round(milliseconds)));
}

function assCentiseconds(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 10));
}

function styleLine({
  name,
  font,
  fontSize,
  alignment,
  marginV,
}: {
  name: string;
  font: string;
  fontSize: number;
  alignment: number;
  marginV: number;
}): string {
  const values = [
    name,
    font,
    String(fontSize),
    "&H00FFFFFF",
    "&H00000000",
    "&H002F2F2F",
    "&H00000000",
    "0",
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    "1",
    "1",
    "1",
    String(alignment),
    "20",
    "20",
    String(marginV),
    "1",
  ];
  return `Style: ${values.join(",")}`;
}

function dialogueLine(event: AdaptiveAssEvent): string {
  const fields = [
    String(event.layer),
    formatAssTimestamp(event.startMs),
    formatAssTimestamp(event.endMs),
    event.style,
    event.name,
    "0000",
    "0000",
    "0000",
    "",
  ];
  // Text is intentionally the final field: commas are legal in ASS dialogue
  // text and must not be treated as field separators.
  return `Dialogue: ${fields.join(",")},${event.text}`;
}

function splitRendererOptions(
  layoutOrOptions: AdaptiveAssRendererOptions,
  explicitOptions: AdaptiveAssRenderOptions | undefined,
): {
  layoutOptions: Partial<AdaptiveLayoutOptions>;
  assOptions: AdaptiveAssRenderOptions;
} {
  const assKeys = new Set<keyof AdaptiveAssRenderOptions>([
    "assFonts",
    "fonts",
    "translationFont",
    "originalFont",
    "translationStyleName",
    "originalStyleName",
    "translationLayer",
    "originalLayer",
    "translationMarginV",
    "originalMarginV",
    "translationFontSize",
    "originalFontSize",
    "playResX",
    "playResY",
    "includeEmptySourceCues",
    "translationEventName",
    "originalEventName",
  ]);
  const layoutOptions: Partial<AdaptiveLayoutOptions> = {};
  const assOptions: AdaptiveAssRenderOptions = {};
  for (const [key, value] of Object.entries(layoutOrOptions)) {
    if (assKeys.has(key as keyof AdaptiveAssRenderOptions)) {
      (assOptions as Record<string, unknown>)[key] = value;
    } else {
      (layoutOptions as Record<string, unknown>)[key] = value;
    }
  }
  return {
    layoutOptions,
    assOptions: { ...assOptions, ...(explicitOptions ?? {}) },
  };
}

function createAssDocument({
  originalEvents,
  translationEvents,
  translationStyle,
  originalStyle,
  translationFont,
  originalFont,
  translationFontSize,
  originalFontSize,
  translationMarginV,
  originalMarginV,
  playResX,
  playResY,
}: {
  originalEvents: readonly AdaptiveAssEvent[];
  translationEvents: readonly AdaptiveAssEvent[];
  translationStyle: string;
  originalStyle: string;
  translationFont: string;
  originalFont: string;
  translationFontSize: number;
  originalFontSize: number;
  translationMarginV: number;
  originalMarginV: number;
  playResX: number;
  playResY: number;
}): string {
  const lines = [
    "[Script Info]",
    "; Generated by Subtitle Translator Adaptive bilingual renderer",
    "ScriptType: v4.00+",
    "Collisions: Normal",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "Timer: 100.0000",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    `Format: ${ASS_STYLE_FORMAT.join(", ")}`,
    styleLine({
      name: originalStyle,
      font: originalFont,
      fontSize: originalFontSize,
      alignment: 8,
      marginV: originalMarginV,
    }),
    styleLine({
      name: translationStyle,
      font: translationFont,
      fontSize: translationFontSize,
      alignment: 2,
      marginV: translationMarginV,
    }),
    "",
    "[Events]",
    `Format: ${ASS_EVENT_FORMAT.join(", ")}`,
    ...originalEvents.map(dialogueLine),
    ...translationEvents.map(dialogueLine),
    "",
  ];
  return lines.join("\n");
}

/**
 * Render Adaptive source/target cues as a complete bilingual ASS document.
 *
 * Source events and translated events intentionally use separate streams:
 * source cues retain their own timing and the target cues use the timings
 * materialized by `layoutAdaptiveBlock`.  This is therefore safe for 2→1,
 * 1→2, and other many-to-many blocks; no index-based pairing is performed.
 */
export function renderAdaptiveAss(
  source: ParsedSubtitle,
  scenes: readonly AdaptiveCheckpointScene[],
  layoutOrOptions: AdaptiveAssRendererOptions = {},
  explicitOptions?: AdaptiveAssRenderOptions,
): RenderAdaptiveAssResult {
  const { layoutOptions, assOptions } = splitRendererOptions(
    layoutOrOptions,
    explicitOptions,
  );
  const rendered = renderAdaptiveSrt(source, scenes, layoutOptions);
  const violations = [...rendered.violations];
  const sourceCues = sourceEvents(source);

  const originalStyle = normalizeAssIdentifier(
    assOptions.originalStyleName,
    DEFAULT_ORIGINAL_STYLE,
  );
  let translationStyle = normalizeAssIdentifier(
    assOptions.translationStyleName,
    DEFAULT_TRANSLATION_STYLE,
  );
  if (translationStyle === originalStyle) {
    translationStyle = `${DEFAULT_TRANSLATION_STYLE} 2`;
  }
  const originalName = normalizeAssIdentifier(
    assOptions.originalEventName,
    "Original",
  );
  const translationName = normalizeAssIdentifier(
    assOptions.translationEventName,
    "Translation",
  );
  const originalLayer = layerValue(
    assOptions.originalLayer,
    DEFAULT_ORIGINAL_LAYER,
  );
  let translationLayer = layerValue(
    assOptions.translationLayer,
    DEFAULT_TRANSLATION_LAYER,
  );
  if (translationLayer === originalLayer) translationLayer = originalLayer + 1;

  const fonts = assOptions.assFonts ?? assOptions.fonts ?? {};
  const translationFont = normalizeFont(
    assOptions.translationFont ?? fonts.translationFont,
  );
  const originalFont = normalizeFont(
    assOptions.originalFont ?? fonts.originalFont,
  );
  const translationFontSize = positiveInteger(
    assOptions.translationFontSize,
    DEFAULT_TRANSLATION_FONT_SIZE,
  );
  const originalFontSize = positiveInteger(
    assOptions.originalFontSize,
    DEFAULT_ORIGINAL_FONT_SIZE,
  );
  const translationMarginV = nonNegativeInteger(
    assOptions.translationMarginV,
    DEFAULT_TRANSLATION_MARGIN_V,
  );
  const originalMarginV = nonNegativeInteger(
    assOptions.originalMarginV,
    DEFAULT_ORIGINAL_MARGIN_V,
  );
  const playResX = positiveInteger(assOptions.playResX, DEFAULT_PLAY_RES_X);
  const playResY = positiveInteger(assOptions.playResY, DEFAULT_PLAY_RES_Y);
  const includeEmptySourceCues = assOptions.includeEmptySourceCues ?? true;

  const originalEvents: AdaptiveAssEvent[] = [];
  sourceCues.forEach((cue, sourceCueId) => {
    const startMs = parseTimestamp(cue.data.start);
    const endMs = parseTimestamp(cue.data.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      // `renderAdaptiveSrt` already reports the source timestamp violation;
      // avoid serializing an event whose ASS centisecond interval is invalid.
      return;
    }
    const text = escapeAdaptiveAssText(cue.data.text);
    if (!includeEmptySourceCues && text.length === 0) return;
    if (assCentiseconds(endMs) <= assCentiseconds(startMs)) {
      violations.push(
        violation(
          "adaptive.ass.timestampResolution",
          "error",
          "Source cue duration is shorter than ASS centisecond precision.",
          { sourceCueId, startMs, endMs },
        ),
      );
      return;
    }
    originalEvents.push({
      kind: "original",
      type: "original",
      layer: originalLayer,
      style: originalStyle,
      name: originalName,
      startMs,
      endMs,
      text,
      sourceCueId,
      sourceCueIds: [sourceCueId],
      sourceStart: sourceCueId,
      sourceEnd: sourceCueId,
    });
  });

  const translationEvents: AdaptiveAssEvent[] = [];
  for (const cue of rendered.targetCues) {
    if (
      !Number.isFinite(cue.startMs) ||
      !Number.isFinite(cue.endMs) ||
      cue.startMs >= cue.endMs
    ) {
      violations.push(
        violation(
          "adaptive.ass.invalidTargetTimestamp",
          "error",
          "Adaptive target cue has an invalid timestamp and was not serialized.",
          { targetCueId: cue.id, startMs: cue.startMs, endMs: cue.endMs },
        ),
      );
      continue;
    }
    if (assCentiseconds(cue.endMs) <= assCentiseconds(cue.startMs)) {
      violations.push(
        violation(
          "adaptive.ass.timestampResolution",
          "error",
          "Adaptive target duration is shorter than ASS centisecond precision.",
          { targetCueId: cue.id, startMs: cue.startMs, endMs: cue.endMs },
        ),
      );
      continue;
    }
    const text = escapeAdaptiveAssText(cue.renderedText);
    if (text.length === 0) {
      violations.push(
        violation(
          "adaptive.ass.emptyTargetText",
          "error",
          "Adaptive target cue has no serializable text.",
          { targetCueId: cue.id },
        ),
      );
      continue;
    }
    translationEvents.push({
      kind: "translation",
      type: "translation",
      layer: translationLayer,
      style: translationStyle,
      name: translationName,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text,
      sourceStart: cue.sourceStart,
      sourceEnd: cue.sourceEnd,
      sourceCueId: cue.sourceCueIds[0],
      sourceCueIds: [...cue.sourceCueIds],
      blockId: cue.blockId,
      targetCueId: cue.id,
    });
  }

  const content = createAssDocument({
    originalEvents,
    translationEvents,
    translationStyle,
    originalStyle,
    translationFont,
    originalFont,
    translationFontSize,
    originalFontSize,
    translationMarginV,
    originalMarginV,
    playResX,
    playResY,
  });

  return {
    content,
    targetCues: rendered.targetCues,
    violations,
    originalEvents,
    translationEvents,
    events: [...originalEvents, ...translationEvents],
  };
}

export const renderAdaptiveASS = renderAdaptiveAss;
export const renderAdaptiveBilingualAss = renderAdaptiveAss;
export const renderAdaptiveAssSubtitle = renderAdaptiveAss;
export { formatAssTimestamp };
