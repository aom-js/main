import { Transform } from "class-transformer";
import { IsBoolean } from "class-validator";

/**
 * Property decorator: coerces a query-string value (always a string over HTTP) into a real
 * `boolean` before validation, then applies `IsBoolean()`. Accepts the literal strings `"true"`/
 * `"false"`, an actual boolean (passed through), or falls back to `Boolean(+value)` for anything
 * else (e.g. `"1"`/`"0"`).
 *
 * @example
 * ```ts
 * import { QueryBoolean } from "@aom-js/api";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class ListFilter {
 *   @PropertySchema.Boolean({ isOptional: true, decorators: [QueryBoolean()] })
 *   enabled?: boolean; // "?enabled=true" -> true
 * }
 * ```
 */
export function QueryBoolean(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          // compare against the string value
          const isTrue = value === "true";
          const isFalse = value === "false";
          if (isTrue) return true;
          if (isFalse) return false;
          return typeof value === "boolean" ? value : Boolean(+value);
        }),
        IsBoolean(),
      ],
      constructor,
      property,
    );
  };
}
