import assert from "node:assert/strict";
import test from "node:test";
import { RequestRateLimiter } from "../electron/main/utils/request-rate-limiter.ts";

test("cancels a request waiting behind another limiter turn", async () => {
  const limiter = new RequestRateLimiter({
    requestsPerMinute: 60,
    minimumIntervalMs: 10_000,
  });
  const firstRequest = limiter.waitForSlot();
  const controller = new AbortController();
  const secondRequest = limiter.waitForSlot(controller.signal);

  controller.abort();

  await assert.rejects(secondRequest, (error: unknown) => {
    return error instanceof Error && error.name === "AbortError";
  });
  await firstRequest;
});
