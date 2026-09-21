//
import { type RefFunction } from "@aom-js/router";
import { ThisRef, This, Middleware, Responses, Before } from "@aom-js/router";
import { Controller, DelayRefStack, Headers, Parameters } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { HeaderJSONSchema } from "../schemas";
import { HeaderBuildersBase } from "./common";

const SafeOrigin = ThisRef((<T extends typeof HeadersBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof HeadersBuilderConstructor>(
  constructor: T,
) => [Parameters(...constructor.JSONSchema())]) as RefFunction);

/**
 * Base controller returned by {@link HeadersBuilder}. Not exported directly — use
 * `HeadersBuilder(schema)`.
 */
@Controller()
class HeadersBuilderConstructor<
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends HeaderBuildersBase {
  /** The validated headers, populated by `Headers`/`ImplicitHeaders`. */
  headers!: R;

  // define the header with its description in OpenAPI
  /**
   * Middleware: same validation as `ImplicitHeaders`, but also registers the headers as
   * documented parameters in OpenAPI. Prefer this one on public endpoints.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Before(HeadersBuilderConstructor.ImplicitHeaders)
  static async Headers() {}

  // define the header without describing it in OpenAPI
  /**
   * Middleware: validates request headers against `schema` via `SafeData` and stores the result
   * on `headers`, without describing them in OpenAPI.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async ImplicitHeaders<T extends typeof HeaderJSONSchema>(
    @Headers(SafeOrigin) headers: any,
    @This() self: HeadersBuilderConstructor<T>,
  ) {
    self.headers = headers;
  }
}

/**
 * Builds a controller that validates request headers against a component schema.
 *
 * @param schema - component schema (`@ComponentSchema`) describing the expected headers
 * @returns an anonymous controller class with `Headers`/`ImplicitHeaders` middlewares, a
 * `headers` instance field, and `static JSONSchema()` for OpenAPI (inherited from `HeaderBuildersBase`)
 *
 * @example
 * ```ts
 * import { HeadersBuilder } from "@aom-js/api";
 * import { Controller, Get, Before, This } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class OrgHeaders {
 *   @PropertySchema.String({ isOptional: true })
 *   "data-org-id"?: string;
 * }
 *
 * @Controller()
 * class CurrentOrgHeader extends HeadersBuilder(OrgHeaders) {}
 *
 * @Controller()
 * class SomeController {
 *   @Get("/items")
 *   @Before(CurrentOrgHeader.Headers)
 *   static async list(@This(CurrentOrgHeader) { headers }: CurrentOrgHeader) {
 *     // headers is validated OrgHeaders
 *   }
 * }
 * ```
 */
export function HeadersBuilder<T extends ClassConstructor>(
  schema: T,
): typeof HeadersBuilderConstructor<T> {
  return class extends HeadersBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
