import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedApiHost,
  parseAllowedApiHost,
} from "../electron/main/utils/api-host.ts";

test("allows HTTPS providers and loopback HTTP servers", () => {
  assert.equal(isAllowedApiHost("https://api.openai.com/v1"), true);
  assert.equal(isAllowedApiHost("http://localhost:11434/v1"), true);
  assert.equal(isAllowedApiHost("http://127.0.0.1:1234/v1"), true);
  assert.equal(isAllowedApiHost("http://[::1]:1234/v1"), true);
});

test("rejects remote HTTP, credentials, and invalid URLs", () => {
  assert.equal(isAllowedApiHost("http://example.com/v1"), false);
  assert.equal(isAllowedApiHost("https://user:secret@example.com/v1"), false);
  assert.equal(isAllowedApiHost("not a URL"), false);
});

test("returns a parsed URL for callers that need to append paths", () => {
  assert.equal(
    parseAllowedApiHost("https://example.com/api/v1/").pathname,
    "/api/v1/"
  );
});
