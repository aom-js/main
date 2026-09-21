import {
  Headers,
  Controller,
  Middleware,
  Security,
  This,
  Responses,
  Cookies,
  ThisRef,
  RefFunction,
  DelayRefStack,
} from "@aom-js/router";
//
import { AuthRequiredResponse } from "../../responses";
import { messages } from "../../constants";

const SafeSecuritySchema = ThisRef((<T extends typeof AuthCookieToken>(constructor: T) => [
  Security({ ...CookieTokenSecuritySchema, name: constructor.COOKIE_NAME }),
]) as RefFunction);

/** OpenAPI security scheme for `AuthCookieToken`: an API key carried in a cookie. */
export const CookieTokenSecuritySchema = {
  type: "apiKey",
  in: "cookie",
};

/**
 * Extracts an opaque session token from a cookie (`static COOKIE_NAME`, default `"sessionId"`).
 * This class only reads the cookie's presence — validating the token itself (session lookup) is
 * the application's job, typically in a `@This(AuthCookieToken)`-consuming middleware.
 *
 * @example
 * ```ts
 * import { AuthCookieToken } from "@aom-js/api";
 * import { Controller, Before, Get, This } from "@aom-js/router";
 *
 * @Controller()
 * class ProfileController {
 *   @Get("/profile")
 *   @Before(AuthCookieToken.Required)
 *   static async profile(@This(AuthCookieToken) { value }: AuthCookieToken) {
 *     // value is the raw sessionId cookie value
 *   }
 * }
 * ```
 */
@Controller()
export class AuthCookieToken {
  /** Name of the cookie carrying the session token. */
  static COOKIE_NAME: string = "sessionId";

  /** The raw cookie value, populated by `Required`. */
  value!: string;

  /**
   * Middleware: reads `COOKIE_NAME` from the request cookies into `value`.
   *
   * @throws {AuthRequiredResponse} 401, when the cookie is missing
   */
  @Middleware()
  @DelayRefStack(SafeSecuritySchema)
  @Responses(AuthRequiredResponse.JSONSchema())
  static async Required(@This() self: AuthCookieToken, @Cookies() cookies: Record<string, string>) {
    self.value = cookies[this.COOKIE_NAME];

    if (!self.value) {
      throw new AuthRequiredResponse(messages.AUTH_NO_COOKIE);
    }
  }
}
