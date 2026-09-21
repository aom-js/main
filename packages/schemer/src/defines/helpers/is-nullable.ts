import { ValidationOptions, ValidateIf } from "class-validator";

/**
 * Property decorator that allows `null` in addition to whatever the property's other validators
 * require — wraps it in `ValidateIf((_, value) => value !== null)`, so every other validator on the
 * property is skipped when the value is `null` (but, unlike `isOptional`, still runs for `undefined`).
 *
 * Applied automatically by every `PropertySchema.*` factory when its `nullable` param is `true` — call
 * it directly only when hand-rolling class-validator decorators outside `PropertySchema`.
 *
 * @param validationOptions - forwarded to the underlying `ValidateIf`
 * @returns a property decorator
 *
 * @example
 * ```ts
 * import { IsNullable } from "@aom-js/schemer";
 * import { IsString } from "class-validator";
 *
 * class Example {
 *   @IsString()
 *   @IsNullable()
 *   note!: string | null;
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
