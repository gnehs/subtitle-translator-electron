import assert from "node:assert/strict";
import test from "node:test";
import {
  getRetryAfterMsFromHeaders,
  MAX_RETRY_DELAY_MS,
} from "../electron/main/utils/retry-after.ts";

test("prefers the OpenAI millisecond retry header", () => {
  assert.equal(
    getRetryAfterMsFromHeaders({
      "Retry-After": "10",
      "retry-after-ms": "250",
    }),
    250
  );
});

test("parses seconds and HTTP dates", () => {
  const now = Date.parse("2026-07-13T00:00:00Z");

  assert.equal(getRetryAfterMsFromHeaders({ "retry-after": "1.5" }, now), 1500);
  assert.equal(
    getRetryAfterMsFromHeaders(
      { "retry-after": "Mon, 13 Jul 2026 00:00:02 GMT" },
      now
    ),
    2000
  );
});

test("caps unreasonable delays and rejects invalid values", () => {
  assert.equal(
    getRetryAfterMsFromHeaders({ "retry-after-ms": "999999999" }),
    MAX_RETRY_DELAY_MS
  );
  assert.equal(getRetryAfterMsFromHeaders({ "retry-after": "invalid" }), 0);
});
