import { responseJsonSchema } from "../functions/json-schema";

export class WithJSONSchema {
  static JSONSchema(description?: string | string[], status?: number) {
    return responseJsonSchema(this, description, status);
  }
}
