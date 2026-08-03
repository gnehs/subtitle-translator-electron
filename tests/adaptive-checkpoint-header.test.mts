import assert from "node:assert/strict";
import test from "node:test";
import { isAdaptiveCheckpointHeader } from "../src/utils/adaptiveCheckpoint.ts";

test("accepts only Adaptive v3 SRT/VTT checkpoint headers", () => {
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 3, kind: "adaptive", format: "srt" }),
    true
  );
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 3, kind: "adaptive", format: "vtt" }),
    true
  );
});

test("rejects strict checkpoints when switching a pending task to Adaptive", () => {
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 3, kind: "strict", format: "srt" }),
    false
  );
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 2, kind: "strict", format: "srt" }),
    false
  );
});

test("rejects v3 checkpoints whose source format is ASS/SSA", () => {
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 3, kind: "adaptive", format: "ass" }),
    false
  );
  assert.equal(
    isAdaptiveCheckpointHeader({ version: 3, kind: "adaptive", format: "ssa" }),
    false
  );
});
