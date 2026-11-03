import { describe, it, expect } from "vitest";
import { RateLimiterMemory, RateLimiterRes, TooManyRequestsResponse } from "@aom-js/api";
import { ERROR_TOO_MANY_REQUESTS } from "../src/constants/messages/errors";

describe("RateLimit", () => {
  it("библиотека отдаётся из @aom-js/api", async () => {
    expect(typeof RateLimiterMemory).toBe("function");
    const res = await new RateLimiterMemory({ points: 1, duration: 60 }).consume("k");
    expect(res).toBeInstanceOf(RateLimiterRes);
  });

  it("TooManyRequestsResponse — статус 429", () => {
    expect(new TooManyRequestsResponse(ERROR_TOO_MANY_REQUESTS).status).toBe(429);
    expect(JSON.stringify(TooManyRequestsResponse.JSONSchema())).toContain("429");
  });
});
