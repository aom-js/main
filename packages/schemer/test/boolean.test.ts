import { describe, it, expect } from "vitest";
import { plainToInstance, Transform } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

describe("schemer: Boolean приводит только однозначные значения", () => {
  @ComponentSchema()
  class Flags {
    @PropertySchema.Boolean({})
    active!: boolean;
  }
  const parse = (active: unknown) => plainToInstance(Flags, { active });

  it.each([
    ["true", true],
    ["1", true],
    [true, true],
    ["false", false],
    ["0", false],
    [false, false],
  ])("%j → %j без ошибок", (input, expected) => {
    const dto = parse(input);
    expect(dto.active).toBe(expected);
    expect(validateSync(dto)).toEqual([]);
  });

  it.each(["yes", "", "2", "TRUE"])("%j остаётся как есть и не проходит проверку", (input) => {
    const dto = parse(input);
    expect(dto.active).toBe(input);
    expect(validateSync(dto).map((e) => e.property)).toEqual(["active"]);
  });

  it("nullable оставляет null", () => {
    @ComponentSchema()
    class Maybe {
      @PropertySchema.Boolean({ nullable: true })
      active!: boolean | null;
    }
    const dto = plainToInstance(Maybe, { active: null });
    expect(dto.active).toBeNull();
    expect(validateSync(dto)).toEqual([]);
  });

  it("приведение идёт после пользовательских декораторов и поэлементно при isArray", () => {
    const SplitComma = () =>
      Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(",")));
    @ComponentSchema()
    class List {
      @PropertySchema.Boolean({ isArray: true, decorators: [SplitComma()] })
      flags!: boolean[];
    }
    const dto = plainToInstance(List, { flags: "1,false" });
    expect(dto.flags).toEqual([true, false]);
    expect(validateSync(dto)).toEqual([]);
  });
});
