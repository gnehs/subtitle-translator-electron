import assert from "node:assert/strict";
import test from "node:test";

import { isNewerVersion } from "../src/utils/version.ts";

test("only treats a greater release as newer", () => {
  assert.equal(isNewerVersion("2.0.0", "2.0.1"), true);
  assert.equal(isNewerVersion("2.0.0", "2.0.0"), false);
  assert.equal(isNewerVersion("2.0.0", "1.8.0"), false);
});

test("normalizes a v-prefixed release tag for comparison", () => {
  assert.equal(isNewerVersion("2.0.0", "v2.0.0"), false);
  assert.equal(isNewerVersion("2.0.0", "v2.1.0"), true);
});

test("follows SemVer pre-release precedence and ignores build metadata", () => {
  assert.equal(isNewerVersion("2.0.0-beta.1", "2.0.0-beta.2"), true);
  assert.equal(isNewerVersion("2.0.0-beta.2", "2.0.0"), true);
  assert.equal(isNewerVersion("2.0.0", "2.0.0-beta.3"), false);
  assert.equal(isNewerVersion("2.0.0+build.1", "2.0.0+build.2"), false);
});

test("ignores malformed versions instead of showing a false update", () => {
  assert.equal(isNewerVersion("2.0", "3.0.0"), false);
  assert.equal(isNewerVersion("2.0.0", "latest"), false);
  assert.equal(isNewerVersion("2.0.0", "2.0.0-01"), false);
});
