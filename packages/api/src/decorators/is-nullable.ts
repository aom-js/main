import { type ValidationOptions, ValidateIf } from "class-validator";

export function IsNullable(validationOptions?: ValidationOptions): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [ValidateIf((_object, value) => value !== null, validationOptions)],
      constructor,
      property,
    );
  };
}
