import { protectSubtitleText } from "../../electron/main/utils/adaptive/protected-tokens.ts";
import type {
  AdaptiveScene,
  AdaptiveSourceCue,
} from "../../electron/main/utils/adaptive/types.ts";

export interface CueSpec {
  text: string;
  durationMs?: number;
  gapMs?: number;
  lockedOneToOne?: boolean;
}

export function sourceCues(
  specs: readonly (string | CueSpec)[],
  startId = 0,
): AdaptiveSourceCue[] {
  let cursor = startId * 2_000;
  return specs.map((item, offset) => {
    const spec = typeof item === "string" ? { text: item } : item;
    const duration = spec.durationMs ?? 1_000;
    const gap = spec.gapMs ?? 200;
    const protectedText = protectSubtitleText(spec.text);
    const startMs = cursor;
    const endMs = startMs + duration;
    cursor = endMs + gap;
    const id = startId + offset;
    return {
      id,
      sourceIndex: id,
      startMs,
      endMs,
      originalText: spec.text,
      modelText: protectedText.text,
      plainText: spec.text.replace(/<[^>]*>/g, ""),
      durationMs: duration,
      gapAfterMs: offset === specs.length - 1 ? null : gap,
      protectedTokens: protectedText.tokens,
      flags: {
        empty: spec.text.trim().length === 0,
        overlapping: false,
        multiSpeaker: false,
        lockedOneToOne: spec.lockedOneToOne ?? false,
      },
    };
  });
}

export function sceneOf(
  core: readonly AdaptiveSourceCue[],
  context: { before?: AdaptiveSourceCue[]; after?: AdaptiveSourceCue[] } = {},
): AdaptiveScene {
  const first = core[0]!;
  const last = core.at(-1)!;
  return {
    id: `scene-${first.sourceIndex}-${last.sourceIndex}`,
    sourceStart: first.sourceIndex,
    sourceEnd: last.sourceIndex,
    core: [...core],
    before: context.before ?? [],
    after: context.after ?? [],
    lockedOneToOne: core.some((cue) => cue.flags.lockedOneToOne),
  };
}
