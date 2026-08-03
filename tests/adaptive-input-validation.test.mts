import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdaptiveInputValidationError,
} from "../electron/main/utils/adaptive/input-validation.ts";

const validCheckpoint = {
  version: 3,
  kind: "adaptive",
  format: "srt",
} as const;

test("accepts SRT and VTT Adaptive sources", () => {
  assert.equal(
    getAdaptiveInputValidationError({
      extension: "srt",
      outputFormat: "srt-translation",
    }),
    undefined
  );
  assert.equal(
    getAdaptiveInputValidationError({
      extension: "VTT",
      outputFormat: "srt-translation",
    }),
    undefined
  );
});

test("rejects ASS/SSA and legacy v1/v2 JSON checkpoints", () => {
  for (const extension of ["ass", "ssa"]) {
    assert.match(
      getAdaptiveInputValidationError({
        extension,
        outputFormat: "srt-translation",
      }) ?? "",
      /ADAPTIVE_UNSUPPORTED_INPUT_FORMAT/
    );
  }

  for (const version of [1, 2]) {
    assert.match(
      getAdaptiveInputValidationError({
        extension: "json",
        outputFormat: "srt-translation",
        checkpointHeader: { version, kind: "strict", format: "srt" },
      }) ?? "",
      /ADAPTIVE_INCOMPATIBLE_CHECKPOINT/
    );
  }
});

test("accepts translated SRT and bilingual ASS output for Adaptive", () => {
  assert.equal(
    getAdaptiveInputValidationError({
      extension: "srt",
      outputFormat: "ass-bilingual",
    }),
    undefined
  );
  assert.match(
    getAdaptiveInputValidationError({
      extension: "srt",
      outputFormat: "srt-bilingual",
    }) ?? "",
    /ADAPTIVE_UNSUPPORTED_OUTPUT_FORMAT/
  );
});

test("accepts only adaptive v3 JSON checkpoints with srt/vtt format", () => {
  assert.equal(
    getAdaptiveInputValidationError({
      extension: "json",
      outputFormat: "srt-translation",
      checkpointHeader: validCheckpoint,
    }),
    undefined
  );

  assert.equal(
    getAdaptiveInputValidationError({
      extension: "json",
      outputFormat: "srt-translation",
      checkpointHeader: { ...validCheckpoint, format: "ass" },
    }),
    "ERR_ADAPTIVE_UNSUPPORTED_INPUT_FORMAT"
  );
});
