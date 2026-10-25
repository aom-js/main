import { Transform } from "class-transformer";
import { IsBoolean } from "class-validator";

/**
 * Property decorator: coerces a query-string value (always a string over HTTP) into a real
 * `boolean` before validation, then applies `IsBoolean()`. Accepts the literal strings `"true"`/
 * `"false"` and `"1"`/`"0"`, or an actual boolean (passed through). Anything else (`"yes"`, `""`)
 * is left as is, so `IsBoolean()` rejects it (400 through the builders) instead of reading it as
 * `false`.
 *
 * @example
 * ```ts
 * import { QueryBoolean } from "@aom-js/api";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class ListFilter {
 *   \@PropertySchema.Boolean({ isOptional: true, decorators: [QueryBoolean()] })
 *   enabled?: boolean; // "?enabled=true" -> true
 * }
 * ```
 */
export function QueryBoolean(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          if (value === "true" || value === "1") return true;
          if (value === "false" || value === "0") return false;
          return value;
        }),
        IsBoolean(),
      ],
      constructor,
      property,
    );
  };
}
