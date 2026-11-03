import { Controller, Ctx, Middleware, Responses, This } from "@aom-js/router";
import { RateLimiterRes, type RateLimiterAbstract } from "rate-limiter-flexible";
//
import { messages } from "../constants";
import { type HttpCtx } from "../types";
import { TooManyRequestsResponse } from "../responses";

/**
 * Base for request-rate limits: counts requests per `key` in a `rate-limiter-flexible` limiter
 * and answers `429` with a `Retry-After` header once the limit is spent.
 *
 * A subclass supplies the limiter (`static Limiter`, shared by all requests) and, in a step that
 * runs before `Apply`, the `key` to count by — an IP address, a user id, a login. Without a
 * `Limiter` or with an empty `key`, `Apply` throws a plain `Error` (a developer mistake, not a
 * 429 and not a pass-through). A store failure inside the limiter is rethrown unchanged.
 *
 * @example
 * ```ts
 * import { RateLimit, RateLimiterMemory } from "@aom-js/api";
 * import { Controller, Before, After, Middleware, Post, Body, This } from "@aom-js/router";
 *
 * \@Controller()
 * class LoginLimit extends RateLimit {
 *   static readonly Limiter = new RateLimiterMemory({ points: 5, duration: 60 });
 *
 *   \@Middleware()
 *   \@After(LoginLimit.Apply)
 *   static async ByLogin(\@This() self: LoginLimit, \@Body() { login }: LoginBody) {
 *     self.key = login;
 *   }
 * }
 *
 * \@Controller()
 * class Auth {
 *   \@Post("/login")
 *   \@Before(LoginLimit.ByLogin)
 *   static async login() {}
 * }
 * ```
 */
@Controller()
export class RateLimit {
  /** The limiter the subclass counts requests in; one object for all requests. */
  static readonly Limiter: RateLimiterAbstract;

  /** What the request is counted by; set by a step before `Apply`. */
  key: string | null = null;

  /** How many points one request costs. */
  points = 1;

  /** `Limiter` of the subclass; a getter because this object is created anew for every request. */
  get limiter(): RateLimiterAbstract {
    return (this.constructor as typeof RateLimit).Limiter;
  }

  /**
   * Middleware: spends `points` of `key` in `Limiter`.
   * Sets `Retry-After` (whole seconds, at least 1) when the response can carry headers.
   *
   * @throws {TooManyRequestsResponse} 429, when the limit for `key` is spent
   * @throws {Error} when the subclass has no `Limiter` or `key` is empty
   */
  @Middleware()
  @Responses(TooManyRequestsResponse.JSONSchema())
  static async Apply(@Ctx() ctx: HttpCtx, @This() self: RateLimit): Promise<void> {
    if (!self.limiter) throw new Error(messages.CONTROLLERS_RATE_LIMIT_NO_LIMITER);
    if (!self.key) throw new Error(messages.CONTROLLERS_RATE_LIMIT_NO_KEY);
    try {
      await self.limiter.consume(self.key, self.points);
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) throw error;
      ctx.res.setHeader?.(
        "Retry-After",
        String(Math.max(1, Math.ceil(error.msBeforeNext / 1000))),
      );
      throw new TooManyRequestsResponse(messages.ERROR_TOO_MANY_REQUESTS);
    }
  }
}
