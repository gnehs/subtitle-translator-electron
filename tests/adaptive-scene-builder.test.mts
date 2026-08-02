import assert from "node:assert/strict";
import test from "node:test";
import { buildAdaptiveSourceCues } from "../electron/main/utils/adaptive/source-cues.ts";
import { buildAdaptiveScenes } from "../electron/main/utils/adaptive/scene-builder.ts";

function cues(count: number) {
  return buildAdaptiveSourceCues(
    Array.from({ length: count }, (_, index) => ({
      text: index === count - 1 ? `Cue ${index}.` : `Cue ${index}`,
      start: index * 1_000,
      end: index * 1_000 + 800,
    }))
  );
}

test("scene builder prefers sentence boundaries and hard gaps", () => {
  const source = cues(3);
  source[1]!.gapAfterMs = 1_500;
  const scenes = buildAdaptiveScenes(source, {
    contextSize: 1,
    policy: { preferredMaxCueCount: 2, hardMaxCueCount: 3 },
  });
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0]?.core.map((cue) => cue.sourceIndex), [0, 1]);
  assert.deepEqual(scenes[1]?.before.map((cue) => cue.sourceIndex), [1]);
});

test("overlap, empty, and locked cues are one-to-one scenes", () => {
  const source = buildAdaptiveSourceCues([
    { text: "A", start: 0, end: 900 },
    { text: "", start: 1_000, end: 1_900 },
    { text: "B", start: 1_500, end: 2_500, lockedOneToOne: true },
  ]);
  const scenes = buildAdaptiveScenes(source);
  assert.deepEqual(scenes.map((scene) => scene.core.length), [1, 1, 1]);
  assert.equal(scenes[1]?.lockedOneToOne, true);
  assert.equal(scenes[2]?.lockedOneToOne, true);
});

test("completed source coverage is not recreated", () => {
  const scenes = buildAdaptiveScenes(cues(4), {
    completedCoverage: [{ sourceStart: 1, sourceEnd: 2 }],
  });
  assert.equal(
    scenes.some((scene) => scene.core.some((cue) => cue.sourceIndex === 1 || cue.sourceIndex === 2)),
    false
  );
  assert.deepEqual(
    scenes.flatMap((scene) => scene.core.map((cue) => cue.sourceIndex)),
    [0, 3]
  );
});

test("large source input remains bounded and preserves monotonic coverage", () => {
  const source = cues(500);
  const scenes = buildAdaptiveScenes(source);
  const covered = scenes.flatMap((scene) =>
    scene.core.map((cue) => cue.sourceIndex)
  );
  assert.equal(covered.length, 500);
  assert.deepEqual(covered, Array.from({ length: 500 }, (_, index) => index));
});
