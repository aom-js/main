import { type OpenApiParameterObject } from "@aom-js/router";
import { pathVariants, plainJsonSchema } from "../functions";
import { type ClassConstructor } from "../types";

export class PlainBuildersBase {
  static readonly schema: ClassConstructor;

  static JSONSchema(path: pathVariants): OpenApiParameterObject[] {
    console.log("PlainBuildersBase render", this, this.schema);
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
