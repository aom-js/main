import { type RefFunction, Responses, ThisRef } from "@aom-js/router";
import { Controller, DelayRefStack, Middleware } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { responseJsonSchema } from "../functions";

const SafeOriginParameters = ThisRef((<T extends typeof ResponseBuilderConstructor>(
  constructor: T,
) => [Responses(constructor.JSONSchema())]) as RefFunction);

/**
 * Base controller returned by {@link ResponseBuilder}. Not exported directly — use
 * `ResponseBuilder(schema)`.
 */
@Controller()
class ResponseBuilderConstructor<T extends ClassConstructor, R = InstanceType<T>> {
  /** HTTP status this response is documented under; defaults to `200`, or the value passed to `ResponseBuilder`. */
  static status: number = 200;
  /** The component schema passed to {@link ResponseBuilder}. */
  static schema: ClassConstructor;

  response!: R;

  /**
   * Describes this response for OpenAPI. Typically used directly in `@Responses(...)` rather
   * than via the `Response` middleware.
   *
   * @param description - response description, or an array of lines
   * @param status - overrides the status passed to `ResponseBuilder`
   */
  static JSONSchema(
    description?: string | string[],
    status?: number,
  ): ReturnType<typeof responseJsonSchema> {
    return responseJsonSchema(this.schema, description, status || this.status);
  }

  // this middleware also serves to investigate the hypothesis about a cascading inheritance bug
  /** Middleware that only registers `JSONSchema()` in OpenAPI via `@Responses`; does nothing else. */
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  static async Response() {}
}

/**
 * Builds a controller that documents a component schema as an OpenAPI response for a given
 * status code. Unlike the other builders, it does not validate anything at runtime — it only
 * carries `static JSONSchema()`/`Response` for OpenAPI generation.
 *
 * @param schema - component schema (`@ComponentSchema`) describing the response shape
 * @param status - HTTP status this response is documented under; defaults to `200`
 * @returns an anonymous class with `static JSONSchema(description?, status?)` and a `Response` middleware
 *
 * @example
 * ```ts
 * import { ResponseBuilder } from "@aom-js/api";
 * import { Controller, Get, Responses } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class OrgCountriesDTO {
 *   @PropertySchema.String({ isArray: true })
 *   countries!: string[];
 * }
 *
 * @Controller()
 * class OrgCountriesResponse extends ResponseBuilder(OrgCountriesDTO) {}
 *
 * @Controller()
 * class CountriesController {
 *   @Get("/countries")
 *   @Responses(OrgCountriesResponse.JSONSchema("Organization countries"))
 *   static async list(): Promise<OrgCountriesDTO> {
 *     return { countries: ["US", "DE"] };
 *   }
 * }
 * ```
 */
export function ResponseBuilder<T extends ClassConstructor>(
  schema: T,
  status: number = ResponseBuilderConstructor.status,
): typeof ResponseBuilderConstructor<T> {
  return class extends ResponseBuilderConstructor<T> {
    static schema = schema;
    static status: number = status;
  };
}
