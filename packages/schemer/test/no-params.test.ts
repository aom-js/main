import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ComponentSchema, PropertySchema, Schemer } from "@aom-js/schemer";

describe("schemer: фабрики без обязательных параметров вызываются без аргумента", () => {
  it("String/Number/Boolean/Date/Any() работают как с {}", () => {
    @ComponentSchema()
    class Bare {
      @PropertySchema.String()
      s!: string;
      @PropertySchema.Number()
      n!: number;
      @PropertySchema.Boolean()
      b!: boolean;
      @PropertySchema.Date()
      d!: Date;
      @PropertySchema.Any()
      a!: unknown;
    }
    const schema = new Schemer("#/components/schemas/").render(Bare);
    expect(schema.required).toEqual(["s", "n", "b", "d", "a"]);
    const dto = plainToInstance(Bare, { s: "x", n: "1", b: "true", d: "2020-01-02", a: 0 });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.n).toBe(1);
  });
});
