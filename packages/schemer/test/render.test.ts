import { describe, it, expect } from "vitest";
import { ComponentSchema, PropertySchema, Schemer, AomSchemas } from "@aom-js/schemer";

const schemer = new Schemer("#/components/schemas/");

enum Status {
  Active = "active",
  Blocked = "blocked",
}

@ComponentSchema({ description: "Пользователь" })
class UserDto {
  @PropertySchema.String({ minLength: 2, maxLength: 50, description: "Имя" })
  name!: string;

  @PropertySchema.Number({ isOptional: true, minValue: 1 })
  age?: number;

  @PropertySchema.Boolean({ isOptional: true, default: false })
  active?: boolean;

  @PropertySchema.Enum({ value: Status, isOptional: true })
  status?: Status;
}

describe("schemer: рендер JSON Schema", () => {
  it("класс регистрируется как компонентная схема", () => {
    const $user = AomSchemas.checkExists(UserDto);
    expect($user?.isComponentSchema).toBe(true);
  });

  it("свойства рендерятся с типами и ограничениями", () => {
    const schema = schemer.render(UserDto);
    expect(schema.properties).toMatchObject({
      name: { type: "string", minLength: 2, maxLength: 50, description: "Имя" },
      age: { type: "number", minimum: 1 },
      active: { type: "boolean", default: false },
    });
    expect((schema.properties!.status as any).enum).toEqual(
      expect.arrayContaining(["active", "blocked"]),
    );
  });

  it("required содержит только обязательные свойства", () => {
    const schema = schemer.render(UserDto);
    expect(schema.required).toContain("name");
    expect(schema.required ?? []).not.toContain("age");
    expect(schema.required ?? []).not.toContain("status");
  });

  it("описание класса из ComponentSchema попадает в схему", () => {
    const schema = schemer.render(UserDto);
    expect(schema.description).toBe("Пользователь");
  });

  it("Type создает связь (connections) и $ref в рендере", () => {
    @ComponentSchema()
    class Pet {
      @PropertySchema.String({})
      nick!: string;
    }

    @ComponentSchema()
    class Owner {
      @PropertySchema.Type({ value: () => Pet })
      pet!: Pet;
    }

    const $owner = AomSchemas.checkExists(Owner)!;
    const connection = $owner.connections.get("pet");
    expect(connection).toBeTypeOf("function");
    expect(connection!()).toBe(Pet);

    const schema = schemer.render(Owner);
    expect(JSON.stringify(schema.properties!.pet)).toContain("#/components/schemas/Pet");
  });

  // FINDING: нулевые ограничения игнорируются — truthy-проверки `params.minValue ? Min(...)` в properties.ts
  it.fails("minValue: 0 должен попадать в схему как minimum: 0 (дефект: truthy-проверка)", () => {
    @ComponentSchema()
    class ZeroMin {
      @PropertySchema.Number({ minValue: 0 })
      qty!: number;
    }
    const schema = schemer.render(ZeroMin);
    expect((schema.properties!.qty as any).minimum).toBe(0);
  });

  it("наследование: схема потомка включает свойства родителя", () => {
    @ComponentSchema()
    class BaseDto {
      @PropertySchema.String({})
      id!: string;
    }

    @ComponentSchema()
    class ExtDto extends BaseDto {
      @PropertySchema.String({})
      extra!: string;
    }

    const schema = schemer.render(ExtDto);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "extra"]),
    );
  });
});
