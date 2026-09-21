import { describe, it, expect } from "vitest";
import { plainToInstance, instanceToPlain } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

@ComponentSchema()
class FormDto {
  @PropertySchema.String({ minLength: 2 })
  name!: string;

  @PropertySchema.Number({ isOptional: true })
  age?: number;

  @PropertySchema.Boolean({ isOptional: true })
  active?: boolean;

  @PropertySchema.Date({ isOptional: true })
  born?: Date;

  @PropertySchema.Number({ isOptional: true, nullable: true })
  score?: number | null;

  @PropertySchema.String({ isOptional: true, hidden: true })
  secret?: string;
}

describe("schemer: трансформация значений", () => {
  it("Number приводит строку к числу", () => {
    const dto = plainToInstance(FormDto, { name: "ok", age: "42" });
    expect(dto.age).toBe(42);
  });

  it('Boolean понимает "true"/"false" и числа', () => {
    expect(plainToInstance(FormDto, { name: "ok", active: "true" }).active).toBe(true);
    expect(plainToInstance(FormDto, { name: "ok", active: "false" }).active).toBe(false);
    expect(plainToInstance(FormDto, { name: "ok", active: "1" }).active).toBe(true);
  });

  it("Date приводит строку к дате", () => {
    const dto = plainToInstance(FormDto, { name: "ok", born: "2020-01-02" });
    expect(dto.born).toBeInstanceOf(Date);
    expect(dto.born!.getFullYear()).toBe(2020);
  });

  it("nullable пропускает null без приведения", () => {
    const dto = plainToInstance(FormDto, { name: "ok", score: null });
    expect(dto.score).toBeNull();
  });

  it("hidden исключает свойство при сериализации", () => {
    const dto = plainToInstance(FormDto, { name: "ok", secret: "x" });
    expect(instanceToPlain(dto)).not.toHaveProperty("secret");
  });
});

describe("schemer: валидация", () => {
  it("отсутствие обязательного свойства — ошибка", () => {
    const errors = validateSync(plainToInstance(FormDto, {}));
    expect(errors.map((e) => e.property)).toContain("name");
  });

  it("нарушение minLength — ошибка", () => {
    const errors = validateSync(plainToInstance(FormDto, { name: "a" }));
    expect(errors.map((e) => e.property)).toContain("name");
  });

  it("валидный объект проходит без ошибок", () => {
    const errors = validateSync(plainToInstance(FormDto, { name: "ok", age: "5" }));
    expect(errors).toEqual([]);
  });

  // KI-SCHEMER-02: Number с nullable без isOptional отвергал null — не было IsNullable()
  it("Number с nullable без isOptional пропускает null", () => {
    @ComponentSchema()
    class ScoreDto {
      @PropertySchema.Number({ nullable: true })
      score!: number | null;
    }
    const errors = validateSync(plainToInstance(ScoreDto, { score: null }));
    expect(errors).toEqual([]);
  });

  // KI-SCHEMER-04: Min/Max вызывались без each — при isArray ограничение проверяло сам массив, а не элементы.
  // Number.Transform приводит значение через Number(...), поэтому инстанс собираем напрямую, минуя plainToInstance
  it("minValue с isArray проверяет каждый элемент массива, а не сам массив", () => {
    @ComponentSchema()
    class RanksDto {
      @PropertySchema.Number({ isArray: true, minValue: 1 })
      values!: number[];
    }

    const good = new RanksDto();
    good.values = [1, 2, 3];
    expect(validateSync(good)).toEqual([]);

    const bad = new RanksDto();
    bad.values = [0, 1];
    expect(validateSync(bad).map((e) => e.property)).toContain("values");
  });
});

describe("schemer: params.decorators применяются", () => {
  // KI-SCHEMER-03: Date и Type игнорировали params.decorators
  it("Date применяет декораторы из params.decorators", () => {
    const seen: string[] = [];
    const marker: PropertyDecorator = (_target, key) => {
      seen.push(String(key));
    };

    @ComponentSchema()
    class DateWithDecorators {
      @PropertySchema.Date({ decorators: [marker] })
      when!: Date;
    }
    void DateWithDecorators;

    expect(seen).toContain("when");
  });

  it("Type применяет декораторы из params.decorators", () => {
    const seen: string[] = [];
    const marker: PropertyDecorator = (_target, key) => {
      seen.push(String(key));
    };

    @ComponentSchema()
    class Nested {
      @PropertySchema.String({})
      value!: string;
    }

    @ComponentSchema()
    class TypeWithDecorators {
      @PropertySchema.Type({ value: () => Nested, decorators: [marker] })
      nested!: Nested;
    }
    void TypeWithDecorators;

    expect(seen).toContain("nested");
  });
});

describe("schemer: защита от двойного описания", () => {
  it("два PropertySchema на одном свойстве — ошибка при декорировании класса", () => {
    expect(() => {
      @ComponentSchema()
      class Bad {
        @PropertySchema.String({})
        @PropertySchema.Number({})
        x!: unknown;
      }
      void Bad;
    }).toThrow(/already has defined schema params/);
  });
});
