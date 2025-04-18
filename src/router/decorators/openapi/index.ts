import {
  AomHttp,
  OpenApiParameterObject,
  OpenApiPathParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
} from "../../common";

export * from "./tags";

export function Security(
  schema: OpenApiSecuritySchema
): ReturnType<typeof AomHttp.combinedDecorator> {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.security = schema;
  });
}

export function RequestBody(
  schema: OpenApiRequestBody
): ReturnType<typeof AomHttp.staticDecorator> {
  return AomHttp.staticDecorator(($) => {
    $.openApi.requestBody = schema;
  });
}

export function Responses(
  ...schemas: OpenApiResponse[]
): ReturnType<typeof AomHttp.staticDecorator> {
  return AomHttp.staticDecorator(($) => {
    $.openApi.responses.push(...schemas);
  });
}

export function PathParameters(
  ...schemas: OpenApiPathParameters[]
): ReturnType<typeof AomHttp.staticDecorator> {
  return AomHttp.staticDecorator(($) => {
    $.openApi.path.push(...schemas);
  });
}

export function QueryParameters(
  ...schemas: OpenApiPathParameterObject[]
): ReturnType<typeof AomHttp.staticDecorator> {
  return AomHttp.staticDecorator(($) => {
    $.openApi.parameters.push(...schemas.map((schema) => ({ ...schema, in: "query" })));
  });
}

export function Parameters(
  ...schemas: OpenApiParameterObject[]
): ReturnType<typeof AomHttp.staticDecorator> {
  return AomHttp.staticDecorator(($) => {
    $.openApi.parameters.push(...schemas);
  });
}
