import { describe, it, expect } from "vitest";
import { plainToInstance, Transform } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

// stands in for a query-string splitter like TransformToArray from @aom-js/api
const SplitComma = () =>
  Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(",")));

const EmptyToUndefined = () => Transform(({ value }) => value || undefined);

describe("schemer: Number приводит значения после пользовательских декораторов", () => {
  it("isArray: строка запроса с разбивкой собирается в список чисел", () => {
    @ComponentSchema()
    class Filter {
      @PropertySchema.Number({ isArray: true, decorators: [SplitComma()] })
      ids!: number[];
    }
    const one = plainToInstance(Filter, { ids: "1" });
    expect(one.ids).toEqual([1]);
    expect(validateSync(one)).toEqual([]);

    const two = plainToInstance(Filter, { ids: "1,2" });
    expect(two.ids).toEqual([1, 2]);
    expect(validateSync(two)).toEqual([]);
  });

  it("isArray: массив из тела приводится поэлементно", () => {
    @ComponentSchema()
    class Body {
      @PropertySchema.Number({ isArray: true, minValue: 1 })
      values!: number[];
    }
    const dto = plainToInstance(Body, { values: ["1", 2] });
    expect(dto.values).toEqual([1, 2]);
    expect(validateSync(dto)).toEqual([]);
    expect(validateSync(plainToInstance(Body, { values: [0, 1] })).map((e) => e.property)).toEqual([
      "values",
    ]);
  });

  it("одиночное значение, nullable и необязательное — как прежде", () => {
    @ComponentSchema()
    class Single {
      @PropertySchema.Number({})
      n!: number;

      @PropertySchema.Number({ nullable: true })
      orNull!: number | null;

      @PropertySchema.Number({ isOptional: true, decorators: [EmptyToUndefined()] })
      maybe?: number;
    }
    const dto = plainToInstance(Single, { n: "42", orNull: null, maybe: "" });
    expect(dto.n).toBe(42);
    expect(dto.orNull).toBeNull();
    expect(dto.maybe).toBeUndefined();
    expect(validateSync(dto)).toEqual([]);
  });
});
