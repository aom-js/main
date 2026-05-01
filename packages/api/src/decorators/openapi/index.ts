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

export function Security(
  schema: OpenApiSecuritySchema,
): ReturnType<typeof AomApi.combinedDecorator> {
  return AomApi.combinedDecorator(($) => {
    $.openApi.security = schema;
  });
}

export function RequestBody(schema: OpenApiRequestBody): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.requestBody = schema;
  });
}

export function Responses(
  ...schemas: OpenApiResponse[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.responses.push(...schemas);
  });
}

export function PathParameters(
  ...schemas: OpenApiPathParameters[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    // console.log ('run path parameters decorator', $._.target.name, $._.property?.toString());
    $.openApi.path.push(...schemas);
  });
}

export function QueryParameters(
  ...schemas: OpenApiPathParameterObject[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas.map((schema) => ({ ...schema, in: <any>"query" })));
  });
}

export function Parameters(
  ...schemas: OpenApiParameterObject[]
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($) => {
    $.openApi.parameters.push(...schemas);
  });
}

export function DelayRefStack(
  handler: FwdContainer | ThisRefContainer | RouteRefContainer,
): MethodDecorator {
  return AomApi.methodDecorator(($) => {
    $.openApi.delayStack.push(handler);
  });
}
