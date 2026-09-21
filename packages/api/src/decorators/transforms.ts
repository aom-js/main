import { Transform } from "class-transformer";
import dayjs, { OpUnitType } from "dayjs";

/**
 * Property decorator: replaces a falsy value (`""`, `0`, `null`, etc.) with `undefined`. Useful
 * on optional query/body fields where an empty string should be treated as "not provided" rather
 * than validated as-is.
 */
export function TransformEmpty(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          return value || undefined;
        }),
      ],
      constructor,
      property,
    );
  };
}

/**
 * Property decorator: normalizes a value to an array. Passes arrays through unchanged; splits a
 * string on `,`, trims each piece, and drops empty ones. Handy for query-string parameters that
 * accept a comma-separated list (`?id=a,b,c`).
 *
 * @example
 * ```ts
 * import { TransformToArray } from "@aom-js/api";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 * import { IsUUID } from "class-validator";
 *
 * @ComponentSchema()
 * class IDFilter {
 *   @PropertySchema.String({
 *     isOptional: true,
 *     decorators: [TransformToArray(), IsUUID("all", { each: true })],
 *   })
 *   id?: string[]; // "?id=a,b,c" -> ["a", "b", "c"]
 * }
 * ```
 */
export function TransformToArray(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) =>
          Array.isArray(value)
            ? value
            : String(value)
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
        ),
      ],
      constructor,
      property,
    );
  };
}

/** Property decorator: coerces the value to a string and trims leading/trailing whitespace. */
export function TransformTrim(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          return String(value).trim();
        }),
      ],
      constructor,
      property,
    );
  };
}

declare interface attrs {
  startOf?: OpUnitType;

  endOf?: OpUnitType;

  format?: string;
}

/**
 * Property decorator: parses the value with `dayjs`, optionally snaps it to the start/end of a
 * unit (day, month, ...), and returns either a formatted string (`format` given) or a `Date`.
 * A falsy input value is passed through unchanged.
 *
 * @param attrs.startOf - snap the parsed date to the start of this unit (e.g. `"day"`)
 * @param attrs.endOf - snap the parsed date to the end of this unit
 * @param attrs.format - when given, returns a `dayjs`-formatted string instead of a `Date`
 *
 * @example
 * ```ts
 * import { TransformToDate } from "@aom-js/api";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class DateRangeFilter {
 *   @PropertySchema.String({
 *     isOptional: true,
 *     decorators: [TransformToDate({ startOf: "day" })],
 *   })
 *   from?: Date; // "?from=2024-01-15" -> 2024-01-15T00:00:00.000
 * }
 * ```
 */
export function TransformToDate(attrs?: attrs): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          let result: dayjs.Dayjs;
          if (value) {
            result = dayjs(value);
            if (attrs?.startOf) result = result.startOf(attrs.startOf);
            if (attrs?.endOf) result = result.endOf(attrs.endOf);
            if (attrs?.format) {
              return result.format(attrs.format);
            }
            return result.toDate();
          }
          return value;
        }),
      ],
      constructor,
      property,
    );
  };
}
