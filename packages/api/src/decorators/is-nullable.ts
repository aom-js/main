import { type ValidationOptions, ValidateIf } from "class-validator";

/**
 * Property decorator: skips the property's other validators when its value is `null` (but still
 * runs them for `undefined`, unlike making the property optional). Equivalent to
 * `ValidateIf((_, value) => value !== null, validationOptions)`.
 *
 * This is a verbatim copy of the same-named export from `@aom-js/schemer`, which is now public
 * itself — prefer importing `IsNullable` directly from `@aom-js/schemer` in new code.
 *
 * @example
 * ```ts
 * import { IsNullable } from "@aom-js/api";
 * import { IsString } from "class-validator";
 *
 * class Profile {
 *   @IsNullable()
 *   @IsString()
 *   nickname!: string | null; // null passes, a non-string value doesn't
 * }
 * ```
 */
export function IsNullable(validationOptions?: ValidationOptions): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [ValidateIf((_object, value) => value !== null, validationOptions)],
      constructor,
      property,
    );
  };
}
