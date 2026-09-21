import { Headers, Controller, Middleware, Security, This, Responses } from "@aom-js/router";
//
import { AuthRequiredResponse } from "../../responses";
import { messages } from "../../constants";

/** OpenAPI security scheme for `AuthHeaderToken`: an HTTP Bearer token. */
export const HeaderTokenSecuritySchema = {
  type: "http",
  scheme: "bearer",
};

/**
 * Extracts a `<TOKEN_NAME> <value>` token from one of `HEADERS_KEYS` (default: just
 * `authorization`). This class only splits and validates the token's shape — resolving it to a
 * user/session is the application's job, typically in a `\@This(AuthHeaderToken)`-consuming
 * middleware chained after `Required`.
 *
 * `HEADERS_KEYS` can list more than one header to support carrying the token through headers
 * that aren't `authorization` (e.g. `sec-websocket-protocol` for WebSocket handshakes, where an
 * underscore is accepted in place of the separating space).
 *
 * @example
 * ```ts
 * import { AuthHeaderToken } from "@aom-js/api";
 * import { Controller, Before, After, Get, This } from "@aom-js/router";
 *
 * \@Controller()
 * class CurrentUser {
 *   \@Before(AuthHeaderToken.Required)
 *   \@After(CurrentUser.Init)
 *   static async Required() {}
 *
 *   static async Init(\@This(AuthHeaderToken) token: AuthHeaderToken) {
 *     // token.value is the raw bearer token, ready to be looked up
 *   }
 * }
 * ```
 */
@Controller()
export class AuthHeaderToken {
  /** Expected token scheme, matched against the header's prefix (default `"Bearer"`). */
  static TOKEN_NAME: string = "Bearer";

  /** Header names checked, in order, for a `<TOKEN_NAME> <value>` pair (default `["authorization"]`). */
  static HEADERS_KEYS: string[] = ["authorization"];

  /** The token value (after the scheme), populated by `Required`. */
  value!: string;

  /** The token scheme found in the header, populated by `Required`. */
  type!: string;

  /**
   * Middleware: finds the first of `HEADERS_KEYS` carrying a `<TOKEN_NAME> <value>` pair and
   * splits it into `type`/`value`.
   *
   * @throws {AuthRequiredResponse} 401, when none of `HEADERS_KEYS` carries a token, or the
   * scheme doesn't match `TOKEN_NAME`
   */
  @Middleware()
  @Security(HeaderTokenSecuritySchema)
  @Responses(AuthRequiredResponse.JSONSchema())
  static async Required(
    @This() self: AuthHeaderToken,
    @Headers() headers: Record<string, string | string[]>,
  ) {
    this.HEADERS_KEYS.forEach((headerKey) => {
      const [headerValue] = [headers[headerKey]].flat();
      if (!self.value && headerValue) {
        // this is a special allowance that lets the token be passed through alternate headers,
        // e.g. `sec-websocket-protocol`
        [self.type, self.value] = headerValue
          .replace(`${this.TOKEN_NAME}_`, `${this.TOKEN_NAME} `)
          .split(" ");
      }
    });

    if (!self.value && !self.type) {
      throw new AuthRequiredResponse(messages.AUTH_NO_TOKEN);
    }

    if (self.type !== this.TOKEN_NAME) {
      throw new AuthRequiredResponse(messages.AUTH_WRONG_TOKEN_TYPE);
    }
  }
}
