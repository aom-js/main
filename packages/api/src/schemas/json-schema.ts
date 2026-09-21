import type { OpenApiResponse, OpenApiParameterObject } from "@aom-js/router";
import { pathVariants, plainJsonSchema, responseJsonSchema } from "../functions/json-schema";

/** Base class that documents itself as an OpenAPI response via `responseJsonSchema`. `CommonResponse`/`ErrorMessage` build on this. */
export class ResponseJSONSchema {
  static JSONSchema(description?: string | string[], status?: number): OpenApiResponse {
    return responseJsonSchema(this, description, status);
  }
}

/** Base class that documents its properties as OpenAPI parameters for a given location, via `plainJsonSchema`. */
export class PlainJSONSchema {
  static JSONSchema(path: pathVariants): OpenApiParameterObject[] {
    return plainJsonSchema(this, path);
  }
}
/** `PlainJSONSchema` fixed to the `query` parameter location. */
export class QueryJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("query");
  }
}

/** `PlainJSONSchema` fixed to the `header` parameter location. */
export class HeaderJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("header");
  }
}

/** `PlainJSONSchema` fixed to the `path` parameter location. */
export class ParamJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("path");
  }
}

/** `PlainJSONSchema` fixed to the `cookie` parameter location. */
export class CookieJSONSchema extends PlainJSONSchema {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("cookie");
  }
}
