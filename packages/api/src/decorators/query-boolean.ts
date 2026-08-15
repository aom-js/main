import { Transform } from "class-transformer";
import { IsBoolean } from "class-validator";

export function QueryBoolean(): PropertyDecorator {
  return (constructor, property) => {
    return Reflect.decorate(
      [
        Transform(({ value }) => {
          // сопоставим со строковым значением
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
