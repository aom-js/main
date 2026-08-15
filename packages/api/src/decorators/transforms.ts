import { Transform } from "class-transformer";
import dayjs, { OpUnitType } from "dayjs";

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
