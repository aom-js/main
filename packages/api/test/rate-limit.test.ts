import { describe, it, expect } from "vitest";
import { RateLimiterMemory, RateLimiterRes } from "@aom-js/api";

describe("RateLimit", () => {
  it("библиотека отдаётся из @aom-js/api", async () => {
    expect(typeof RateLimiterMemory).toBe("function");
    const res = await new RateLimiterMemory({ points: 1, duration: 60 }).consume("k");
    expect(res).toBeInstanceOf(RateLimiterRes);
  });
});
