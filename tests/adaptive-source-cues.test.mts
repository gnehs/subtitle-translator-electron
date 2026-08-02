import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdaptiveSourceCues,
  createAdaptiveModelCues,
  detectMultiSpeaker,
} from "../electron/main/utils/adaptive/source-cues.ts";

test("source cues are immutable derived records with normalized timing", () => {
  const source = [
    {
      type: "cue",
      data: {
        text: "I didn't know",
        start: "00:00:01,000",
        end: "00:00:01,900",
      },
    },
    {
      type: "cue",
      data: {
        text: "he was your brother.",
        start: "00:00:01,940",
        end: "00:00:03,200",
      },
    },
  ];
  const cues = buildAdaptiveSourceCues(source);
  assert.equal(cues[0]?.startMs, 1_000);
  assert.equal(cues[0]?.durationMs, 900);
  assert.equal(cues[0]?.gapAfterMs, 40);
  assert.equal(cues[1]?.gapAfterMs, null);
  assert.equal("translatedText" in (source[0]?.data ?? {}), false);
  assert.deepEqual(createAdaptiveModelCues(cues).map((cue) => cue.i), [0, 1]);
});

test("overlap and multi-speaker cues are flagged as barriers", () => {
  assert.equal(detectMultiSpeaker("JOHN: Hi\nMARY: Hello"), true);
  const cues = buildAdaptiveSourceCues([
    {
      text: "JOHN: Hi\nMARY: Hello",
      start: 1_000,
      end: 2_000,
    },
    { text: "Next", start: 1_500, end: 2_500 },
  ]);
  assert.equal(cues[0]?.flags.multiSpeaker, true);
  assert.equal(cues[0]?.flags.overlapping, true);
  assert.equal(cues[1]?.flags.overlapping, true);
});
