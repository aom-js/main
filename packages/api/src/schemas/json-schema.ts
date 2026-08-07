import type { OpenApiResponse } from "@aom-js/router";
import { responseJsonSchema } from "../functions/json-schema";

export class WithJSONSchema {
  // явная аннотация — иначе declaration emit не может именовать OpenApiResponse (TS2883)
  static JSONSchema(description?: string | string[], status?: number): OpenApiResponse {
    return responseJsonSchema(this, description, status);
  }
}
