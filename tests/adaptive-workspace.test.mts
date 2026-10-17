import assert from "node:assert/strict";
import test from "node:test";
import { createSceneWorkspace } from "../electron/main/utils/adaptive/workspace.ts";
import { sceneOf, sourceCues } from "./helpers/adaptive-scene-fixture.mts";

const threeCueScene = () =>
  sceneOf(sourceCues(["I didn't know", "he was your brother.", "I wanted to tell you."]));

test("a fresh workspace reports every cue as uncovered and cannot be submitted", () => {
  const workspace = createSceneWorkspace(threeCueScene());

  assert.deepEqual(workspace.uncovered(), [{ from: 0, to: 2 }]);
  assert.equal(workspace.toDraft(), undefined);
  const check = workspace.submit();
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((item) => item.code === "adaptive.workspace.uncovered"));
  assert.equal(workspace.submitted, false);
  assert.match(workspace.view(), /\(untranslated\)/);
});

test("merging adjacent cues and covering the rest yields a submittable draft", () => {
  const workspace = createSceneWorkspace(threeCueScene());

  const merged = workspace.edit({ from: 0, to: 1, targets: ["我不知道他是你哥哥。"] });
  assert.equal(merged.ok, true);
  const split = workspace.edit({ from: 2, to: 2, targets: ["我本來想", "告訴你。"] });
  assert.equal(split.ok, true);

  assert.deepEqual(workspace.toDraft(), {
    blocks: [
      { take: 2, targets: ["我不知道他是你哥哥。"] },
      { take: 1, targets: ["我本來想", "告訴你。"] },
    ],
  });
  const check = workspace.submit();
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(workspace.submitted, true);
  assert.match(workspace.view(), /=> \[0-1\] "我不知道他是你哥哥。"/);
});

test("an overlapping edit replaces whole blocks and reports the cues it uncovered", () => {
  const workspace = createSceneWorkspace(threeCueScene());
  workspace.edit({ from: 0, to: 1, targets: ["A"] });
  workspace.edit({ from: 2, to: 2, targets: ["B"] });

  const result = workspace.edit({ from: 1, to: 2, targets: ["C"] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.replaced, [{ from: 0, to: 1 }, { from: 2, to: 2 }]);
  assert.deepEqual(result.uncovered, [{ from: 0, to: 0 }]);
  assert.deepEqual(workspace.uncovered(), [{ from: 0, to: 0 }]);
  assert.deepEqual(
    workspace.blocks.map((block) => [block.from, block.to]),
    [[1, 2]],
  );
});

test("editing after a submit requires a new submit", () => {
  const workspace = createSceneWorkspace(threeCueScene());
  workspace.edit({ from: 0, to: 2, targets: ["All"] });
  assert.equal(workspace.submit().ok, true);
  workspace.edit({ from: 0, to: 0, targets: ["Part"] });
  assert.equal(workspace.submitted, false);
});

test("structurally invalid edits are rejected without changing the workspace", () => {
  const scene = sceneOf(sourceCues(["a", "b", "c", "d", "e"]));
  const workspace = createSceneWorkspace(scene);
  const cases: Array<[{ from: number; to: number; targets: string[] }, string]> = [
    [{ from: 0, to: 4, targets: ["x"] }, "adaptive.workspace.spanTooLarge"],
    [{ from: 3, to: 1, targets: ["x"] }, "adaptive.workspace.invalidRange"],
    [{ from: 0, to: 9, targets: ["x"] }, "adaptive.workspace.invalidRange"],
    [{ from: 0, to: 0, targets: [] }, "adaptive.workspace.invalidTargetCount"],
    [{ from: 0, to: 0, targets: ["1", "2", "3", "4"] }, "adaptive.workspace.invalidTargetCount"],
    [{ from: 0, to: 0, targets: ["  "] }, "adaptive.workspace.emptyTarget"],
    [{ from: 0, to: 0, targets: ["x".repeat(1001)] }, "adaptive.workspace.targetTooLong"],
  ];
  for (const [input, code] of cases) {
    const result = workspace.edit(input);
    assert.equal(result.ok, false, code);
    if (result.ok) continue;
    assert.ok(result.errors.some((item) => item.code === code), `${code}: ${JSON.stringify(result.errors)}`);
  }
  assert.deepEqual(workspace.blocks, []);
});

test("a locked one-to-one scene refuses merges and splits", () => {
  const scene = sceneOf(sourceCues([{ text: "a", lockedOneToOne: true }, "b"]));
  const workspace = createSceneWorkspace(scene);

  const merge = workspace.edit({ from: 0, to: 1, targets: ["ab"] });
  assert.equal(merge.ok, false);
  const split = workspace.edit({ from: 1, to: 1, targets: ["b1", "b2"] });
  assert.equal(split.ok, false);
  assert.equal(workspace.edit({ from: 0, to: 0, targets: ["a"] }).ok, true);
  assert.equal(workspace.edit({ from: 1, to: 1, targets: ["b"] }).ok, true);
  assert.equal(workspace.submit().ok, true);
});

test("placeholders must be preserved exactly and in order", () => {
  const scene = sceneOf(sourceCues(["<i>Hello</i> there", "friend"]));
  const workspace = createSceneWorkspace(scene);
  const [tag0, tag1] = scene.core[0]!.modelText.match(/__ST_TAG_\d+__/g)!;

  const dropped = workspace.edit({ from: 0, to: 0, targets: ["你好"] });
  assert.equal(dropped.ok, false);
  const reordered = workspace.edit({ from: 0, to: 0, targets: [`${tag1}你好${tag0}`] });
  assert.equal(reordered.ok, false);
  const kept = workspace.edit({ from: 0, to: 0, targets: [`${tag0}你好${tag1}`] });
  assert.equal(kept.ok, true);
});

test("check reports layout lint as warnings keyed by the block range", () => {
  const scene = sceneOf(sourceCues([{ text: "short", durationMs: 600 }, "second"]));
  const workspace = createSceneWorkspace(scene);
  workspace.edit({
    from: 0,
    to: 0,
    targets: ["這是一句非常非常長而且完全塞不進六百毫秒的字幕文字內容"],
  });
  workspace.edit({ from: 1, to: 1, targets: ["第二句"] });

  const check = workspace.check();
  assert.equal(check.ok, true);
  assert.ok(
    check.warnings.some(
      (item) =>
        item.code.startsWith("adaptive.layout.") && item.from === 0 && item.to === 0,
    ),
    JSON.stringify(check.warnings),
  );
  assert.equal(check.warnings.some((item) => item.from === 1), false);
});

test("view lists every cue with timing and the block that covers it", () => {
  const workspace = createSceneWorkspace(
    sceneOf(sourceCues([{ text: "one", durationMs: 1_500, gapMs: 300 }, "two"])),
  );
  workspace.edit({ from: 1, to: 1, targets: ["二"] });
  const lines = workspace.view().split("\n");
  assert.equal(lines[0], "0 | 1500ms | gap 300ms | one");
  assert.equal(lines[1], "  => [0] (untranslated)");
  assert.equal(lines[2], "1 | 1000ms | gap - | two");
  assert.equal(lines[3], '  => [1] "二"');
});
