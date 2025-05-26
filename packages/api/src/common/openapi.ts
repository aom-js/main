import { Constructor } from "@aom/core";
import { ParameterLocation, SchemaObject, SecuritySchemeObject } from "openapi3-ts/oas31";

import { RouteRefContainer, ThisRefContainer } from "./references";

export declare type OpenApiPossibleSchema =
  | OpenApiSchemaObject
  | Constructor
  | ThisRefContainer
  | RouteRefContainer
  | any;

// special extensions to fix bug with inheritance of SchemaObject
export declare type OpenApiSchemaObject = Omit<SchemaObject, "type"> & {
  type?: SchemaObject["type"] | string;
};

export declare type OpenApiSecuritySchema = Omit<SecuritySchemeObject, "type"> & {
  type?: SecuritySchemeObject["type"] | string;
};

export declare interface OpenApiParameterObject {
  name: string;
  description?: string;
  in: ParameterLocation;
  required?: boolean;
  schema: OpenApiPossibleSchema;
}

export declare interface OpenApiResponse {
  status: number;
  schema: OpenApiPossibleSchema;
  description: string;
  contentType?: string;
  isArray?: boolean;
}

export declare interface OpenApiRequestBody {
  description?: string;
  contentType?: string;
  schema: OpenApiPossibleSchema;
}

// для аргумента в декоратор PathParameters сделаем значение `in` необязательным
export declare type OpenApiPathParameterObject = Omit<OpenApiParameterObject, "in"> & {
  in?: OpenApiParameterObject["in"];
};

export declare type OpenApiPathParameters = {
  [parameter: string]: OpenApiPathParameterObject;
};
