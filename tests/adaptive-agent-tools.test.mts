import assert from "node:assert/strict";
import test from "node:test";
import {
  callAdaptiveAgentTool,
  createAdaptiveAgentSession,
} from "../electron/main/utils/adaptive/agent-tools.ts";
import { createAdaptiveFileIndex } from "../electron/main/utils/adaptive/file-index.ts";
import { createSceneWorkspace } from "../electron/main/utils/adaptive/workspace.ts";
import { sceneOf, sourceCues } from "./helpers/adaptive-scene-fixture.mts";

function session() {
  const file = sourceCues(["Earlier line", "I didn't know", "he was your brother.", "Later line"]);
  const scene = sceneOf(file.slice(1, 3), { before: [file[0]!], after: [file[3]!] });
  const workspace = createSceneWorkspace(scene);
  const agent = createAdaptiveAgentSession(workspace, createAdaptiveFileIndex(file));
  return { workspace, agent };
}

test("the tool table exposes the agent surface by name", () => {
  const { agent } = session();
  assert.deepEqual(
    agent.tools.map((tool) => tool.name),
    ["view_scene", "edit", "check", "search_file", "read_file", "finish"],
  );
});

test("a scripted model can view, edit, check, fix and finish through the tools", () => {
  const { workspace, agent } = session();
  const call = (name: string, input: unknown) => callAdaptiveAgentTool(agent, name, input);

  const view = call("view_scene", {});
  assert.equal(view.ok, true);
  assert.match(String((view as { output: { workspace: string } }).output.workspace), /I didn't know/);

  const badEdit = call("edit", { from: 0, to: 1, targets: [] });
  assert.equal(badEdit.ok, false);

  const edit = call("edit", { from: 0, to: 1, targets: ["我不知道他是你哥哥。"] });
  assert.equal(edit.ok, true);
  assert.equal((edit as { output: { ok: boolean } }).output.ok, true);

  const check = call("check", {});
  assert.equal((check as { output: { ok: boolean } }).output.ok, true);

  assert.equal(agent.isComplete(), false);
  const finish = call("finish", {});
  assert.equal((finish as { output: { ok: boolean } }).output.ok, true);
  assert.equal(agent.isComplete(), true);
  assert.equal(workspace.submitted, true);
});

test("finish refuses an incomplete workspace and the session stays open", () => {
  const { agent } = session();
  callAdaptiveAgentTool(agent, "edit", { from: 0, to: 0, targets: ["只有第一句"] });
  const finish = callAdaptiveAgentTool(agent, "finish", {});
  assert.equal(finish.ok, true);
  const output = (finish as { output: { ok: boolean; errors: Array<{ code: string }> } }).output;
  assert.equal(output.ok, false);
  assert.ok(output.errors.some((item) => item.code === "adaptive.workspace.uncovered"));
  assert.equal(agent.isComplete(), false);
});

test("search_file and read_file reach beyond the scene window", () => {
  const { agent } = session();
  const search = callAdaptiveAgentTool(agent, "search_file", { query: "later" });
  assert.deepEqual(
    (search as { output: { hits: Array<{ index: number }> } }).output.hits.map((hit) => hit.index),
    [3],
  );
  const read = callAdaptiveAgentTool(agent, "read_file", { from: 0, to: 0 });
  assert.equal(
    (read as { output: { cues: Array<{ text: string }> } }).output.cues[0]?.text,
    "Earlier line",
  );
});

test("malformed tool input is rejected at the boundary without touching the workspace", () => {
  const { workspace, agent } = session();
  const result = callAdaptiveAgentTool(agent, "edit", { from: "0", to: 1, targets: ["x"] });
  assert.equal(result.ok, false);
  assert.deepEqual(workspace.blocks, []);
  assert.equal(callAdaptiveAgentTool(agent, "nope", {}).ok, false);
});
