//
import { AomSchemas } from "@aom-js/schemer";
import { Controller, DelayRefStack } from "@aom-js/router";
import { Params, ThisRef, This, Middleware, PathParameters, Responses } from "@aom-js/router";
import type { RefFunction, OpenApiParameterObject, OpenApiPathParameters } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";

//
import { plainJsonSchema } from "../functions";

const SafeOrigin = ThisRef((<T extends typeof ParamsBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof ParamsBuilderConstructor>(
  constructor: T,
) => [PathParameters(constructor.JSONSchema())]) as RefFunction);

/**
 * Base controller returned by {@link ParamsBuilder}. Not re-exported from the package entry point (used by `@aom-js/api/testing`) — use
 * `ParamsBuilder(schema)`.
 */
@Controller()
export class ParamsBuilderConstructor<T extends ClassConstructor<any>, R = InstanceType<T>> {
  /** The component schema passed to {@link ParamsBuilder}; must declare exactly one property. */
  static readonly schema: ClassConstructor<any>;

  /** Name of `schema`'s single property; also the path parameter's name. */
  static readonly attr: string;

  /** OpenAPI description of the single path parameter, derived from `schema`. */
  static readonly jsonSchema: OpenApiParameterObject;

  /** The validated path parameters object, populated by the `Params` middleware. */
  params!: R;

  /** The single validated parameter value, populated by the `Params` middleware. */
  value!: any;

  /**
   * Renders this parameter as a route path segment, e.g. `:orgId([0-9a-f-]{36})` when the
   * schema's property carries a `pattern`. Useful for building paths like
   * `` `/orgs/${OrgID}` ``.
   */
  static toString() {
    // verify how the pattern behaves here
    return `:${this.attr}${this.jsonSchema.schema.pattern ? `(${this.jsonSchema.schema.pattern})` : ""}`;
  }

  /** Describes this path parameter for OpenAPI, keyed by `` `:${attr}` ``. */
  static JSONSchema(): OpenApiPathParameters {
    return { [`:${this.attr}`]: this.jsonSchema };
  }

  /**
   * Middleware: throws unless the path parameter is present.
   *
   * @throws {WrongDataResponse} 400, when the parameter is missing
   */
  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Params(SafeOrigin) params: any) {
    if (!Object.entries(params).length) {
      throw new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  /**
   * Middleware: validates the path parameter against `schema` via `SafeData`, stores the raw
   * object on `params` and the single value on `value`, and registers it as a `PathParameters`
   * entry in OpenAPI.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Params(
    @Params(SafeOrigin) params: any,
    @This() self: ParamsBuilderConstructor<ClassConstructor<any>>,
  ) {
    self.params = params;
    self.value = params[this.attr];
  }
}

/**
 * Builds a controller for a single typed path parameter, validated against a component schema
 * with exactly one property.
 *
 * `IDValue`/`UUIDParam`/`MongoIDParam`/`NanoIDParam`/`NumberIDParam` in this package build on the
 * same idea for common ID formats — prefer those over calling `ParamsBuilder` directly for IDs.
 *
 * @param schema - component schema with exactly one property; that property's name becomes the
 * path parameter's name
 * @returns an anonymous controller class with a `Params` middleware, `params`/`value` instance
 * fields, and `static toString()`/`JSONSchema()` for building routes and OpenAPI docs
 * @throws {Error} when `schema` isn't a `\@ComponentSchema`, or doesn't declare exactly one property
 *
 * @example
 * ```ts
 * import { ParamsBuilder } from "@aom-js/api";
 * import { Controller, Get, Before, This } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class SlugParam {
 *   \@PropertySchema.String({ pattern: "[a-z0-9-]+" })
 *   slug!: string;
 * }
 *
 * \@Controller()
 * class SlugValue extends ParamsBuilder(SlugParam) {}
 *
 * \@Controller()
 * class PagesController {
 *   \@Get(`/pages/${SlugValue}`) // ":slug([a-z0-9-]+)"
 *   \@Before(SlugValue.Params)
 *   static async page(\@This(SlugValue) { value }: SlugValue) {
 *     // value is the validated slug string
 *   }
 * }
 * ```
 */
export function ParamsBuilder<T extends ClassConstructor<any>>(
  schema: T,
): typeof ParamsBuilderConstructor<T> {
  const aomSchemasClass = AomSchemas.checkExists(schema);
  //
  if (!aomSchemasClass || !aomSchemasClass.isComponentSchema) {
    throw new Error(`${messages.COMPONENT_SCHEMA_NOT_DEFINED}: ${schema.name}`);
  }
  //
  if (aomSchemasClass.properties.size !== 1) {
    throw new Error(`${messages.COMPONENT_SCHEMA_ONLY_PROPERTY_REQUIRED}: ${schema.name}`);
  }
  // extracted before the class declaration: TypeScript's narrowing of aomSchemasClass doesn't
  // survive inside the class body
  const attrName = aomSchemasClass.properties.values().next().value as string;
  //
  return class extends ParamsBuilderConstructor<T> {
    static readonly schema = schema;

    static readonly jsonSchema = plainJsonSchema(schema, "path")[0];
    static readonly attr = attrName;
  };
}
