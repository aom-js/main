import { type RefFunction, Controller, CookieParameters, DelayRefStack } from "@aom-js/router";
import { ThisRef, Cookies, This, Middleware, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";

//
import { CookieJSONSchema } from "../schemas";
import { CookieBuildersBase } from "./common";

const SafeOrigin = ThisRef((<T extends typeof CookieBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof CookieBuilderConstructor>(
  constructor: T,
) => [CookieParameters(...constructor.JSONSchema())]) as RefFunction);

/**
 * Base controller returned by {@link CookieBuilder}. Not re-exported from the package entry point (used by `@aom-js/api/testing`) — use
 * `CookieBuilder(schema)`.
 */
@Controller()
export class CookieBuilderConstructor<
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends CookieBuildersBase {
  /** The validated cookies, populated by the `Cookie` middleware. */
  cookies!: R;

  /**
   * Middleware: throws unless the validated cookies have at least one property set.
   *
   * @throws {WrongDataResponse} 400, when no cookies matched `schema`
   */
  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Cookies(SafeOrigin) cookies: any) {
    if (!Object.entries(cookies).length) {
      throw new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  /**
   * Middleware: validates request cookies against `schema` via `SafeData`, stores the result on
   * `cookies`, and registers them as `CookieParameters` in OpenAPI.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Cookie(
    @Cookies(SafeOrigin) cookies: any,
    @This() queryBuilder: CookieBuilderConstructor<typeof CookieJSONSchema>,
  ) {
    queryBuilder.cookies = cookies;
  }
}

/**
 * Builds a controller that validates request cookies against a component schema.
 *
 * @param schema - component schema (`\@ComponentSchema`) describing the expected cookies
 * @returns an anonymous controller class with `Cookie`/`NotEmpty` middlewares, a `cookies`
 * instance field, and `static JSONSchema()` for OpenAPI (inherited from `CookieBuildersBase`)
 *
 * @example
 * ```ts
 * import { CookieBuilder } from "@aom-js/api";
 * import { Controller, Get, Before, This } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class SessionCookie {
 *   \@PropertySchema.String()
 *   sessionId!: string;
 * }
 *
 * \@Controller()
 * class SessionCookieValue extends CookieBuilder(SessionCookie) {}
 *
 * \@Controller()
 * class SomeController {
 *   \@Get("/profile")
 *   \@Before(SessionCookieValue.Cookie)
 *   static async profile(\@This(SessionCookieValue) { cookies }: SessionCookieValue) {
 *     // cookies.sessionId is validated
 *   }
 * }
 * ```
 */
export function CookieBuilder<T extends ClassConstructor>(
  schema: T,
): typeof CookieBuilderConstructor<T> {
  return class extends CookieBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
