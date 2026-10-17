// Контракт: packages/schemer/readme.md#свёртка-схем-для-кодогенерации-foldschemas-1.
// Реализация — packages/schemer/src/defines/folding.ts (`foldSchemas`).
// Тесты пишутся по контракту формата, а не по реализации.
import { describe, it, expect, vi } from "vitest";
import {
  ComponentSchema,
  PropertySchema,
  PickType,
  OmitType,
  PartialType,
  IntersectionType,
  SchemaTypes,
  foldSchemas,
} from "@aom-js/schemer";
import {
  IsUUID,
  Matches,
  Length,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
  registerDecorator,
} from "class-validator";
import { Transform } from "class-transformer";

describe("foldSchemas: базовый формат", () => {
  it("формат помечен как format: 1", () => {
    @ComponentSchema()
    class FormatDto {
      @PropertySchema.String({})
      a!: string;
    }
    expect(foldSchemas([FormatDto]).format).toBe(1);
  });

  it("ключи components отсортированы независимо от порядка корней", () => {
    @ComponentSchema()
    class Zeta {
      @PropertySchema.String({})
      v!: string;
    }
    @ComponentSchema()
    class Alpha {
      @PropertySchema.String({})
      v!: string;
    }
    @ComponentSchema()
    class Mid {
      @PropertySchema.String({})
      v!: string;
    }

    const folded = foldSchemas([Zeta, Alpha, Mid]);
    expect(Object.keys(folded.components)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("порядок свойств компонента — как в исходном классе, а не алфавитный", () => {
    @ComponentSchema()
    class OrderDto {
      @PropertySchema.Number({})
      second!: number;

      @PropertySchema.String({})
      first!: string;
    }

    const folded = foldSchemas([OrderDto]);
    expect(Object.keys(folded.components.OrderDto.properties)).toEqual(["second", "first"]);
  });

  it("порядок ключей внутри params свойства — как передано, а не алфавитный", () => {
    @ComponentSchema()
    class ParamOrderDto {
      @PropertySchema.Number({ maxValue: 5, description: "x" })
      value!: number;
    }

    const folded = foldSchemas([ParamOrderDto]);
    expect(Object.keys(folded.components.ParamOrderDto.properties.value.params)).toEqual([
      "maxValue",
      "description",
    ]);
  });

  it("factory свойства соответствует использованной фабрике PropertySchema", () => {
    @ComponentSchema()
    class FactoryDto {
      @PropertySchema.String({})
      s!: string;

      @PropertySchema.Number({})
      n!: number;
    }

    const folded = foldSchemas([FactoryDto]);
    expect(folded.components.FactoryDto.properties.s.factory).toBe(SchemaTypes.STRING);
    expect(folded.components.FactoryDto.properties.n.factory).toBe(SchemaTypes.NUMBER);
  });

  it("params компонента отсутствует, если аргумент @ComponentSchema не передан", () => {
    @ComponentSchema()
    class BareDto {
      @PropertySchema.String({})
      v!: string;
    }

    expect(foldSchemas([BareDto]).components.BareDto.params).toBeUndefined();
  });

  it("params компонента содержит только переданные description/deprecated", () => {
    @ComponentSchema({ description: "Описание", deprecated: true })
    class DescribedDto {
      @PropertySchema.String({})
      v!: string;
    }

    expect(foldSchemas([DescribedDto]).components.DescribedDto.params).toEqual({
      description: "Описание",
      deprecated: true,
    });
  });
});

describe("foldSchemas: наследование", () => {
  @ComponentSchema()
  class InheritParent {
    @PropertySchema.String({})
    parentField!: string;
  }

  @ComponentSchema()
  class InheritChild extends InheritParent {
    @PropertySchema.Number({})
    childField!: number;
  }

  it("потомок содержит только свои свойства", () => {
    const folded = foldSchemas([InheritChild]);
    expect(Object.keys(folded.components.InheritChild.properties)).toEqual(["childField"]);
  });

  it("extends указывает на имя родителя-компонента", () => {
    const folded = foldSchemas([InheritChild]);
    expect(folded.components.InheritChild.extends).toBe("InheritParent");
  });

  it("родитель-компонент попадает в components через обход, со своими свойствами", () => {
    const folded = foldSchemas([InheritChild]);
    expect(Object.keys(folded.components.InheritParent.properties)).toEqual(["parentField"]);
  });

  it("extends отсутствует, если прямой родитель не компонент", () => {
    class PlainBase {}

    @ComponentSchema()
    class NoExtendsChild extends PlainBase {
      @PropertySchema.String({})
      own!: string;
    }

    const folded = foldSchemas([NoExtendsChild]);
    expect(folded.components.NoExtendsChild.extends).toBeUndefined();
    expect(Object.keys(folded.components.NoExtendsChild.properties)).toEqual(["own"]);
  });

  // недекорированный промежуточный класс сам в формат не попадает: extends указывает на
  // ближайшего предка-компонента, а его собственные свойства достаются потомку как свои
  it("недекорированный промежуточный класс со своим свойством: оно среди своих у потомка, extends — ближайший компонент", () => {
    @ComponentSchema()
    class MidBase {
      @PropertySchema.String({})
      baseField!: string;
    }

    class Mid extends MidBase {
      @PropertySchema.Number({})
      midField!: number;
    }

    @ComponentSchema()
    class MidChild extends Mid {}

    const folded = foldSchemas([MidChild]);
    expect(folded.components.MidChild.extends).toBe("MidBase");
    expect(Object.keys(folded.components.MidChild.properties)).toEqual(["midField"]);
    expect(Object.keys(folded.components.MidBase.properties)).toEqual(["baseField"]);
    expect(folded.components.Mid).toBeUndefined();
  });
});

describe("foldSchemas: mapped-types", () => {
  it("PickType сворачивается в { $mapped: Pick, of, keys }", () => {
    @ComponentSchema()
    class PickBase {
      @PropertySchema.String({})
      name!: string;

      @PropertySchema.Number({})
      age!: number;
    }

    @ComponentSchema()
    class PickChild extends PickType(PickBase, ["name"]) {
      @PropertySchema.Boolean({})
      flag!: boolean;
    }

    const folded = foldSchemas([PickChild]);
    expect(folded.components.PickChild.extends).toEqual({
      $mapped: "Pick",
      of: "PickBase",
      keys: ["name"],
    });
    // свойство name унаследовано через mapped-родителя — среди своих его быть не должно
    expect(Object.keys(folded.components.PickChild.properties)).toEqual(["flag"]);
  });

  it("OmitType сворачивается в { $mapped: Omit, of, keys } с исходными (не оставшимися) ключами", () => {
    @ComponentSchema()
    class OmitBase {
      @PropertySchema.String({})
      name!: string;

      @PropertySchema.Number({})
      age!: number;
    }

    @ComponentSchema()
    class OmitChild extends OmitType(OmitBase, ["age"]) {}

    const folded = foldSchemas([OmitChild]);
    expect(folded.components.OmitChild.extends).toEqual({
      $mapped: "Omit",
      of: "OmitBase",
      keys: ["age"],
    });
  });

  it("PartialType сворачивается в { $mapped: Partial, of } без keys", () => {
    @ComponentSchema()
    class PartialBase {
      @PropertySchema.String({})
      name!: string;
    }

    @ComponentSchema()
    class PartialChild extends PartialType(PartialBase) {}

    const folded = foldSchemas([PartialChild]);
    expect(folded.components.PartialChild.extends).toEqual({
      $mapped: "Partial",
      of: "PartialBase",
    });
  });

  it("IntersectionType сворачивается в { $mapped: Intersection, of: [...] }", () => {
    @ComponentSchema()
    class InterA {
      @PropertySchema.String({})
      a!: string;
    }
    @ComponentSchema()
    class InterB {
      @PropertySchema.Number({})
      b!: number;
    }

    @ComponentSchema()
    class InterChild extends IntersectionType(InterA, InterB) {}

    const folded = foldSchemas([InterChild]);
    expect(folded.components.InterChild.extends).toEqual({
      $mapped: "Intersection",
      of: ["InterA", "InterB"],
    });
  });

  it("вложенные mapped-types описываются рекурсивно: Intersection(A, Partial(B))", () => {
    @ComponentSchema()
    class NestA {
      @PropertySchema.String({})
      x!: string;
    }
    @ComponentSchema()
    class NestB {
      @PropertySchema.Number({})
      y!: number;
    }

    @ComponentSchema()
    class NestedChild extends IntersectionType(NestA, PartialType(NestB)) {}

    const folded = foldSchemas([NestedChild]);
    expect(folded.components.NestedChild.extends).toEqual({
      $mapped: "Intersection",
      of: ["NestA", { $mapped: "Partial", of: "NestB" }],
    });
  });

  it("анонимный mapped-класс не попадает в components — только его реальные источники", () => {
    @ComponentSchema()
    class SourceOnly {
      @PropertySchema.String({})
      name!: string;
    }

    @ComponentSchema()
    class MappedOnlyChild extends PickType(SourceOnly, ["name"]) {}

    const folded = foldSchemas([MappedOnlyChild]);
    expect(Object.keys(folded.components)).toEqual(["MappedOnlyChild", "SourceOnly"]);
  });
});

describe("foldSchemas: Type ($ref)", () => {
  it("Type.value сворачивается в { $ref: Имя }, цель добавляется в components", () => {
    @ComponentSchema()
    class RefTarget {
      @PropertySchema.String({})
      v!: string;
    }

    @ComponentSchema()
    class RefHolder {
      @PropertySchema.Type({ value: () => RefTarget })
      t!: RefTarget;
    }

    // передаём только RefHolder — RefTarget должен найтись обходом по связям
    const folded = foldSchemas([RefHolder]);
    expect(folded.components.RefHolder.properties.t.params.value).toEqual({ $ref: "RefTarget" });
    expect(folded.components.RefTarget).toBeDefined();
  });

  it("isArray у Type сохраняется рядом с $ref", () => {
    @ComponentSchema()
    class ArrRefTarget {
      @PropertySchema.String({})
      v!: string;
    }

    @ComponentSchema()
    class ArrRefHolder {
      @PropertySchema.Type({ value: () => ArrRefTarget, isArray: true })
      list!: ArrRefTarget[];
    }

    const folded = foldSchemas([ArrRefHolder]);
    expect(folded.components.ArrRefHolder.properties.list.params).toMatchObject({
      value: { $ref: "ArrRefTarget" },
      isArray: true,
    });
  });

  it("цикл A↔B по ссылкам не зацикливает обход", () => {
    @ComponentSchema()
    class CycleA {
      @PropertySchema.Type({ value: () => CycleB })
      b!: unknown;
    }
    @ComponentSchema()
    class CycleB {
      @PropertySchema.Type({ value: () => CycleA })
      a!: unknown;
    }

    const folded = foldSchemas([CycleA]);
    expect(Object.keys(folded.components).sort()).toEqual(["CycleA", "CycleB"]);
    expect(folded.components.CycleA.properties.b.params.value).toEqual({ $ref: "CycleB" });
    expect(folded.components.CycleB.properties.a.params.value).toEqual({ $ref: "CycleA" });
  });
});

describe("foldSchemas: Enum", () => {
  it("строковый enum: значения в общем словаре enums, $enum ссылается на него", () => {
    enum StatusEnum {
      Active = "active",
      Blocked = "blocked",
    }

    @ComponentSchema()
    class StringEnumDto {
      @PropertySchema.Enum({ value: StatusEnum, enumName: "StatusEnum" })
      status!: StatusEnum;
    }

    const folded = foldSchemas([StringEnumDto]);
    expect(folded.components.StringEnumDto.properties.status.params.value).toEqual({
      $enum: "StatusEnum",
    });
    expect(folded.enums.StatusEnum).toEqual({ Active: "active", Blocked: "blocked" });
  });

  it("числовой enum: словарь без обратных числовых ключей", () => {
    enum LevelEnum {
      Low,
      Mid,
      High,
    }

    @ComponentSchema()
    class NumericEnumDto {
      @PropertySchema.Enum({ value: LevelEnum, enumName: "LevelEnum" })
      level!: LevelEnum;
    }

    const folded = foldSchemas([NumericEnumDto]);
    expect(folded.enums.LevelEnum).toEqual({ Low: 0, Mid: 1, High: 2 });
    expect(Object.keys(folded.enums.LevelEnum)).toEqual(["Low", "Mid", "High"]);
  });

  it("один и тот же объект enum в двух свойствах — одна запись в enums", () => {
    const Shared = { Active: "active", Blocked: "blocked" } as const;

    @ComponentSchema()
    class TwoEnumPropsDto {
      @PropertySchema.Enum({ value: Shared })
      a!: string;

      @PropertySchema.Enum({ value: Shared })
      b!: string;
    }

    const folded = foldSchemas([TwoEnumPropsDto]);
    const aRef = folded.components.TwoEnumPropsDto.properties.a.params.value as { $enum: string };
    const bRef = folded.components.TwoEnumPropsDto.properties.b.params.value as { $enum: string };
    expect(aRef.$enum).toBe(bRef.$enum);
    expect(Object.keys(folded.enums)).toHaveLength(1);
  });

  it("без enumName имя по умолчанию — ${Компонент}${Свойство с большой буквы}", () => {
    @ComponentSchema()
    class DefaultNameDto {
      @PropertySchema.Enum({ value: { A: "a", B: "b" } })
      kind!: string;
    }

    const folded = foldSchemas([DefaultNameDto]);
    expect(folded.components.DefaultNameDto.properties.kind.params.value).toEqual({
      $enum: "DefaultNameDtoKind",
    });
    expect(folded.enums.DefaultNameDtoKind).toEqual({ A: "a", B: "b" });
  });
});

describe("foldSchemas: метка $date", () => {
  @ComponentSchema()
  class DateDto {
    @PropertySchema.Date({ default: new Date("2020-01-01T00:00:00.000Z") })
    when!: Date;

    @PropertySchema.Date({ minDate: new Date("2019-06-15T00:00:00.000Z") })
    since!: Date;
  }

  it("Date в default сворачивается в { $date: ISOString }", () => {
    const folded = foldSchemas([DateDto]);
    expect(folded.components.DateDto.properties.when.params.default).toEqual({
      $date: "2020-01-01T00:00:00.000Z",
    });
  });

  it("Date в minDate сворачивается в { $date: ISOString }", () => {
    const folded = foldSchemas([DateDto]);
    expect(folded.components.DateDto.properties.since.params.minDate).toEqual({
      $date: "2019-06-15T00:00:00.000Z",
    });
  });
});

describe("foldSchemas: метка $validator (decorators)", () => {
  @ComponentSchema()
  class ValidatorsDto {
    @PropertySchema.String({ decorators: [IsUUID()] })
    id!: string;

    @PropertySchema.String({ decorators: [Matches(/^a/i)] })
    code!: string;

    @PropertySchema.String({ decorators: [Length(2, 5)] })
    short!: string;

    @PropertySchema.String({ decorators: [MaxLength(3, { message: "m", groups: ["g"] })] })
    capped!: string;
  }

  it("IsUUID() сворачивается в { $validator: 'IsUUID', args: [] }", () => {
    const folded = foldSchemas([ValidatorsDto]);
    expect(folded.components.ValidatorsDto.properties.id.params.decorators).toEqual([
      { $validator: "IsUUID", args: [] },
    ]);
  });

  it("Matches(/^a/i) сворачивается в { $validator: 'Matches', args: [{ $regexp: [source, flags] }] }", () => {
    const folded = foldSchemas([ValidatorsDto]);
    expect(folded.components.ValidatorsDto.properties.code.params.decorators).toEqual([
      { $validator: "Matches", args: [{ $regexp: ["^a", "i"] }] },
    ]);
  });

  it("Length(2, 5) сворачивается в { $validator: 'Length', args: [2, 5] }", () => {
    const folded = foldSchemas([ValidatorsDto]);
    expect(folded.components.ValidatorsDto.properties.short.params.decorators).toEqual([
      { $validator: "Length", args: [2, 5] },
    ]);
  });

  it("MaxLength(3, { message, groups }) сохраняет опции вторым аргументом", () => {
    const folded = foldSchemas([ValidatorsDto]);
    expect(folded.components.ValidatorsDto.properties.capped.params.decorators).toEqual([
      { $validator: "MaxLength", args: [3, { message: "m", groups: ["g"] }] },
    ]);
  });
});

describe("foldSchemas: молчаливый пропуск нераспознаваемых декораторов", () => {
  function IsCustomThing(): PropertyDecorator {
    return (object: object, propertyName: string | symbol) => {
      registerDecorator({
        name: "isCustomThing",
        target: object.constructor,
        propertyName: propertyName as string,
        validator: { validate: (value: unknown) => typeof value === "string" },
      });
    };
  }

  @ComponentSchema()
  class SkipDto {
    @PropertySchema.String({ decorators: [Transform(({ value }) => value)] })
    transformed!: string;

    @PropertySchema.String({ decorators: [IsCustomThing()] })
    custom!: string;

    @PropertySchema.String({ decorators: [ValidateIf(() => true)] })
    conditional!: string;

    @PropertySchema.String({ decorators: [IsNotEmpty({ message: () => "x" })] })
    funcMessage!: string;
  }

  it("Transform (class-transformer) пропускается", () => {
    const folded = foldSchemas([SkipDto]);
    expect(folded.components.SkipDto.properties.transformed.params.decorators).toEqual([]);
  });

  it("собственный декоратор через registerDecorator пропускается", () => {
    const folded = foldSchemas([SkipDto]);
    expect(folded.components.SkipDto.properties.custom.params.decorators).toEqual([]);
  });

  it("ValidateIf(fn) пропускается", () => {
    const folded = foldSchemas([SkipDto]);
    expect(folded.components.SkipDto.properties.conditional.params.decorators).toEqual([]);
  });

  it("декоратор с message-функцией пропускается", () => {
    const folded = foldSchemas([SkipDto]);
    expect(folded.components.SkipDto.properties.funcMessage.params.decorators).toEqual([]);
  });

  it("пропуск нераспознанных декораторов не пишет предупреждение в консоль", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      foldSchemas([SkipDto]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("foldSchemas: массивы в params", () => {
  // элемент массива без метки (функция) заменяется на null на своём месте — без сдвига индексов
  it("функция посередине массива examples сворачивается в null, длина и позиции сохраняются", () => {
    @ComponentSchema()
    class ArrayHoleDto {
      @PropertySchema.String({ examples: ["a", () => "skip", "c"] as unknown as string[] })
      v!: string;
    }

    const folded = foldSchemas([ArrayHoleDto]);
    expect(folded.components.ArrayHoleDto.properties.v.params.examples).toEqual(["a", null, "c"]);
  });
});

describe("foldSchemas: ошибки foldSchemas:", () => {
  it("mapped-класс как корень — ошибка", () => {
    @ComponentSchema()
    class RootMappedBase {
      @PropertySchema.String({})
      field!: string;
    }
    const RootMapped = PickType(RootMappedBase, ["field"]);

    // сообщение должно называть форму вызова (PickType(...)), а не служебное имя анонимного класса
    expect(() => foldSchemas([RootMapped as unknown as typeof RootMappedBase])).toThrow(
      /^foldSchemas: PickType\(RootMappedBase, \["field"\]\)/,
    );
  });

  it("mapped-класс как цель Type — ошибка", () => {
    @ComponentSchema()
    class RefMappedBase {
      @PropertySchema.String({})
      field!: string;
    }
    const RefMappedTarget = PickType(RefMappedBase, ["field"]);

    @ComponentSchema()
    class RefHolderWithMappedTarget {
      @PropertySchema.Type({ value: () => RefMappedTarget as unknown as typeof RefMappedBase })
      ref!: unknown;
    }

    expect(() => foldSchemas([RefHolderWithMappedTarget])).toThrow(
      /^foldSchemas: PickType\(RefMappedBase, \["field"\]\)/,
    );
  });

  // вложенный mapped-класс — форма разворачивается рекурсивно, а не только верхний уровень
  it("вложенный mapped-класс как корень — ошибка называет форму целиком", () => {
    @ComponentSchema()
    class NestedMappedA {
      @PropertySchema.String({})
      a!: string;
    }
    @ComponentSchema()
    class NestedMappedB {
      @PropertySchema.Number({})
      b!: number;
    }
    const NestedMapped = IntersectionType(NestedMappedA, PartialType(NestedMappedB));

    expect(() => foldSchemas([NestedMapped as unknown as typeof NestedMappedA])).toThrow(
      /^foldSchemas: IntersectionType\(NestedMappedA, PartialType\(NestedMappedB\)\)/,
    );
  });

  it("два разных класса с одним именем — ошибка", () => {
    const classNamed = (name: string) => ({ [name]: class {} })[name];
    const DupA = classNamed("DupName") as unknown as new () => unknown;
    const DupB = classNamed("DupName") as unknown as new () => unknown;

    Reflect.decorate([PropertySchema.String({})], (DupA as any).prototype, "value");
    ComponentSchema()(DupA as any);
    Reflect.decorate([PropertySchema.Number({})], (DupB as any).prototype, "value");
    ComponentSchema()(DupB as any);

    expect(() => foldSchemas([DupA, DupB])).toThrow(/^foldSchemas:/);
  });

  it("@PropertySchema на статическом свойстве — ошибка", () => {
    @ComponentSchema()
    class WithStaticProp {
      @PropertySchema.String({})
      static staticField!: string;
    }

    expect(() => foldSchemas([WithStaticProp])).toThrow(/^foldSchemas:/);
  });

  it("одно имя enum с разными значениями — ошибка", () => {
    @ComponentSchema()
    class EnumConflictA {
      @PropertySchema.Enum({ value: { A: "a", B: "b" }, enumName: "ConflictEnum" })
      s!: string;
    }
    @ComponentSchema()
    class EnumConflictB {
      @PropertySchema.Enum({ value: { A: "a", B: "c" }, enumName: "ConflictEnum" })
      s!: string;
    }

    expect(() => foldSchemas([EnumConflictA, EnumConflictB])).toThrow(/^foldSchemas:/);
  });
});

describe("foldSchemas: детерминизм", () => {
  @ComponentSchema()
  class DeterminismDto {
    @PropertySchema.String({ decorators: [IsUUID()] })
    id!: string;

    @PropertySchema.Enum({ value: { A: "a", B: "b" } })
    kind!: string;
  }

  it("два вызова на тех же корнях дают равные результаты", () => {
    const first = foldSchemas([DeterminismDto]);
    const second = foldSchemas([DeterminismDto]);
    expect(second).toEqual(first);
  });

  it("JSON-круг (parse(stringify(x))) не теряет данные", () => {
    const folded = foldSchemas([DeterminismDto]);
    expect(JSON.parse(JSON.stringify(folded))).toEqual(folded);
  });
});
