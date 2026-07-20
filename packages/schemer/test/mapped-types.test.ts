import { describe, it, expect } from "vitest";
import {
  ComponentSchema,
  PropertySchema,
  Schemer,
  AomSchemas,
  PickType,
  OmitType,
  PartialType,
  IntersectionType,
} from "@aom-js/schemer";

const schemer = new Schemer("#/components/schemas/");

@ComponentSchema()
class SourceDto {
  @PropertySchema.String({})
  id!: string;

  @PropertySchema.String({})
  name!: string;

  @PropertySchema.Number({ isOptional: true })
  age?: number;
}

describe("schemer: mapped-types", () => {
  it("PickType оставляет только выбранные свойства", () => {
    const Picked = PickType(SourceDto, ["name"]);
    const schema = schemer.render(Picked);
    expect(Object.keys(schema.properties ?? {})).toEqual(["name"]);
  });

  it("OmitType убирает указанные свойства", () => {
    const Omitted = OmitType(SourceDto, ["id"]);
    const schema = schemer.render(Omitted);
    const keys = Object.keys(schema.properties ?? {});
    expect(keys).toEqual(expect.arrayContaining(["name", "age"]));
    expect(keys).not.toContain("id");
  });

  it("PartialType делает все свойства необязательными", () => {
    const Part = PartialType(SourceDto);
    const schema = schemer.render(Part);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "name", "age"]),
    );
    expect(schema.required ?? []).toEqual([]);
  });

  it("IntersectionType объединяет свойства двух схем", () => {
    @ComponentSchema()
    class ExtraDto {
      @PropertySchema.Boolean({})
      flag!: boolean;
    }
    const Combined = IntersectionType(SourceDto, ExtraDto);
    const schema = schemer.render(Combined);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "name", "age", "flag"]),
    );
  });

  it("производный класс сам зарегистрирован как компонентная схема", () => {
    const Picked = PickType(SourceDto, ["name"]);
    expect(AomSchemas.checkExists(Picked)?.isComponentSchema).toBe(true);
  });

  it("PickType от не-компонента — ошибка", () => {
    class Plain {}
    expect(() => PickType(Plain as any, [] as any)).toThrow(/not ComponentSchema/);
  });
});
