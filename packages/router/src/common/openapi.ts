import { ClassType } from "@aom-js/core";
import { ParameterLocation, SchemaObjectValue, SecuritySchemeObject } from "openapi3-ts/oas32";

import { RouteRefContainer, ThisRefContainer } from "./references";

/**
 * Any schema `\@Responses`/`\@RequestBody`/parameter decorators accept: a raw OpenAPI
 * schema object, a `\@ComponentSchema()`-decorated class (rendered as `{$ref}` by
 * `SchemasCollector` from `@aom-js/schemer`), or a `ThisRef`/`RouteRef` container that
 * resolves to either at build time (see `OpenApi.schemaExtract`).
 */
export declare type OpenApiPossibleSchema =
  OpenApiSchemaObject | ClassType | ThisRefContainer | RouteRefContainer | any;

// special extensions to fix bug with inheritance of SchemaObject
/** `openapi3-ts` object schema (`SchemaObjectValue`: in oas32 `SchemaObject` also admits `boolean`) with `type` widened to `string` for schemas that extend it. */
export declare type OpenApiSchemaObject = Omit<SchemaObjectValue, "type"> & {
  type?: SchemaObjectValue["type"] | string;
};

/** `openapi3-ts` `SecuritySchemeObject` with `type` widened to `string`, passed to `\@Security`. */
export declare type OpenApiSecuritySchema = Omit<SecuritySchemeObject, "type"> & {
  type?: SecuritySchemeObject["type"] | string;
};

/** One parameter declaration, as accepted by `\@QueryParameters`/`\@CookieParameters`/`\@Parameters`. */
export declare interface OpenApiParameterObject {
  name: string;
  description?: string;
  in: ParameterLocation;
  required?: boolean;
  schema: OpenApiPossibleSchema;
}

/** Fields shared by both kinds of `\@Responses(...)` declarations. */
export declare interface OpenApiResponseBase {
  status: number;
  description: string;
  contentType?: string;
}

/**
 * Regular response: `schema` of the body. `isArray: true` wraps `schema` as
 * `{type: "array", items: schema}`; `contentType` defaults to `application/json`.
 */
export declare interface OpenApiDataResponse extends OpenApiResponseBase {
  schema: OpenApiPossibleSchema;
  isArray?: boolean;
  events?: never;
}

/**
 * Stream of Server-Sent Events: event name → schema of its `data` (a `\@ComponentSchema` class,
 * a raw schema, `ThisRef`/`RouteRef`). Rendered as the OpenAPI 3.2
 * `itemSchema` — `oneOf` with one variant per event — plus `schema: {type: "array", items}` of
 * the same variants; `contentType` defaults to
 * `text/event-stream`.
 */
export declare interface OpenApiEventsResponse extends OpenApiResponseBase {
  events: Record<string, OpenApiPossibleSchema>;
  schema?: never;
  isArray?: never;
}

/**
 * One response declaration for `\@Responses(...)`: a regular body or a stream of events.
 * `status` is the key used to merge responses accumulated from every cursor of the route —
 * the last cursor with the same `status` replaces the whole response.
 */
export declare type OpenApiResponse = OpenApiDataResponse | OpenApiEventsResponse;

/** Request body declaration for `\@RequestBody(...)`. */
export declare interface OpenApiRequestBody {
  description?: string;
  contentType?: string;
  schema: OpenApiPossibleSchema;
}

// make the `in` value optional for the argument passed to the PathParameters decorator
/** Same as {@link OpenApiParameterObject} but `in` is optional — `\@PathParameters` always sets it to `"path"`. */
export declare type OpenApiPathParameterObject = Omit<OpenApiParameterObject, "in"> & {
  in?: OpenApiParameterObject["in"];
};

/**
 * Argument shape for `\@PathParameters(...)`. Each key is the literal path segment to
 * replace (for example `item_id` in `/item/item_id`); the decorator turns it into
 * `{name}` in the final OpenAPI path and marks the parameter `in: "path", required: true`.
 */
export declare type OpenApiPathParameters = {
  [parameter: string]: OpenApiPathParameterObject;
};
