import assert from "node:assert/strict";
import test from "node:test";
import {
  getPathClaimKey,
  hasPathClaimConflict,
} from "../electron/main/utils/path-claims.ts";

test("case-folds path claims on case-insensitive desktop platforms", () => {
  assert.equal(
    getPathClaimKey("/tmp/Output/Foo.srt", "darwin"),
    getPathClaimKey("/tmp/output/foo.srt", "darwin")
  );
  assert.equal(
    getPathClaimKey("/tmp/Output/Foo.srt", "win32"),
    getPathClaimKey("/tmp/output/foo.srt", "win32")
  );
});

test("preserves case on Linux", () => {
  assert.notEqual(
    getPathClaimKey("/tmp/Output/Foo.srt", "linux"),
    getPathClaimKey("/tmp/output/foo.srt", "linux")
  );
});

test("keeps request-wide claims after an active writer releases", () => {
  const outputKey = getPathClaimKey("/tmp/output/episode.srt", "darwin");
  const batchClaims = new Set([outputKey]);
  const activeClaims = new Set<string>();

  assert.equal(
    hasPathClaimConflict([outputKey], batchClaims, activeClaims),
    true
  );
});
