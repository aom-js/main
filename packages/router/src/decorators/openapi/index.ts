import {
  AomHttp,
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
export * from "./main";

export function Security(
  schema: OpenApiSecuritySchema
): ReturnType<typeof AomHttp.combinedDecorator> {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.security = schema;
  });
}

export function RequestBody(
  schema: OpenApiRequestBody
): ReturnType<typeof AomHttp.methodDecorator> {
  return AomHttp.methodDecorator(($) => {
    $.openApi.requestBody = schema;
  });
}

export function Responses(
  ...schemas: OpenApiResponse[]
): ReturnType<typeof AomHttp.methodDecorator> {
  return AomHttp.methodDecorator(($) => {
    $.openApi.responses.push(...schemas);
  });
}

export function PathParameters(
  ...schemas: OpenApiPathParameters[]
): ReturnType<typeof AomHttp.methodDecorator> {
  return AomHttp.methodDecorator(($) => {
    $.openApi.path.push(...schemas);
  });
}

export function QueryParameters(
  ...schemas: OpenApiPathParameterObject[]
): ReturnType<typeof AomHttp.methodDecorator> {
  return AomHttp.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas.map((schema) => ({ ...schema, in: <any>"query" })));
  });
}

export function Parameters(
  ...schemas: OpenApiParameterObject[]
): ReturnType<typeof AomHttp.methodDecorator> {
  return AomHttp.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas);
  });
}

export function DelayRefStack(
  handler: FwdContainer | ThisRefContainer | RouteRefContainer
): MethodDecorator {
  return AomHttp.methodDecorator(($) => {
    $.openApi.delayStack.push(handler);
  });
}
