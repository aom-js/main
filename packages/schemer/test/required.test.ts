import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema, Schemer } from "@aom-js/schemer";

const failed = (cls: new () => object, plain: object) =>
  validateSync(plainToInstance(cls, plain)).map((e) => e.property);

const required = (cls: new () => object) =>
  (new Schemer("#/components/schemas/").render(cls).required ?? []) as string[];

describe("schemer: обязательность совпадает с required схемы", () => {
  it("Type без isOptional: отсутствующий объект — ошибка, свойство в required", () => {
    @ComponentSchema()
    class Inner {
      @PropertySchema.String({})
      value!: string;
    }
    @ComponentSchema()
    class Outer {
      @PropertySchema.Type({ value: () => Inner })
      inner!: Inner;
    }
    expect(required(Outer)).toContain("inner");
    expect(failed(Outer, {})).toContain("inner");
    expect(failed(Outer, { inner: { value: "x" } })).toEqual([]);
  });

  it("Type с isArray без isOptional: отсутствующий массив — ошибка", () => {
    @ComponentSchema()
    class Item {
      @PropertySchema.String({})
      value!: string;
    }
    @ComponentSchema()
    class List {
      @PropertySchema.Type({ value: () => Item, isArray: true })
      items!: Item[];
    }
    expect(required(List)).toContain("items");
    expect(failed(List, {})).toContain("items");
    expect(failed(List, { items: [] })).toEqual([]);
    expect(failed(List, { items: [{ value: "x" }] })).toEqual([]);
  });

  it("Type с isOptional: отсутствие допустимо и свойства нет в required", () => {
    @ComponentSchema()
    class Inner {
      @PropertySchema.String({})
      value!: string;
    }
    @ComponentSchema()
    class Outer {
      @PropertySchema.Type({ value: () => Inner, isOptional: true })
      inner?: Inner;
    }
    expect(required(Outer)).not.toContain("inner");
    expect(failed(Outer, {})).toEqual([]);
  });

  it("Type с nullable: null проходит, а схема не требует свойства", () => {
    @ComponentSchema()
    class Inner {
      @PropertySchema.String({})
      value!: string;
    }
    @ComponentSchema()
    class Outer {
      @PropertySchema.Type({ value: () => Inner, nullable: true })
      inner!: Inner | null;
    }
    expect(required(Outer)).not.toContain("inner");
    expect(failed(Outer, { inner: null })).toEqual([]);
    expect(failed(Outer, {})).toEqual([]);
  });

  it("Type с hidden: входное значение отбрасывается, ошибки нет", () => {
    @ComponentSchema()
    class Inner {
      @PropertySchema.String({})
      value!: string;
    }
    @ComponentSchema()
    class Outer {
      @PropertySchema.String({})
      name!: string;

      @PropertySchema.Type({ value: () => Inner, hidden: true })
      inner!: Inner;
    }
    expect(failed(Outer, { name: "x" })).toEqual([]);
    expect(failed(Outer, { name: "x", inner: { value: "x" } })).toEqual([]);
  });

  it("Any без isOptional: отсутствующее значение — ошибка, свойство в required", () => {
    @ComponentSchema()
    class Bag {
      @PropertySchema.Any({})
      payload!: unknown;
    }
    expect(required(Bag)).toContain("payload");
    expect(failed(Bag, {})).toContain("payload");
    expect(failed(Bag, { payload: 0 })).toEqual([]);
  });

  it("Any с isOptional или nullable: отсутствие и null допустимы", () => {
    @ComponentSchema()
    class Bag {
      @PropertySchema.Any({ isOptional: true })
      maybe?: unknown;

      @PropertySchema.Any({ nullable: true })
      orNull!: unknown;
    }
    expect(failed(Bag, {})).toEqual([]);
    expect(failed(Bag, { orNull: null })).toEqual([]);
  });

  it("скалярные фабрики без isOptional уже отвергают отсутствующее значение", () => {
    enum Kind {
      A = "a",
    }
    @ComponentSchema()
    class Scalars {
      @PropertySchema.String({})
      s!: string;
      @PropertySchema.Number({})
      n!: number;
      @PropertySchema.Boolean({})
      b!: boolean;
      @PropertySchema.Date({})
      d!: Date;
      @PropertySchema.Enum({ value: Kind })
      e!: Kind;
    }
    expect(failed(Scalars, {}).sort()).toEqual(["b", "d", "e", "n", "s"]);
  });
});
