import { type OpenApiParameterObject } from "@aom-js/router";
import { pathVariants, plainJsonSchema } from "../functions";
import { type ClassConstructor } from "../types";

export class PlainBuildersBase {
  static readonly schema: ClassConstructor;

  static JSONSchema(path: pathVariants): OpenApiParameterObject[] {
    if (!this.schema) {
      throw new Error(
        `schema is not defined for ${this.name}: вероятно, ссылка зафиксировала базовый класс билдера вместо потомка`,
      );
    }
    return plainJsonSchema(this.schema, path);
  }
}

export class HeaderBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("header");
  }
}

export class QueryStringBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("query");
  }
}

export class CookieBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("cookie");
  }
}
