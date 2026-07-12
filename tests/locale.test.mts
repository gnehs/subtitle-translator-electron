import assert from "node:assert/strict";
import test from "node:test";

import { parseStoredLocale } from "../src/utils/locale.ts";

test("reads locale serialized by useLocalStorage", () => {
  assert.equal(parseStoredLocale('"zh-TW"'), "zh-TW");
});

test("keeps compatibility with a plain locale value", () => {
  assert.equal(parseStoredLocale("zh-CN"), "zh-CN");
});

test("falls back to English for missing or invalid values", () => {
  assert.equal(parseStoredLocale(null), "en-US");
  assert.equal(parseStoredLocale("invalid"), "en-US");
  assert.equal(parseStoredLocale("null"), "en-US");
});
