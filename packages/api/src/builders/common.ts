import { type OpenApiParameterObject } from "@aom-js/router";
import { pathVariants, plainJsonSchema } from "../functions";
import { type ClassConstructor } from "../types";

/**
 * Shared base for the "plain" parameter builders (headers/query/cookie). Not part of the
 * package's public entry point (`builders/index.ts` doesn't re-export this module) — it exists
 * so `HeadersBuilder`/`QueryStringBuilder`/`CookieBuilder` share one `JSONSchema` implementation.
 */
export class PlainBuildersBase {
  static readonly schema: ClassConstructor;

  /**
   * Renders `schema`'s properties as OpenAPI parameters for the given location.
   *
   * @throws {Error} when `static schema` is missing — this happens when a `ThisRef`/reference
   * capture ends up pointing at this base class instead of the actual builder subclass (e.g. a
   * subclass forgot its own `@Controller()`), rather than at a real component schema
   */
  static JSONSchema(path: pathVariants): OpenApiParameterObject[] {
    if (!this.schema) {
      throw new Error(
        `schema is not defined for ${this.name}: вероятно, ссылка зафиксировала базовый класс билдера вместо потомка`,
      );
    }
    return plainJsonSchema(this.schema, path);
  }
}

/** `PlainBuildersBase` fixed to the `header` parameter location; base of `HeadersBuilder`'s controller. */
export class HeaderBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("header");
  }
}

/** `PlainBuildersBase` fixed to the `query` parameter location; base of `QueryStringBuilder`'s controller. */
export class QueryStringBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("query");
  }
}

/** `PlainBuildersBase` fixed to the `cookie` parameter location; base of `CookieBuilder`'s controller. */
export class CookieBuildersBase extends PlainBuildersBase {
  static JSONSchema(): OpenApiParameterObject[] {
    return super.JSONSchema("cookie");
  }
}
