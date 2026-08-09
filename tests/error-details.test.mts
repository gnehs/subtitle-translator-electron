import assert from "node:assert/strict";
import test from "node:test";
import { getErrorDetails } from "../electron/main/utils/error-details.ts";

test("does not repeat the same top-level error message", () => {
  assert.equal(
    getErrorDetails(new Error("ERR_ADAPTIVE_INCOMPLETE_COVERAGE")).message,
    "ERR_ADAPTIVE_INCOMPLETE_COVERAGE"
  );
});

test("keeps distinct nested provider context", () => {
  const error = Object.assign(new Error("Translation failed"), {
    cause: { message: "Provider unavailable", status: 503 },
  });

  assert.deepEqual(getErrorDetails(error), {
    message: "Translation failed | Provider unavailable",
    name: "Error",
    status: 503,
  });
});

test("preserves an application error code for localized presentation", () => {
  const error = Object.assign(new Error("Internal fallback detail"), {
    code: "adaptive.scene.strictFallbackFailed",
  });

  assert.equal(
    getErrorDetails(error).code,
    "adaptive.scene.strictFallbackFailed"
  );
});
