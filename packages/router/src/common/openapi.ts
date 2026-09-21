import { ClassType } from "@aom-js/core";
import { ParameterLocation, SchemaObject, SecuritySchemeObject } from "openapi3-ts/oas31";

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
/** `openapi3-ts` `SchemaObject` with `type` widened to `string` for schemas that extend it. */
export declare type OpenApiSchemaObject = Omit<SchemaObject, "type"> & {
  type?: SchemaObject["type"] | string;
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

/**
 * One response declaration for `\@Responses(...)`. `status` is the key used to merge
 * responses accumulated from every cursor of the route — the last cursor with the same
 * `status` wins. `isArray: true` wraps `schema` as `{type: "array", items: schema}`.
 */
export declare interface OpenApiResponse {
  status: number;
  schema: OpenApiPossibleSchema;
  description: string;
  contentType?: string;
  isArray?: boolean;
}

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
