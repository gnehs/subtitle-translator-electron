import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPlaceholderSequence,
  protectSubtitleText,
  restoreProtectedTokens,
  validateProtectedTokens,
} from "../electron/main/utils/adaptive/protected-tokens.ts";

test("protected subtitle tokens round-trip markup, breaks, URL, and email", () => {
  const source = "<i>Hello</i>\nhttps://example.test mail@example.test";
  const protectedText = protectSubtitleText(source);
  assert.deepEqual(
    protectedText.tokens.map((token) => token.kind),
    ["markup", "markup", "semantic-line-break", "url", "email"]
  );
  assert.deepEqual(
    extractPlaceholderSequence(protectedText.text),
    protectedText.tokens.map((token) => token.placeholder)
  );
  assert.equal(restoreProtectedTokens(protectedText.text, protectedText.tokens), source);
});

test("placeholder order and cardinality are hard validation errors", () => {
  const protectedText = protectSubtitleText("<b>x</b>");
  const placeholders = protectedText.tokens.map((token) => token.placeholder);
  assert.equal(
    validateProtectedTokens(protectedText.tokens, `${placeholders[0]}x`).valid,
    false
  );
  assert.equal(
    validateProtectedTokens(
      protectedText.tokens,
      `${placeholders[1]}x${placeholders[0]}`
    ).valid,
    false
  );
  assert.throws(() =>
    restoreProtectedTokens(`${placeholders[0]}x`, protectedText.tokens)
  );
});

test("duplicate cue-local placeholders restore through an ordered queue", () => {
  const first = protectSubtitleText("<i>first</i>");
  const second = protectSubtitleText("<b>second</b>");
  const tokens = [...first.tokens, ...second.tokens];
  const combined = `${first.text} ${second.text}`;
  assert.equal(
    restoreProtectedTokens(combined, tokens),
    "<i>first</i> <b>second</b>"
  );
});
