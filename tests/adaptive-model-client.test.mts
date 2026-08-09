import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_SYSTEM_CONTRACT,
  boundAdaptiveRepairDraft,
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

test("system contract interpolation leaves no language placeholder and documents brief usage", () => {
  const rendered = renderAdaptivePromptTemplate(ADAPTIVE_SYSTEM_CONTRACT, {
    lang: "日本語",
    additional: "",
  });

  assert.equal(rendered.includes("{{lang}}"), false);
  assert.match(rendered, /file-level summary/);
  assert.match(rendered, /preferred translations consistently/);
});

test("repair draft context is bounded before it is sent back to the model", () => {
  const bounded = boundAdaptiveRepairDraft({ output: "x".repeat(20_000) }) as {
    truncated: boolean;
    preview: string;
  };
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.preview.length <= 12_000);
});
