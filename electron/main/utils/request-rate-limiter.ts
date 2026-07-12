import { setTimeout as sleep } from "node:timers/promises";

const REQUEST_WINDOW_MS = 60_000;

interface RequestRateLimiterOptions {
  requestsPerMinute: number;
  minimumIntervalMs?: number;
}

/** Serializes request starts while enforcing a rolling one-minute limit. */
export class RequestRateLimiter {
  private readonly requestsPerMinute: number;
  private readonly minimumIntervalMs: number;
  private requestTimes: number[] = [];
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor({
    requestsPerMinute,
    minimumIntervalMs = 0,
  }: RequestRateLimiterOptions) {
    if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error("Requests per minute must be a positive integer");
    }
    if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) {
      throw new Error("Minimum request interval must be a non-negative number");
    }

    this.requestsPerMinute = requestsPerMinute;
    this.minimumIntervalMs = minimumIntervalMs;
  }

  async waitForSlot(): Promise<void> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = previous.then(() => turn);

    await previous;
    try {
      while (true) {
        const now = Date.now();
        this.requestTimes = this.requestTimes.filter(
          (requestTime) => now - requestTime < REQUEST_WINDOW_MS
        );

        const oldestRequestAt = this.requestTimes[0];
        const windowWaitMs =
          this.requestTimes.length >= this.requestsPerMinute &&
          oldestRequestAt !== undefined
            ? oldestRequestAt + REQUEST_WINDOW_MS - now
            : 0;
        const intervalWaitMs =
          this.lastRequestAt > 0
            ? this.lastRequestAt + this.minimumIntervalMs - now
            : 0;
        const waitMs = Math.max(windowWaitMs, intervalWaitMs);

        if (waitMs <= 0) {
          const requestStartedAt = Date.now();
          this.requestTimes.push(requestStartedAt);
          this.lastRequestAt = requestStartedAt;
          return;
        }

        await sleep(waitMs);
      }
    } finally {
      release();
    }
  }
}
