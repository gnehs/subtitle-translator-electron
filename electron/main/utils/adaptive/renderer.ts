import type { ParsedSubtitle, SubtitleCue } from "../translate.ts";
import { subtitleTimestampToMilliseconds } from "../subtitle-output.ts";
import type {
  AdaptiveCheckpointScene,
  AdaptiveLayoutOptions,
  AdaptiveSourceCue,
  AdaptiveSubtitleViolation,
  AdaptiveTargetCue,
  ProtectedToken,
  TranslationBlock,
} from "./types.ts";
import { layoutAdaptiveBlock } from "./layout.ts";
import { restoreProtectedTokens } from "./protected-tokens.ts";

interface SourceCueRecord extends AdaptiveSourceCue {
  rawProtectedTokens: ProtectedToken[];
}

interface RenderableCue {
  cue: AdaptiveTargetCue;
  sourceOrder: number;
  sceneOrder: number;
  blockOrder: number;
  targetOrder: number;
}

const PROTECTED_RE =
  /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|<\/?[A-Za-z][^>]*>|\\[Nn]|\r?\n/giu;
const PLACEHOLDER_RE = /__ST_(?:TAG|BR|URL|EMAIL)_(\d+)__/g;

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
  if (Array.isArray(source)) return source.filter(isCue);
  return Array.isArray(source.events) ? source.events.filter(isCue) : [];
}

function tokenKindFor(raw: string): ProtectedToken["kind"] {
  if (/^(?:https?:\/\/|ftp:\/\/|www\.)/iu.test(raw)) return "url";
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/iu.test(raw)) return "email";
  if (/^\\[Nn]$|\r?\n/u.test(raw)) return "semantic-line-break";
  if (/^<br\b[^>]*\/?\s*>$/iu.test(raw)) return "semantic-line-break";
  return "markup";
}

function placeholderPrefix(kind: ProtectedToken["kind"]): string {
  switch (kind) {
    case "markup":
      return "TAG";
    case "semantic-line-break":
      return "BR";
    case "url":
      return "URL";
    case "email":
      return "EMAIL";
  }
}

function protectRawText(rawText: string): {
  text: string;
  tokens: ProtectedToken[];
} {
  const tokens: ProtectedToken[] = [];
  let cursor = 0;
  let protectedText = "";
  for (const match of rawText.matchAll(PROTECTED_RE)) {
    let raw = match[0];
    const index = match.index ?? 0;
    protectedText += rawText.slice(cursor, index);
    const trailing = /^(?:https?:\/\/|ftp:\/\/|www\.)/iu.test(raw)
      ? raw.match(/[.,!?;:)}\]]+$/)?.[0] ?? ""
      : "";
    if (trailing) raw = raw.slice(0, -trailing.length);
    const order = tokens.length;
    const kind = tokenKindFor(raw);
    const token: ProtectedToken = {
      placeholder: `__ST_${placeholderPrefix(kind)}_${order}__`,
      raw,
      kind,
      order,
    };
    tokens.push(token);
    protectedText += token.placeholder;
    protectedText += trailing;
    cursor = index + raw.length;
  }
  protectedText += rawText.slice(cursor);
  return { text: protectedText, tokens };
}

function parseTime(value: number | string): number {
  try {
    return Math.max(0, Math.round(subtitleTimestampToMilliseconds(value)));
  } catch {
    return Number.NaN;
  }
}

function createSourceCues(source: ParsedSubtitle): SourceCueRecord[] {
  const events = sourceEvents(source);
  const result: SourceCueRecord[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const rawText = event?.data.text ?? "";
    const protectedText = protectRawText(rawText);
    const startMs = parseTime(event?.data.start ?? 0);
    const endMs = parseTime(event?.data.end ?? 0);
    const previous = result[result.length - 1];
    const gapAfterMs = previous ? startMs - previous.endMs : null;
    const overlapping = previous ? startMs < previous.endMs : false;
    const plainText = rawText
      .replace(/<[^>]*>/g, "")
      .replace(/\\[Nn]/g, "\n")
      .trim();
    result.push({
      id: index,
      sourceIndex: index,
      startMs,
      endMs,
      originalText: rawText,
      modelText: protectedText.text,
      plainText,
      durationMs: Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, endMs - startMs)
        : 0,
      gapAfterMs,
      protectedTokens: protectedText.tokens,
      rawProtectedTokens: protectedText.tokens,
      flags: {
        empty: plainText.length === 0,
        overlapping,
        multiSpeaker: false,
        lockedOneToOne: false,
      },
    });
  }
  return result;
}

function restoreProtectedText(
  text: string,
  tokens: readonly ProtectedToken[],
): string {
  if (tokens.length === 0) return text;
  try {
    return restoreProtectedTokens(text, tokens, { validate: false });
  } catch {
    // Keep renderer output available for legacy checkpoints whose token shape
    // predates the v3 helper; the deterministic local queue below is equivalent
    // for the supported placeholder format.
  }
  const byPlaceholder = new Map<string, string[]>();
  for (const token of tokens) {
    const values = byPlaceholder.get(token.placeholder) ?? [];
    values.push(token.raw);
    byPlaceholder.set(token.placeholder, values);
  }
  const consumed = new Map<string, number>();
  let fallbackOccurrence = 0;
  return text.replace(PLACEHOLDER_RE, (placeholder) => {
    const values = byPlaceholder.get(placeholder);
    if (values && values.length > 0) {
      const index = consumed.get(placeholder) ?? 0;
      consumed.set(placeholder, index + 1);
      return values[index] ?? values[values.length - 1] ?? placeholder;
    }
    const fallback = tokens[fallbackOccurrence++]?.raw;
    return fallback ?? placeholder;
  });
}

function violation(
  code: string,
  severity: "warning" | "error",
  message: string,
  details?: Record<string, string | number | boolean | null>,
): AdaptiveSubtitleViolation {
  return { code, severity, message, ...(details ? { details } : {}) };
}

function formatSrtTimestamp(milliseconds: number): string {
  const value = Math.max(0, Math.round(Number.isFinite(milliseconds) ? milliseconds : 0));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millis = value % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function blockSourceCues(
  block: TranslationBlock,
  sourceCues: readonly SourceCueRecord[],
): SourceCueRecord[] {
  const byId = new Map(sourceCues.map((cue) => [cue.id, cue]));
  return block.sourceCueIds
    .map((id) => byId.get(id))
    .filter((cue): cue is SourceCueRecord => cue !== undefined);
}

function annotateViolation(
  item: AdaptiveSubtitleViolation,
  scene: AdaptiveCheckpointScene,
  block: TranslationBlock,
  targetIndex?: number,
): AdaptiveSubtitleViolation {
  return {
    ...item,
    sceneId: item.sceneId ?? scene.id,
    blockId: item.blockId ?? block.id,
    ...(targetIndex === undefined
      ? {}
      : { targetCueId: item.targetCueId ?? `${block.id}-target-${targetIndex}` }),
  };
}

export interface RenderAdaptiveSrtResult {
  content: string;
  targetCues: AdaptiveTargetCue[];
  violations: AdaptiveSubtitleViolation[];
}

/**
 * Materialize all completed Adaptive blocks into a deterministic SRT file.
 * Source scenes/blocks are sorted by their immutable source ranges, never by
 * model response order or generated identifiers.
 */
export function renderAdaptiveSrt(
  source: ParsedSubtitle,
  scenes: readonly AdaptiveCheckpointScene[],
  layoutOptions: Partial<AdaptiveLayoutOptions> = {},
): RenderAdaptiveSrtResult {
  const sourceCues = createSourceCues(source);
  const violations: AdaptiveSubtitleViolation[] = [];
  sourceCues.forEach((cue) => {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs >= cue.endMs) {
      violations.push(
        violation(
          "adaptive.renderer.invalidSourceTimestamp",
          "error",
          "Source cue has an invalid timestamp and cannot be materialized safely.",
          { sourceCueId: cue.id },
        ),
      );
    }
  });
  const orderedScenes = scenes
    .map((scene, index) => ({ scene, index }))
    .sort((left, right) => left.scene.sourceStart - right.scene.sourceStart || left.index - right.index);
  const rendered: RenderableCue[] = [];
  const coverage = new Map<number, { sceneId: string; blockId: string }>();

  orderedScenes.forEach(({ scene, index: sceneOrder }) => {
    const orderedBlocks = (scene.blocks ?? [])
      .map((block, index) => ({ block, index }))
      .sort((left, right) =>
        left.block.sourceStart - right.block.sourceStart ||
        left.block.sourceEnd - right.block.sourceEnd ||
        left.index - right.index,
      );
    violations.push(
      ...(scene.violations ?? []).map((item) => ({ ...item, sceneId: item.sceneId ?? scene.id })),
    );
    orderedBlocks.forEach(({ block, index: blockOrder }) => {
      const blockCues = blockSourceCues(block, sourceCues);
      if (
        blockCues.some(
          (cue) =>
            !Number.isFinite(cue.startMs) ||
            !Number.isFinite(cue.endMs) ||
            cue.startMs >= cue.endMs,
        )
      ) {
        violations.push(
          violation(
            "adaptive.renderer.invalidBlockTimestamp",
            "error",
            "A translation block references an invalid source timestamp.",
            { blockId: block.id },
          ),
        );
        return;
      }
      const layout = layoutAdaptiveBlock(block, blockCues, layoutOptions);
      layout.violations.forEach((item) => violations.push(annotateViolation(item, scene, block)));
      blockCues.forEach((cue) => {
        const prior = coverage.get(cue.id);
        if (prior) {
          violations.push(
            violation(
              "adaptive.renderer.duplicateCoverage",
              "error",
              "A source cue is covered by more than one translation block.",
              { sourceCueId: cue.id },
            ),
          );
        } else {
          coverage.set(cue.id, { sceneId: scene.id, blockId: block.id });
        }
      });
      layout.targetCues.forEach((cue, targetOrder) => {
        const tokens = blockCues.flatMap((sourceCue) => sourceCue.rawProtectedTokens);
        const semanticText = restoreProtectedText(cue.semanticText, tokens);
        const renderedText = restoreProtectedText(cue.renderedText, tokens);
        const restoredCue: AdaptiveTargetCue = {
          ...cue,
          semanticText,
          renderedText,
          warnings: cue.warnings.map((item) =>
            annotateViolation(item, scene, block, targetOrder),
          ),
        };
        rendered.push({
          cue: restoredCue,
          sourceOrder: block.sourceStart,
          sceneOrder,
          blockOrder,
          targetOrder,
        });
      });
    });
  });

  const requiredSourceIds = sourceCues
    .filter((cue) => !cue.flags.empty && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
    .map((cue) => cue.id);
  const missingSourceIds = requiredSourceIds.filter((id) => !coverage.has(id));
  if (missingSourceIds.length > 0) {
    violations.push(
      violation(
        "adaptive.renderer.coverageMissing",
        "error",
        "Final Adaptive output does not cover every non-empty source cue.",
        { missingCount: missingSourceIds.length },
      ),
    );
  }

  rendered.sort(
    (left, right) =>
      left.cue.sourceStart - right.cue.sourceStart ||
      left.cue.sourceEnd - right.cue.sourceEnd ||
      left.sceneOrder - right.sceneOrder ||
      left.blockOrder - right.blockOrder ||
      left.targetOrder - right.targetOrder,
  );

  const targetCues = rendered.map((item) => item.cue);
  for (let index = 1; index < targetCues.length; index += 1) {
    const previous = targetCues[index - 1];
    const current = targetCues[index];
    if (previous && current && current.startMs < previous.endMs) {
      violations.push(
        violation(
          "adaptive.renderer.overlap",
          "warning",
          "Rendered target cues overlap after source-order materialization.",
          { previousEndMs: previous.endMs, startMs: current.startMs },
        ),
      );
    }
  }
  const srtCues = targetCues.map((cue, index) =>
    [
      String(index + 1),
      `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
      cue.renderedText,
    ].join("\n"),
  );
  const content = srtCues.length > 0 ? `${srtCues.join("\n\n")}\n` : "";
  return { content, targetCues, violations };
}

export const renderAdaptiveSubtitle = renderAdaptiveSrt;
export { formatSrtTimestamp };
