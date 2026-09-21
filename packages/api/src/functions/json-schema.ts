import { type OpenApiParameterObject, type OpenApiResponse, OpenApi } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";
//
import { type ClassConstructor } from "../types";

const schemer = new Schemer(OpenApi.refPointerPrefix);
/** Where a parameter described by {@link plainJsonSchema} lives in the request. */
export type pathVariants = "path" | "query" | "header" | "cookie";

/**
 * Renders every property of a component schema as a flat list of OpenAPI parameters for a given
 * location. Used internally by the parameter builders (`HeadersBuilder`, `QueryStringBuilder`,
 * `CookieBuilder`, `ParamsBuilder`) to build their `JSONSchema()`.
 *
 * @param source - component schema (`\@ComponentSchema`) whose properties become parameters
 * @param path - where these parameters live: `"path" | "query" | "header" | "cookie"`
 * @returns one `OpenApiParameterObject` per property of `source`
 */
export function plainJsonSchema<T extends ClassConstructor>(
  source: T,
  path: pathVariants,
): OpenApiParameterObject[] {
  const jsonSchema = schemer.render(source);

  const result: OpenApiParameterObject[] = [];

  Object.entries(jsonSchema?.properties ?? []).forEach(([key, schema]) => {
    const required = jsonSchema.required && jsonSchema.required.indexOf(key) >= 0;

    const { description } = <any>schema;
    result.push({
      name: key,
      description,
      in: path,
      schema,
      required,
    });
  });
  return result;
}

/**
 * Describes a component schema as an OpenAPI response entry. Used internally by
 * `ResponseBuilder`/`ErrorMessage`/every `*Response` class's `JSONSchema()`.
 *
 * @param schema - component schema (`\@ComponentSchema`) describing the response body
 * @param description - response description; an array of lines is joined via `Array.toString()` (comma-separated), `""` when omitted
 * @param status - HTTP status this response is documented under; defaults to `200`
 */
export function responseJsonSchema<T extends ClassConstructor>(
  schema: T,
  description?: string | string[],
  status?: number,
): OpenApiResponse {
  return {
    status: status || 200,
    schema: schema,
    isArray: Array.isArray(description),
    description: description ? description.toString() : "",
  };
}
