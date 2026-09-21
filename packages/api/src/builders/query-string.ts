import { type RefFunction, Controller, DelayRefStack } from "@aom-js/router";
import { Query, ThisRef, This, Middleware, QueryParameters, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";
import { QueryJSONSchema } from "../schemas";
import { QueryStringBuildersBase } from "./common";

//

const SafeOrigin = ThisRef((<T extends typeof QueryStringBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof QueryStringBuilderConstructor>(
  constructor: T,
) => {
  return [QueryParameters(...constructor.JSONSchema())];
}) as RefFunction);

/**
 * Base controller returned by {@link QueryStringBuilder}. Not exported directly — use
 * `QueryStringBuilder(schema)`.
 */
@Controller()
class QueryStringBuilderConstructor<
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends QueryStringBuildersBase {
  /** The validated query-string values, populated by the `Query` middleware. */
  query!: R;

  /**
   * Middleware: throws unless the validated query string has at least one property set.
   * Use before `Query` when an endpoint requires at least one filter/parameter.
   *
   * @throws {WrongDataResponse} 400, when the query string is empty
   */
  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Query(SafeOrigin) query: any) {
    if (!Object.entries(query).length) {
      throw new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  /**
   * Middleware: validates the request query string against `schema` via `SafeData` and stores
   * the result on `query`; also registers the parameters in OpenAPI.
   *
   * @throws {WrongDataResponse} 400, when validation against `schema` fails
   */
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Query(
    @Query(SafeOrigin) query: any,
    @This() queryBuilder: QueryStringBuilderConstructor<typeof QueryJSONSchema>,
  ) {
    queryBuilder.query = query;
  }
}

/**
 * Builds a controller that validates the request query string against a component schema and
 * describes it in OpenAPI as `QueryParameters`.
 *
 * @param schema - component schema (`@ComponentSchema`) describing the expected query shape
 * @returns an anonymous controller class with `Query`/`NotEmpty` middlewares, a `query` instance
 * field, and a `static JSONSchema()` for OpenAPI (inherited from `QueryStringBuildersBase`)
 *
 * @example
 * ```ts
 * import { QueryStringBuilder } from "@aom-js/api";
 * import { Controller, Get, Before, This } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class Pager {
 *   @PropertySchema.Number({ default: 100 })
 *   limit = 100;
 * }
 *
 * @Controller()
 * class QueryStringPager extends QueryStringBuilder(Pager) {}
 *
 * @Controller()
 * class ListController {
 *   @Get("/items")
 *   @Before(QueryStringPager.Query)
 *   static async list(@This(QueryStringPager) { query }: QueryStringPager) {
 *     // query.limit is validated and typed as number
 *   }
 * }
 * ```
 */
export function QueryStringBuilder<T extends ClassConstructor>(
  schema: T,
): typeof QueryStringBuilderConstructor<T> {
  return class extends QueryStringBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
