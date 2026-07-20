import { describe, it, expect } from "vitest";
import { ComponentSchema, PropertySchema, Schemer, SchemasCollector } from "@aom-js/schemer";

@ComponentSchema()
class Toy {
  @PropertySchema.String({})
  label!: string;
}

@ComponentSchema()
class Pet {
  @PropertySchema.String({})
  nick!: string;

  @PropertySchema.Type({ value: () => Toy })
  toy!: Toy;
}

@ComponentSchema()
class Owner {
  @PropertySchema.Type({ value: () => Pet })
  pet!: Pet;
}

describe("schemer: сборщик компонент (каскад $ref)", () => {
  const makeCollector = () => new SchemasCollector(new Schemer("#/components/schemas/"));

  it("компонентный класс превращается в $ref, схема попадает в components", () => {
    const collector = makeCollector();
    expect(collector.extract(Owner)).toEqual({ $ref: "#/components/schemas/Owner" });
    expect(collector.components.get("Owner")).toMatchObject({ type: "object" });
  });

  it("связи собираются каскадом на всю глубину", () => {
    const collector = makeCollector();
    collector.extract(Owner);
    expect([...collector.components.keys()]).toEqual(
      expect.arrayContaining(["Owner", "Pet", "Toy"]),
    );
  });

  it("не-компонент возвращается как есть и не попадает в components", () => {
    const collector = makeCollector();
    const raw = { type: "string" };
    expect(collector.extract(raw)).toBe(raw);
    expect(collector.components.size).toBe(0);
  });

  it("повторный extract идемпотентен — компонент рендерится один раз", () => {
    const collector = makeCollector();
    collector.extract(Owner);
    const first = collector.components.get("Pet");
    collector.extract(Pet);
    expect(collector.components.get("Pet")).toBe(first);
  });
});
