import { type OpenApiRequestBody, type RefFunction } from "@aom-js/router";
import { DelayRefStack, Body, RequestBody } from "@aom-js/router";
import { Controller, ThisRef, This, Middleware, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { SafeData } from "../decorators";
import { WrongDataResponse } from "../responses";

const SafeOrigin = ThisRef((<T extends typeof BodyBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginRequestBody = ThisRef((<T extends typeof BodyBuilderConstructor>(
  constructor: T,
) => [RequestBody(constructor.JSONSchema())]) as RefFunction);

/**
 * Base controller returned by {@link BodyBuilder}. Not re-exported from the package entry point (used by `@aom-js/api/testing`) — use `BodyBuilder(schema)`.
 */
@Controller()
export class BodyBuilderConstructor<T extends ClassConstructor, R = InstanceType<T>> {
  /** The component schema passed to {@link BodyBuilder}; validated by the `Body` middleware. */
  static readonly schema: ClassConstructor;

  /** Description passed to {@link BodyBuilder}, used as the fallback OpenAPI request body description. */
  static description?: string;

  /** The validated request body, populated by the `Body` middleware after it runs. */
  body!: R;

  /**
   * Describes this builder's request body for OpenAPI.
   *
   * @param description - overrides both the argument passed to `BodyBuilder` and `static description`
   * @returns an `OpenApiRequestBody` referencing `schema`, with the first non-empty of
   * `description` / `static description` / `""` as its text
   */
  static JSONSchema(description?: string): OpenApiRequestBody {
    return {
      schema: this.schema,
      description: description ?? this.description ?? "",
    };
  }

  /**
   * Middleware: reads the lazily-parsed request body (see `Server`'s lazy body handling),
   * validates it against `schema` via `SafeData`, and stores the result on `body`.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @DelayRefStack(SafeOriginRequestBody)
  @Responses(WrongDataResponse.JSONSchema())
  static async Body(@Body(SafeOrigin) body: any, @This() self: BodyBuilderConstructor<any>) {
    self.body = body;
  }
}

/**
 * Builds a controller that validates the request JSON body against a component schema and
 * describes it in OpenAPI as `RequestBody`.
 *
 * Attach the returned class's `Body` middleware to a route (typically via `\@Before`), then read
 * the validated result off `this.body` in the endpoint. Validation reuses `SafeData`, so a failed
 * body throws `WrongDataResponse` (400) with the validation errors attached.
 *
 * @param schema - component schema (`\@ComponentSchema`) describing the expected body shape
 * @param description - OpenAPI description for the request body; falls back to a `static description`
 * set on a subclass, then to an empty string
 * @returns an anonymous controller class with a `Body` middleware, a `body` instance field, and a
 * `static JSONSchema(description?)` for OpenAPI
 *
 * @example
 * ```ts
 * import { BodyBuilder } from "@aom-js/api";
 * import { Controller, Post, Before, This } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class OrgDataDTO {
 *   \@PropertySchema.String()
 *   name!: string;
 * }
 *
 * \@Controller()
 * class CreateOrgBody extends BodyBuilder(OrgDataDTO) {}
 *
 * \@Controller()
 * class OrgsController {
 *   \@Post("/orgs")
 *   \@Before(CreateOrgBody.Body)
 *   static async create(\@This(CreateOrgBody) { body }: CreateOrgBody) {
 *     // body is OrgDataDTO, already validated
 *   }
 * }
 * ```
 */
export function BodyBuilder<T extends ClassConstructor>(
  schema: T,
  description?: string,
): typeof BodyBuilderConstructor<T> {
  return class extends BodyBuilderConstructor<T> {
    static readonly schema = schema;

    static description = description;
  };
}
