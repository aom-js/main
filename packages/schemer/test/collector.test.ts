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

  it("скалярные конструкторы разворачиваются в JSON Schema литералы", () => {
    const collector = makeCollector();
    expect(collector.extract(String)).toEqual({ type: "string" });
    expect(collector.extract(Number)).toEqual({ type: "number" });
    expect(collector.extract(Boolean)).toEqual({ type: "boolean" });
    expect(collector.extract(Date)).toEqual({ type: "string", format: "date-time" });
    expect(collector.components.size).toBe(0);
  });

  it("строковые имена скаляров разворачиваются в JSON Schema литералы", () => {
    const collector = makeCollector();
    expect(collector.extract("string")).toEqual({ type: "string" });
    expect(collector.extract("number")).toEqual({ type: "number" });
    expect(collector.extract("integer")).toEqual({ type: "integer" });
    expect(collector.extract("boolean")).toEqual({ type: "boolean" });
    // KI-SCHEMER-08: форма совпадает с тем, что class-validator-jsonschema даёт для IsDate
    expect(collector.extract("date")).toEqual({
      oneOf: [
        { format: "date", type: "string" },
        { format: "date-time", type: "string" },
      ],
    });
  });

  it("неизвестное имя скаляра — ошибка на месте", () => {
    const collector = makeCollector();
    expect(() => collector.extract("strng")).toThrow(/strng/);
  });

  it("[T] разворачивается в array с items — для скаляров и компонентов", () => {
    const collector = makeCollector();
    expect(collector.extract(["string"])).toEqual({ type: "array", items: { type: "string" } });
    expect(collector.extract([Owner])).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/Owner" },
    });
    expect(collector.components.has("Owner")).toBe(true);
    expect(() => collector.extract([])).toThrow(/exactly one element type/);
    expect(() => collector.extract(["string", "number"])).toThrow(/exactly one element type/);
  });

  it("возвращаемые литералы скаляров независимы — мутация одного не портит словарь", () => {
    const collector = makeCollector();
    const first = collector.extract(String);
    first.title = "mutated";
    expect(collector.extract(String)).toEqual({ type: "string" });
  });

  it("класс без @ComponentSchema — ошибка на месте, а не молча сломанная схема", () => {
    const collector = makeCollector();
    class Naked {}
    expect(() => collector.extract(Naked)).toThrow(/Naked/);
  });
});
