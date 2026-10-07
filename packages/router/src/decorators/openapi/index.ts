import { ExecutionPhase } from "@aom-js/core";

import {
  AomApi,
  FwdContainer,
  OpenApiParameterObject,
  OpenApiPathParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
  RouteRefContainer,
  ThisRefContainer,
} from "../../common";

export * from "./tags";

/**
 * Attaches an OpenAPI security scheme to an endpoint operation. Every cursor of a
 * route that carries `\@Security` adds its scheme to the operation's `security` list,
 * and the scheme itself is registered once per declaring class name under
 * `components.securitySchemes`.
 *
 * @param schema - security scheme object (e.g. `{type: "http", scheme: "bearer"}`)
 * @returns a decorator usable on both a class and a method
 *
 * @example
 * ```ts
 * import { Controller, Post, Security, Body } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Post("/items")
 *   \@Security({ type: "http", scheme: "bearer" })
 *   static async create(\@Body() body: unknown) {
 *     return body;
 *   }
 * }
 * ```
 */
export function Security(
  schema: OpenApiSecuritySchema,
): ReturnType<typeof AomApi.combinedDecorator> {
  return AomApi.combinedDecorator(($) => {
    $.openApi.security = schema;
  });
}

/**
 * Declares the OpenAPI request body of an endpoint. If several cursors of a route
 * declare one, the last cursor's declaration wins.
 *
 * @param schema - request body declaration; `schema.schema` accepts a raw OpenAPI
 *   schema, a `\@ComponentSchema()` class, or a `ThisRef`/`RouteRef` resolving to either
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Post, RequestBody, Body } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class ItemDto {
 *   \@PropertySchema.String({})
 *   title!: string;
 * }
 *
 * \@Controller()
 * class Items {
 *   \@Post("/items")
 *   \@RequestBody({ schema: ItemDto })
 *   static async create(\@Body() body: unknown) {
 *     return body;
 *   }
 * }
 * ```
 */
export function RequestBody(schema: OpenApiRequestBody): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.requestBody = schema;
  });
}

/**
 * Declares one or more OpenAPI responses of an endpoint, keyed by HTTP status.
 * Responses accumulate across every cursor of the route; if two cursors declare a
 * response with the same `status`, the one from the later cursor wins.
 *
 * @param schemas - response declarations; `isArray: true` wraps the schema as
 *   `{type: "array", items: schema}`
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Responses } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class ItemDto {
 *   \@PropertySchema.String({})
 *   title!: string;
 * }
 *
 * \@Controller()
 * class Items {
 *   \@Get("/items")
 *   \@Responses({ status: 200, schema: ItemDto, description: "ok", isArray: true })
 *   static async list() {
 *     return [];
 *   }
 * }
 * ```
 */
export function Responses(
  ...schemas: OpenApiResponse[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.responses.push(...schemas);
  });
}

/**
 * Declares OpenAPI path parameters of an endpoint. Each key of `schemas` is the
 * literal path segment to replace — for example, registering `{item_id: {...}}` on an
 * endpoint mounted at `/item/item_id` turns the operation's path into `/item/{id}`
 * (using the parameter's own `name`), and adds it as `in: "path", required: true`.
 *
 * @param schemas - one or more path-parameter maps, keyed by the literal segment they replace
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, PathParameters, Params } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Get("/item/item_id")
 *   \@PathParameters({ item_id: { name: "id", schema: { type: "string" } } })
 *   static async one(\@Params("id") id: string) {
 *     return { id };
 *   }
 * }
 * ```
 */
export function PathParameters(
  ...schemas: OpenApiPathParameters[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.path.push(...schemas);
  });
}

/**
 * Declares OpenAPI query parameters of an endpoint (`in: "query"` is set automatically).
 *
 * @param schemas - parameter declarations, without `in`
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, QueryParameters, Query } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Get("/items")
 *   \@QueryParameters({ name: "page", schema: { type: "string" } })
 *   static async list(\@Query("page") page: string) {
 *     return { page };
 *   }
 * }
 * ```
 */
export function QueryParameters(
  ...schemas: OpenApiPathParameterObject[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas.map((schema) => ({ ...schema, in: <any>"query" })));
  });
}

/**
 * Declares OpenAPI cookie parameters of an endpoint (`in: "cookie"` is set automatically).
 *
 * @param schemas - parameter declarations, without `in`
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, CookieParameters, Cookies } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Get("/items")
 *   \@CookieParameters({ name: "sid", schema: { type: "string" } })
 *   static async list(\@Cookies("sid") sid: string) {
 *     return { sid };
 *   }
 * }
 * ```
 */
export function CookieParameters(
  ...schemas: OpenApiPathParameterObject[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas.map((schema) => ({ ...schema, in: <any>"cookie" })));
  });
}

/**
 * Declares arbitrary OpenAPI parameters of an endpoint, with `in` set explicitly on
 * each one (unlike `\@QueryParameters`/`\@CookieParameters`, which set it for you).
 *
 * @param schemas - full parameter declarations, including `in`
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Parameters, Headers } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Get("/items")
 *   \@Parameters({ name: "x-request-id", in: "header", schema: { type: "string" } })
 *   static async list(\@Headers("x-request-id") id: string) {
 *     return { id };
 *   }
 * }
 * ```
 */
export function Parameters(
  ...schemas: OpenApiParameterObject[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas);
  });
}
