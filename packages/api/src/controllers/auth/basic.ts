import { Ctx, Middleware, Responses, Security } from "@aom-js/router";
import { Controller, Headers } from "@aom-js/router";
//
import { messages } from "../../constants";
import { type HttpCtx } from "../../types";
import { AuthRequiredResponse } from "../../responses";

/** OpenAPI security scheme for `AuthBasic`: HTTP Basic authentication. */
export const BasicSecuritySchema = {
  type: "http",
  scheme: "basic",
};

/**
 * HTTP Basic authentication against a single shared credential (`static BASIC_AUTH`), used by
 * this package to guard `BaseRootController`'s `/openapi.json` and `/swagger.html`.
 *
 * `static BASIC_AUTH` is unset by default — when it stays empty, `Required` allows every request
 * through without checking a header at all. Set it before wiring up routes that must actually be
 * protected.
 *
 * @example
 * ```ts
 * import { AuthBasic } from "@aom-js/api";
 * import { Controller, Before, Get } from "@aom-js/router";
 *
 * AuthBasic.BASIC_AUTH = "user:secret"; // "Authorization: Basic " + base64("user:secret")
 *
 * @Controller()
 * class AdminController {
 *   @Get("/admin")
 *   @Before(AuthBasic.Required)
 *   static async index() { return "ok"; }
 * }
 * ```
 */
@Controller()
export class AuthBasic {
  /** Shared `user:password` credential checked by `Required`; empty means the check is disabled. */
  static BASIC_AUTH: string;

  /**
   * Middleware: rejects the request unless `Authorization: Basic <base64(BASIC_AUTH)>` matches.
   * Also sets `WWW-Authenticate: Basic` on the response when a check is performed.
   *
   * @throws {AuthRequiredResponse} 401, when `BASIC_AUTH` is set and the header doesn't match
   */
  @Middleware()
  @Responses(AuthRequiredResponse.JSONSchema())
  @Security(BasicSecuritySchema)
  static async Required(@Ctx() ctx: HttpCtx, @Headers() { authorization }: any) {
    const [, basic] = String(authorization).split(" ");
    if (this.BASIC_AUTH) {
      ctx.res.setHeader("WWW-Authenticate", "Basic");
      if (basic !== Buffer.from(this.BASIC_AUTH).toString("base64")) {
        throw new AuthRequiredResponse(messages.AUTH_REQUIRED);
      }
    }
    ///
  }
}
