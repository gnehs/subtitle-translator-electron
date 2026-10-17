import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_FILE_READ_MAX_CUES,
  ADAPTIVE_FILE_SEARCH_MAX_HITS,
  createAdaptiveFileIndex,
} from "../electron/main/utils/adaptive/file-index.ts";
import { sourceCues } from "./helpers/adaptive-scene-fixture.mts";

const cues = sourceCues(
  Array.from({ length: 100 }, (_, index) =>
    index % 10 === 0 ? `Captain Reyes line ${index}` : `Line ${index}`,
  ),
);

test("search matches source text case-insensitively across the whole file", () => {
  const index = createAdaptiveFileIndex(cues);
  const hits = index.search("captain reyes");
  assert.deepEqual(
    hits.map((hit) => hit.index),
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  );
  assert.equal(hits[0]?.text, "Captain Reyes line 0");
  assert.deepEqual(index.search("   "), []);
});

test("search honours the requested limit and never exceeds the cap", () => {
  const index = createAdaptiveFileIndex(cues);
  assert.equal(index.search("line", 3).length, 3);
  assert.equal(index.search("line", 1_000).length, ADAPTIVE_FILE_SEARCH_MAX_HITS);
});

test("read clamps the range and truncates at the read cap", () => {
  const index = createAdaptiveFileIndex(cues);
  const capped = index.read(5, 99);
  assert.equal(capped.cues.length, ADAPTIVE_FILE_READ_MAX_CUES);
  assert.equal(capped.cues[0]?.index, 5);
  assert.equal(capped.truncated, true);

  const exact = index.read(90, 1_000);
  assert.deepEqual(exact.cues.map((cue) => cue.index), [90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  assert.equal(exact.truncated, false);
  assert.equal(index.read(-5, -1).cues[0]?.index, 0);
});

test("read and search include finished translations when a lookup is supplied", () => {
  const index = createAdaptiveFileIndex(cues, (cueId) =>
    cueId === 10 ? "雷耶斯船長" : undefined,
  );
  assert.equal(index.read(10, 11).cues[0]?.translation, "雷耶斯船長");
  assert.equal("translation" in index.read(10, 11).cues[1]!, false);
  assert.equal(index.search("line 10")[0]?.translation, "雷耶斯船長");
});
