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

  // KI-SCHEMER-01: `params.x ? … : undefined` заменено на `params.x != null ? … : undefined`
  it("minValue: 0 попадает в схему как minimum: 0", () => {
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

  // KI-SCHEMER-05: readOnly не доходил до JSONSchema у Enum/Date/Type
  it("readOnly доходит до схемы у Enum, Date и Type", () => {
    @ComponentSchema()
    class Nested {
      @PropertySchema.String({})
      value!: string;
    }

    @ComponentSchema()
    class ReadOnlyDto {
      @PropertySchema.Enum({ value: Status, readOnly: true })
      status!: Status;

      @PropertySchema.Date({ readOnly: true })
      createdAt!: Date;

      @PropertySchema.Type({ value: () => Nested, readOnly: true })
      nested!: Nested;
    }

    const schema = schemer.render(ReadOnlyDto);
    expect((schema.properties!.status as any).readOnly).toBe(true);
    expect((schema.properties!.createdAt as any).readOnly).toBe(true);
    expect((schema.properties!.nested as any).readOnly).toBe(true);
  });

  // KI-SCHEMER-05: pattern был объявлен в типе, но не превращался в валидатор — и не попадал в схему
  it("pattern у String попадает в схему через Matches", () => {
    @ComponentSchema()
    class PatternDto {
      @PropertySchema.String({ pattern: "^[a-z]+$" })
      code!: string;
    }

    const schema = schemer.render(PatternDto);
    expect((schema.properties!.code as any).pattern).toBe("^[a-z]+$");
  });

  // KI-SCHEMER-06: decorators утекали в JSONSchema класса
  it("decorators из ComponentSchema не попадают в схему класса", () => {
    @ComponentSchema({ description: "С доп. декораторами", decorators: [] })
    class WithClassDecorators {
      @PropertySchema.String({})
      a!: string;
    }

    const schema = schemer.render(WithClassDecorators);
    expect(schema).not.toHaveProperty("decorators");
  });

  // enumName: параметр для будущего codegen — не должен влиять на JSON Schema
  it("enumName не меняет рендер и сохраняется в schemaParams", () => {
    @ComponentSchema()
    class WithoutEnumName {
      @PropertySchema.Enum({ value: Status })
      status!: Status;
    }

    @ComponentSchema()
    class WithEnumName {
      @PropertySchema.Enum({ value: Status, enumName: "Status" })
      status!: Status;
    }

    expect(schemer.render(WithEnumName)).toEqual(schemer.render(WithoutEnumName));
    const $status = AomSchemas.checkExists(WithEnumName)!._.properties.get("status");
    expect($status?.schemaParams).toMatchObject({ enumName: "Status" });
  });

  // KI-SCHEMER-10: недекорированный промежуточный класс не наследовал ничего сам, и
  // targetConstructorToSchema поднимался по прототипам до предка, отдавая его description/свойства
  it("недекорированный промежуточный класс не подменяет схему потомка предком", () => {
    @ComponentSchema({ description: "base" })
    class Base {
      @PropertySchema.String({ description: "a" })
      a!: string;
    }

    class Mid extends Base {}

    @ComponentSchema({ description: "child" })
    class Child extends Mid {}

    const schema = schemer.render(Child);
    expect(schema.description).toBe("child");
    expect(Object.keys(schema.properties ?? {})).toEqual(["a"]);
    expect(schemer.render(Base).description).toBe("base");
  });

  it("та же ситуация с двумя недекорированными промежуточными классами подряд", () => {
    @ComponentSchema({ description: "base" })
    class Base {
      @PropertySchema.String({ description: "a" })
      a!: string;
    }

    class Mid1 extends Base {}
    class Mid2 extends Mid1 {}

    @ComponentSchema({ description: "child" })
    class Child extends Mid2 {}

    const schema = schemer.render(Child);
    expect(schema.description).toBe("child");
    expect(Object.keys(schema.properties ?? {})).toEqual(["a"]);
  });

  // KI-SCHEMER-10: у самого промежуточного класса тоже может быть своё @PropertySchema-свойство
  // (без @ComponentSchema) — оно должно дойти до потомка наравне со свойствами дальнего предка
  it("недекорированный промежуточный класс со своим свойством — оно тоже доходит до потомка", () => {
    @ComponentSchema({ description: "base" })
    class Base {
      @PropertySchema.String({ description: "a" })
      a!: string;
    }

    class Mid extends Base {
      @PropertySchema.Number({ description: "b" })
      b!: number;
    }

    @ComponentSchema({ description: "child" })
    class Child extends Mid {}

    const schema = schemer.render(Child);
    expect(schema.description).toBe("child");
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
