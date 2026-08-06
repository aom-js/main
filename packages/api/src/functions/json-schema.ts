import { Class } from "type-fest";
import { type OpenApiParameterObject, type OpenApiResponse, OpenApi } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";

export type pathVariants = "path" | "query" | "header" | "cookie";

export function plainJsonSchema<T extends Class<any, any>>(
  source: T,
  path: pathVariants,
): OpenApiParameterObject[] {
  const jsonSchema = new Schemer(OpenApi.refPointerPrefix).render(source);

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

export function responseJsonSchema<T extends Class<any, any>>(
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
