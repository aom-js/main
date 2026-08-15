import type { OpenApiResponse, OpenApiParameterObject } from "@aom-js/router";
import { pathVariants, plainJsonSchema, responseJsonSchema } from "../functions/json-schema";

export class ResponseJSONSchema {
  static JSONSchema(description?: string | string[], status?: number): OpenApiResponse {
    return responseJsonSchema(this, description, status);
  }
}

export class PlainJSONSchema {
  static JSONSchema(path: pathVariants): OpenApiParameterObject[] {
    return plainJsonSchema(this, path);
  }
}
export class QueryJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("query");
  }
}

export class HeaderJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("header");
  }
}

export class ParamJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("path");
  }
}

export class CookieJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("cookie");
  }
}
