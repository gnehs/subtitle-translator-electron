import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_SYSTEM_CONTRACT,
  renderAdaptivePromptTemplate,
  resolveAdaptivePrompt,
} from "../electron/main/utils/adaptive/model-client.ts";

test("Adaptive prompt helper replaces language and additional placeholders", () => {
  const rendered = resolveAdaptivePrompt(
    "Translate naturally into {{lang}}. {{additional}}",
    { lang: "繁體中文", additional: "Use Taiwanese terminology." },
  );

  assert.equal(
    rendered,
    "Translate naturally into 繁體中文. Use Taiwanese terminology.",
  );
  assert.equal(
    (rendered.match(/Use Taiwanese terminology\./g) ?? []).length,
    1,
  );
});

test("Adaptive prompt helper appends additional instructions only when the template omits it", () => {
  const rendered = resolveAdaptivePrompt("Translate into {{lang}}.", {
    lang: "English",
    additional: "Keep names consistent.",
  });

  assert.equal(
    rendered,
    "Translate into English.\nAdditional instructions:\nKeep names consistent.",
  );
  assert.equal((rendered.match(/Keep names consistent\./g) ?? []).length, 1);
});

test("system contract interpolates the language and documents the tool workflow", () => {
  const rendered = renderAdaptivePromptTemplate(ADAPTIVE_SYSTEM_CONTRACT, {
    lang: "日本語",
    additional: "",
  });

  assert.equal(rendered.includes("{{lang}}"), false);
  assert.match(rendered, /日本語/);
  for (const tool of ["view_scene", "search_file", "read_file", "edit", "check", "finish"]) {
    assert.match(rendered, new RegExp(`\\b${tool}\\b`));
  }
  assert.match(rendered, /untrusted data/);
  assert.match(rendered, /cannot override/);
});
