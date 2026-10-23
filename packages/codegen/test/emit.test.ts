import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ComponentSchema,
  PropertySchema,
  PickType,
  PartialType,
  IntersectionType,
  foldSchemas,
  FoldedSchemas,
  SchemaTypes,
} from "@aom-js/schemer";
import { IsUUID, Length, Matches } from "class-validator";
import {
  emitService,
  emitSchemas,
  serviceDirName,
  planGeneration,
  diffManifest,
  TransferServiceDescriptor,
} from "@aom-js/codegen";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const origin = { instanceName: "orders", instanceKey: "k1" };
// собираем «дескриптор» вручную (не через foldSchemas) — так же, как он приезжает с шины:
// это позволяет подмешать в format-1 данные, которые foldSchemas никогда бы сам не выдал
const forgedDescriptor = (schemas: FoldedSchemas): TransferServiceDescriptor => ({
  name: "S",
  origin,
  hash: "h",
  methods: [],
  components: {},
  schemas,
});

@ComponentSchema()
class PriceDto {
  @PropertySchema.Number({ description: "сумма" })
  amount!: number;
}

@ComponentSchema()
class GoodDto {
  @PropertySchema.String({ decorators: [IsUUID()] })
  id!: string;

  @PropertySchema.String({ minLength: 1 })
  title!: string;

  @PropertySchema.Type({ value: () => PriceDto })
  price!: PriceDto;

  @PropertySchema.Date({ isOptional: true })
  at?: Date;
}

const descriptor: TransferServiceDescriptor = {
  name: "GoodsService",
  origin,
  hash: "abc123",
  methods: [
    {
      name: "save",
      topic: "GoodsService.save",
      waitForResponse: true,
      singleton: false,
      queue: false,
      args: [{ good: { $ref: "#/components/schemas/GoodDto" } }],
      returns: { $ref: "#/components/schemas/GoodDto" },
    },
    {
      name: "resize",
      topic: "GoodsService.resize",
      waitForResponse: true,
      singleton: true,
      queue: true,
      args: [{ id: { type: "string" } }, { tags: { type: "array", items: { type: "string" } } }],
      returns: { type: "number" },
    },
    {
      name: "ping",
      topic: "GoodsService.ping",
      waitForResponse: false,
      singleton: false,
      queue: false,
      args: [],
    },
    {
      name: "poke",
      topic: "GoodsService.poke",
      waitForResponse: false,
      singleton: false,
      queue: false,
    },
  ],
  // args методов остаются JSON Schema (словарь @TopicSchema) — не участвуют в схемах formatа 1
  components: {},
  schemas: foldSchemas([GoodDto]),
};

const config = { transferImport: "@/config/aom/transfer" };

describe("codegen: восстановление сервиса из дескриптора", () => {
  const service = emitService(descriptor, config);
  const schemas = service.files.find((f) => f.path === "schemas.ts")!.source;
  const isolator = service.files.find((f) => f.path === "isolator.ts")!.source;

  it("сервис собирается из schemas.ts и isolator.ts, hash переносится", () => {
    expect(service.name).toBe("GoodsService");
    expect(service.hash).toBe("abc123");
    expect(service.files.map((f) => f.path)).toEqual(["schemas.ts", "isolator.ts"]);
    expect(serviceDirName("GoodsService")).toBe("goods-service");
  });

  it("serviceDirName разбивает аббревиатуру и следующее слово", () => {
    expect(serviceDirName("HTTPService")).toBe("http-service");
  });

  it("DTO: классы с @ComponentSchema/@PropertySchema.*, параметры сохранены без потерь", () => {
    expect(schemas).toContain("@ComponentSchema()\nexport class GoodDto {");
    expect(schemas).toContain("@PropertySchema.String({ minLength: 1 })");
    expect(schemas).toContain("title!: string;");
    // Type-связь — Ref<T> и ленивая ссылка () => X (класс объявлен ниже по файлу)
    expect(schemas).toContain("@PropertySchema.Type({ value: () => PriceDto })");
    expect(schemas).toContain("price!: Ref<PriceDto>;");
    expect(schemas).toContain("type Ref<T> = T;");
    expect(schemas.indexOf("class GoodDto")).toBeLessThan(schemas.indexOf("class PriceDto"));
    // не required (isOptional) → знак вопроса, без required-объявления в схеме
    expect(schemas).toContain("@PropertySchema.Date({ isOptional: true })");
    expect(schemas).toContain("at?: Date;");
    // сквозной параметр компонента переносится как есть
    expect(schemas).toContain('description: "сумма"');
  });

  it("$validator: декоратор class-validator восстанавливается вызовом с импортом", () => {
    expect(schemas).toContain('import { IsUUID } from "class-validator";');
    expect(schemas).toContain("@PropertySchema.String({ decorators: [IsUUID()] })");
    expect(schemas).toContain("id!: string;");
  });

  it("изолятор: исходные декораторы, именованные аргументы, hash-константа", () => {
    expect(isolator).toContain(`import transfer from "@/config/aom/transfer";`);
    expect(isolator).toContain(`import { GoodDto } from "./schemas";`);
    expect(isolator).toContain(`export const GoodsServiceHash = "abc123";`);
    expect(isolator).toContain("@Isolator(transfer)\nexport class GoodsService {");
    expect(isolator).toContain("@TopicSchema({ args: [{ good: GoodDto }], returns: GoodDto })");
    expect(isolator).toContain("static async save(good: GoodDto): Promise<GoodDto> {");
    // singleton → аргумент топика, queue → @IsQueue, [T] → массив и в схеме, и в TS-типе
    expect(isolator).toContain("@ResponseTopic(true)");
    expect(isolator).toContain("@IsQueue()");
    expect(isolator).toContain(`args: [{ id: "string" }, { tags: ["string"] }], returns: "number"`);
    expect(isolator).toContain(
      "static async resize(id: string, tags: string[]): Promise<number> {",
    );
    // распределённость (@Isolator(transfer, { distributed: true })) в сгенерированный код не переносится
    expect(isolator).not.toContain("distributed");
  });

  it("три состояния метода: явное «без аргументов», неописанный — честная заглушка", () => {
    expect(isolator).toContain("@TopicSchema({})\n  static async ping(): Promise<void> {");
    expect(isolator).toContain("static async poke(...args: unknown[]): Promise<void> {");
  });

  it("сервис без компонент обходится без schemas.ts и импорта", () => {
    const bare = emitService(
      { ...descriptor, methods: [descriptor.methods[3]], components: {}, schemas: foldSchemas([]) },
      config,
    );
    expect(bare.files.map((f) => f.path)).toEqual(["isolator.ts"]);
    expect(bare.files[0].source).not.toContain("./schemas");
  });
});

describe("codegen: emitSchemas — enum, extends, mapped-types", () => {
  it("enum: export enum восстанавливается со значениями, TS-тип свойства — имя enum", () => {
    enum StatusEnum {
      Active = "active",
      Blocked = "blocked",
    }
    @ComponentSchema()
    class EnumDto {
      @PropertySchema.Enum({ value: StatusEnum, enumName: "StatusEnum" })
      status!: StatusEnum;
    }

    const code = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([EnumDto]),
    })!;

    expect(code).toContain(
      'export enum StatusEnum {\n  Active = "active",\n  Blocked = "blocked",\n}',
    );
    expect(code).toContain('@PropertySchema.Enum({ value: StatusEnum, enumName: "StatusEnum" })');
    expect(code).toContain("status!: StatusEnum;");
    // enum объявлен раньше классов
    expect(code.indexOf("export enum StatusEnum")).toBeLessThan(code.indexOf("class EnumDto"));
  });

  it("extends: топологический порядок — родитель раньше потомка, даже если имя после по алфавиту", () => {
    @ComponentSchema()
    class ZParent {
      @PropertySchema.String({})
      base!: string;
    }
    @ComponentSchema()
    class AChild extends ZParent {
      @PropertySchema.Number({})
      extra!: number;
    }

    const code = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([AChild]),
    })!;

    expect(code).toContain("export class AChild extends ZParent {");
    expect(code.indexOf("class ZParent")).toBeLessThan(code.indexOf("class AChild"));
  });

  it("mapped Pick: PickType(Base, keys), унаследованное свойство не дублируется среди своих", () => {
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

    const code = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([PickChild]),
    })!;

    expect(code).toContain(
      'import { ComponentSchema, PropertySchema, PickType } from "@aom-js/schemer";',
    );
    expect(code).toContain('export class PickChild extends PickType(PickBase, ["name"]) {');
    expect(code).toContain("flag!: boolean;");
    // "name" — своё свойство PickBase, у PickChild оно унаследовано и не должно печататься повторно
    expect(code.match(/name!: string;/g)).toHaveLength(1);
    expect(code.indexOf("class PickBase")).toBeLessThan(code.indexOf("class PickChild"));
  });

  it("mapped Intersection(A, Partial(B)): разворачивается рекурсивно, оба источника — раньше потомка", () => {
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

    const code = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([NestedChild]),
    })!;

    expect(code).toContain(
      'import { ComponentSchema, PropertySchema, IntersectionType, PartialType } from "@aom-js/schemer";',
    );
    expect(code).toContain(
      "export class NestedChild extends IntersectionType(NestA, PartialType(NestB)) {}",
    );
    expect(code.indexOf("class NestA")).toBeLessThan(code.indexOf("class NestedChild"));
    expect(code.indexOf("class NestB")).toBeLessThan(code.indexOf("class NestedChild"));
  });

  it("params компонента (@ComponentSchema({description, deprecated})) восстанавливаются как есть", () => {
    @ComponentSchema({ description: "Описание", deprecated: true })
    class DescribedDto {
      @PropertySchema.String({})
      v!: string;
    }

    const code = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([DescribedDto]),
    })!;

    expect(code).toContain('@ComponentSchema({ description: "Описание", deprecated: true })');
  });

  it("$validator с аргументами и $regexp: несколько декораторов на свойстве, импорт отсортирован", () => {
    @ComponentSchema()
    class ValidatedDto {
      @PropertySchema.String({ decorators: [Length(2, 5), Matches(/^a/i)] })
      code!: string;
    }

    const codeFile = emitSchemas({
      name: "S",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: foldSchemas([ValidatedDto]),
    })!;

    expect(codeFile).toContain('import { Length, Matches } from "class-validator";');
    expect(codeFile).toContain('decorators: [Length(2, 5), Matches(new RegExp("^a", "i"))]');
  });
});

describe("codegen: emitSchemas — nullable, числовой enum, цикл Type", () => {
  it('nullable → "| null" в TS-типе поля', () => {
    @ComponentSchema()
    class NullableDto {
      @PropertySchema.String({ nullable: true, isOptional: true })
      note?: string;
    }

    const code = emitSchemas(forgedDescriptor(foldSchemas([NullableDto])))!;
    expect(code).toContain("note?: string | null;");
  });

  it("числовой enum: сгенерированный export enum задаёт те же значения — TS сам достроит обратные ключи", () => {
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

    const code = emitSchemas(forgedDescriptor(foldSchemas([NumericEnumDto])))!;
    expect(code).toContain("export enum LevelEnum {\n  Low = 0,\n  Mid = 1,\n  High = 2,\n}");
    expect(code).toContain("level!: LevelEnum;");
  });

  it("цикл Type A↔B: обе стороны — Ref<> и ленивая ссылка () => X, независимо от порядка объявления", () => {
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

    const code = emitSchemas(forgedDescriptor(foldSchemas([CycleA])))!;
    expect(code).toContain("@PropertySchema.Type({ value: () => CycleB })");
    expect(code).toContain("b!: Ref<CycleB>;");
    expect(code).toContain("@PropertySchema.Type({ value: () => CycleA })");
    expect(code).toContain("a!: Ref<CycleA>;");
    // алиас объявляется один раз, независимо от числа Type-свойств
    expect(code.match(/type Ref<T> = T;/g)).toHaveLength(1);
  });
});

describe("codegen: emitSchemas — ошибки формата", () => {
  it("нет schemas при непустых components — дескриптор до формата 1", () => {
    const legacy: TransferServiceDescriptor = {
      name: "Legacy",
      origin,
      hash: "h",
      methods: [],
      components: { Foo: { type: "object", properties: {} } },
    };
    expect(() => emitSchemas(legacy)).toThrow(/пересоберите collect/);
  });

  it("нет schemas и нет components — сервис без DTO, не ошибка", () => {
    const bare: TransferServiceDescriptor = {
      name: "Bare",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    expect(emitSchemas(bare)).toBeUndefined();
  });

  it("неизвестный format — ошибка", () => {
    const badFormat: TransferServiceDescriptor = {
      name: "Bad",
      origin,
      hash: "h",
      methods: [],
      components: {},
      schemas: { format: 2 as 1, components: {}, enums: {} } as FoldedSchemas,
    };
    expect(() => emitSchemas(badFormat)).toThrow(/формат/);
  });
});

// Дескриптор приходит с общей шины — недоверенные данные. То, что становится identifier'ом
// сгенерированного кода (имя класса/enum/функции/параметра), проверяется строго: иначе не имя,
// а произвольный код. То, что может остаться строкой/ключом (свойство, ключ enum), либо
// экранируется через JSON.stringify/квотирование, либо тоже проверяется (значение enum, $validator).
describe("codegen: граница «данные шины → код» — недоверенные данные не становятся кодом", () => {
  it("имя компонента с недопустимыми символами — ошибка", () => {
    const schemas = {
      format: 1,
      components: { "Evil() {} //": { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/имя компонента/);
  });

  it("имя enum с недопустимыми символами — ошибка", () => {
    const schemas = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: { "Evil//": { A: "a" } },
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/имя enum/);
  });

  it("extends не identifier — ошибка", () => {
    const schemas = {
      format: 1,
      components: { Foo: { extends: "Evil(); //", properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/родитель extends/);
  });

  it("цель $ref не identifier — ошибка", () => {
    const schemas = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: { factory: SchemaTypes.TYPE, params: { value: { $ref: "Evil(); //" } } },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/\$ref/);
  });

  it("цель $enum не identifier — ошибка", () => {
    const schemas = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: { factory: SchemaTypes.ENUM, params: { value: { $enum: "Evil(); //" } } },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/\$enum/);
  });

  it("неизвестная фабрика свойства (не ключ PropertySchema) — ошибка", () => {
    const schemas = {
      format: 1,
      components: { Foo: { properties: { p: { factory: "eval", params: {} } } } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/фабрика/);
  });

  it("$validator с исполняемым кодом вместо имени — ошибка", () => {
    const schemas = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "IsUUID); process.exit(1); //", args: [] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/class-validator/);
  });

  it("$validator — синтаксически identifier, но не реальный экспорт class-validator — ошибка", () => {
    const schemas = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "NotARealValidator", args: [] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/class-validator/);
  });

  it("$validator — реальный, но не декораторный экспорт class-validator — ошибка (не белый список)", () => {
    // useContainer/validateSync — настоящие функции class-validator, но не фабрики декораторов
    // свойств: свёртка их никогда не кладёт в $validator; вызов при импорте класса подменил бы
    // глобальный контейнер/поведение у потребителя
    const evilUseContainer = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "useContainer", args: [{}] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(evilUseContainer))).toThrow(/class-validator/);

    const evilValidateSync = {
      format: 1,
      components: {
        Foo: {
          properties: {
            p: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "validateSync", args: [] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(evilValidateSync))).toThrow(/class-validator/);
  });

  it("$validator — настоящие фабрики декораторов (IsUUID, Length) проходят белый список", () => {
    const schemas = {
      format: 1,
      components: {
        Foo: {
          properties: {
            id: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "IsUUID", args: [] }] },
            },
            code: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "Length", args: [2, 5] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    const code = emitSchemas(forgedDescriptor(schemas))!;
    expect(code).toContain('import { IsUUID, Length } from "class-validator";');
    expect(code).toContain("decorators: [IsUUID()]");
    expect(code).toContain("decorators: [Length(2, 5)]");
  });

  it("значение enum — не строка и не число (подделанный массив) — ошибка", () => {
    const schemas = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: { E: { A: ["process.exit(1)"] } },
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(schemas))).toThrow(/недопустимое значение enum/);
  });

  it("имя сервиса не identifier — ошибка у emitSchemas и у emitService (isolator.ts)", () => {
    const schemas = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    const evil = { ...forgedDescriptor(schemas), name: "Evil(); //" };
    expect(() => emitSchemas(evil)).toThrow(/имя сервиса/);
    expect(() => emitService(evil, config)).toThrow(/имя сервиса/);
  });

  it("имя метода не identifier — ошибка", () => {
    const evil: TransferServiceDescriptor = {
      name: "S",
      origin,
      hash: "h",
      methods: [
        { name: "evil(); //", topic: "t", waitForResponse: false, singleton: false, queue: false },
      ],
      components: {},
    };
    expect(() => emitService(evil, config)).toThrow(/имя метода/);
  });

  it("имя аргумента метода не identifier — ошибка (это ещё и имя параметра функции)", () => {
    const evil: TransferServiceDescriptor = {
      name: "S",
      origin,
      hash: "h",
      methods: [
        {
          name: "save",
          topic: "t",
          waitForResponse: true,
          singleton: false,
          queue: false,
          args: [{ "id); process.exit(1); //": { type: "string" } }],
        },
      ],
      components: {},
    };
    expect(() => emitService(evil, config)).toThrow(/имя аргумента/);
  });

  it("$ref в JSON Schema аргумента изолятора не identifier — ошибка", () => {
    const evil: TransferServiceDescriptor = {
      name: "S",
      origin,
      hash: "h",
      methods: [
        {
          name: "save",
          topic: "t",
          waitForResponse: true,
          singleton: false,
          queue: false,
          args: [{ good: { $ref: "#/components/schemas/Evil(); //" } }],
        },
      ],
      components: {},
    };
    expect(() => emitService(evil, config)).toThrow(/\$ref/);
  });

  it("serviceDirName: выход за пределы каталога или пустое имя — ошибка", () => {
    expect(() => serviceDirName("../../evil")).toThrow(/каталог/);
    expect(() => serviceDirName("")).toThrow(/каталог/);
  });

  it("origin с переводом строки не обрывает комментарий раньше срока", () => {
    const evil: TransferServiceDescriptor = {
      name: "S",
      origin: { instanceName: "evil\nexport const PWNED = true;", instanceKey: "k" },
      hash: "h",
      methods: [],
      components: {},
    };
    const code = emitService(evil, config).files[0].source;
    expect(code).toContain("// origin: evil export const PWNED = true;/k");
    expect(code).not.toContain("\nexport const PWNED = true;\n");
  });

  it("допустимое, но «неудобное» имя свойства — безопасно экранируется и импортируется без побочных эффектов", async () => {
    const maliciousKey = "a'); (globalThis as Record<string, unknown>).__pwned = true; //";
    const schemas: FoldedSchemas = {
      format: 1,
      components: {
        WeirdDto: { properties: { [maliciousKey]: { factory: SchemaTypes.STRING, params: {} } } },
      },
      enums: {},
    };

    const code = emitSchemas(forgedDescriptor(schemas))!;
    // весь платёж — внутри одного строкового литерала (имени свойства), а не отдельным кодом
    expect(code).toContain(`  ${JSON.stringify(maliciousKey)}!: string;`);

    const dir = path.join(TEST_DIR, "__generated__", "security-check");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "schemas.ts"), code);

    const mod = (await import(pathToFileURL(path.join(dir, "schemas.ts")).href)) as Record<
      string,
      unknown
    >;
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(typeof mod.WeirdDto).toBe("function");
    const instance = new (mod.WeirdDto as new () => object)();
    expect(Object.getOwnPropertyNames(instance)).toContain(maliciousKey);
  });

  it("$regexp — форма, флаги и компилируемость проверяются на генерации, а не у потребителя", () => {
    const withBadShape = {
      format: 1,
      components: {
        Foo: {
          properties: {
            code: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "Matches", args: [{ $regexp: 42 }] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(withBadShape))).toThrow(/\$regexp/);

    const withBadFlags = {
      format: 1,
      components: {
        Foo: {
          properties: {
            code: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "Matches", args: [{ $regexp: ["a", "z"] }] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(withBadFlags))).toThrow(/флаги/);

    const withDuplicateFlags = {
      format: 1,
      components: {
        Foo: {
          properties: {
            code: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "Matches", args: [{ $regexp: ["a", "gg"] }] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(withDuplicateFlags))).toThrow(/флаги/);

    const withUncompilable = {
      format: 1,
      components: {
        Foo: {
          properties: {
            code: {
              factory: SchemaTypes.STRING,
              params: { decorators: [{ $validator: "Matches", args: [{ $regexp: ["(", "g"] }] }] },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(withUncompilable))).toThrow(/невалидный regexp/);
  });

  it("ключ __proto__ у параметров фабрики — собственное свойство, цепочка прототипов не меняется", async () => {
    // дескриптор реально приходит как JSON с шины: JSON.parse (в отличие от object-литерала
    // "{ __proto__: ... }" в исходнике теста) кладёт "__proto__" как обычное собственное
    // свойство — так и выглядят настоящие подделанные данные на входе emitSchemas
    const params = JSON.parse('{"__proto__":{"isOptional":true}}');
    const schemas: FoldedSchemas = {
      format: 1,
      components: {
        ProtoDto: {
          properties: {
            value: { factory: SchemaTypes.STRING, params },
          },
        },
      },
      enums: {},
    };

    const code = emitSchemas(forgedDescriptor(schemas))!;
    expect(code).toContain('["__proto__"]: { isOptional: true }');
    // "не литеральный __proto__:" в самом вызове декоратора — иначе это не собственное свойство,
    // а смена [[Prototype]] у объекта-аргумента (params.isOptional подхватился бы через цепочку)
    expect(code).not.toMatch(/@PropertySchema\.String\(\{\s*__proto__:/);

    const dir = path.join(TEST_DIR, "__generated__", "proto-check");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const objectLiteral = code.match(/@PropertySchema\.String\((\{.*\})\)/)![1];
    fs.writeFileSync(path.join(dir, "params.mjs"), `export const params = ${objectLiteral};\n`);

    const mod = (await import(pathToFileURL(path.join(dir, "params.mjs")).href)) as {
      params: Record<string, unknown>;
    };
    expect(Object.getPrototypeOf(mod.params)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(mod.params, "__proto__")).toBe(true);
    // не долетело как значение через прототип — только как собственное свойство "__proto__"
    expect(mod.params.isOptional).toBeUndefined();
  });

  it("planGeneration: коллизия каталога (Foo/foo → foo) — ошибка с обоими именами, ничего не пишем", () => {
    const good = (name: string): TransferServiceDescriptor => ({
      name,
      origin,
      hash: "h",
      methods: [],
      components: {},
    });
    const { succeeded, errors } = planGeneration([good("Foo"), good("foo")], config);
    expect(succeeded).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Foo");
    expect(errors[0]).toContain("foo");
  });

  it("planGeneration: один сломанный дескриптор не блокирует генерацию остальных", () => {
    const good: TransferServiceDescriptor = {
      name: "Good",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    const bad: TransferServiceDescriptor = {
      name: "Evil(); //",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    const { succeeded, errors } = planGeneration([good, bad], config);
    expect(succeeded.map((s) => s.service.name)).toEqual(["Good"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Evil(); //");
  });

  it("HIGH: сквозной сценарий аудитора — 'Date extends Function' + $date не доходит до new Date(...)", () => {
    // компонент буквально называется "Date" и наследует "Function": у потребителя это стало бы
    // "export class Date extends Function {}", а new Date(source) — вызовом конструктора Function
    // с телом из строки; HIGH-b отклоняет имя "Date" раньше, чем extends/$date вообще разбираются
    const evil = {
      format: 1,
      components: {
        Date: {
          extends: "Function",
          properties: {
            v: {
              factory: SchemaTypes.STRING,
              params: { x: { $date: "return process.exit(1)" } },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    // бросает на генерации — значит "new Date(...)" в вывод в принципе попасть не может:
    // emitSchemas либо вернул исходник целиком, либо не вернул ничего
    expect(() => emitSchemas(forgedDescriptor(evil))).toThrow(/codegen:/);
  });

  it("HIGH-a: extends/$ref/$enum обязаны указывать на компонент/enum ЭТОГО дескриптора", () => {
    const extendsUnknown = {
      format: 1,
      components: { Evil: { extends: "Function", properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(extendsUnknown))).toThrow(/родитель extends/);

    const refUnknown = {
      format: 1,
      components: {
        Evil: {
          properties: { v: { factory: SchemaTypes.TYPE, params: { value: { $ref: "Function" } } } },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(refUnknown))).toThrow(/\$ref/);

    const enumUnknown = {
      format: 1,
      components: {
        Evil: {
          properties: { v: { factory: SchemaTypes.ENUM, params: { value: { $enum: "Ghost" } } } },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(enumUnknown))).toThrow(/\$enum/);
  });

  it("HIGH-a (изолятор): $ref аргумента/ответа тоже обязан быть компонентом дескриптора", () => {
    const evil: TransferServiceDescriptor = {
      name: "S",
      origin,
      hash: "h",
      methods: [
        {
          name: "save",
          topic: "t",
          waitForResponse: true,
          singleton: false,
          queue: false,
          args: [{ good: { $ref: "#/components/schemas/Function" } }],
        },
      ],
      components: {},
    };
    expect(() => emitService(evil, config)).toThrow(/не найдена среди компонентов/);
  });

  it("HIGH-b: имя компонента/enum не может совпадать с глобальным/зарезервированным/своим импортом", () => {
    const asGlobal = {
      format: 1,
      components: { Date: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(asGlobal))).toThrow(/имя компонента/);

    const asReserved = {
      format: 1,
      components: { class: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(asReserved))).toThrow(/имя компонента/);

    const asOwnImport = {
      format: 1,
      components: { Ref: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(asOwnImport))).toThrow(/имя компонента/);

    const asValidator = {
      format: 1,
      components: { IsUUID: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(asValidator))).toThrow(/имя компонента/);

    const enumAsGlobal = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: { Object: { A: 1 } },
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(enumAsGlobal))).toThrow(/имя enum/);
  });

  it("HIGH-c: $date принимает только строку, реально парсящуюся как дата", () => {
    const notAString = {
      format: 1,
      components: {
        Foo: {
          properties: { v: { factory: SchemaTypes.STRING, params: { x: { $date: 12345 } } } },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(notAString))).toThrow(/\$date/);

    const garbage = {
      format: 1,
      components: {
        Foo: {
          properties: {
            v: {
              factory: SchemaTypes.STRING,
              params: { x: { $date: "return process.exit(1)" } },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(garbage))).toThrow(/\$date/);

    const valid = {
      format: 1,
      components: {
        Foo: {
          properties: {
            v: {
              factory: SchemaTypes.STRING,
              params: { x: { $date: "2024-01-01T00:00:00.000Z" } },
            },
          },
        },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(emitSchemas(forgedDescriptor(valid))).toContain('new Date("2024-01-01T00:00:00.000Z")');
  });

  it("LOW: свойство 'constructor' и enum-ключ '__proto__' отклоняются на генерации", () => {
    const ctorProp = {
      format: 1,
      components: {
        Foo: { properties: { constructor: { factory: SchemaTypes.STRING, params: {} } } },
      },
      enums: {},
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(ctorProp))).toThrow(/constructor/);

    // "__proto__" как ключ enum'а компилируется через присваивание — сеттер Object.prototype.
    // __proto__ для примитивного значения молча ничего не делает, член enum'а просто теряется
    const protoEnumKey = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: { E: JSON.parse('{"__proto__":1}') },
    } as unknown as FoldedSchemas;
    expect(() => emitSchemas(forgedDescriptor(protoEnumKey))).toThrow(/__proto__/);
  });

  it("LOW: имена методов изолятора name/length/prototype/constructor/caller/arguments отклоняются", () => {
    ["name", "length", "prototype", "constructor", "caller", "arguments"].forEach((methodName) => {
      const evil: TransferServiceDescriptor = {
        name: "S",
        origin,
        hash: "h",
        methods: [
          { name: methodName, topic: "t", waitForResponse: false, singleton: false, queue: false },
        ],
        components: {},
      };
      expect(() => emitService(evil, config)).toThrow(/имя метода/);
    });
  });

  it("planGeneration: null-запись в снапшоте не роняет обработку остальных, имена в ошибках экранированы", () => {
    const good: TransferServiceDescriptor = {
      name: "Good",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    const withNewline: TransferServiceDescriptor = {
      name: 'evil"\nfake-log-line',
      origin,
      hash: "h",
      methods: [
        { name: "constructor", topic: "t", waitForResponse: false, singleton: false, queue: false },
      ],
      components: {},
    };
    const { succeeded, errors } = planGeneration(
      [good, null as unknown as TransferServiceDescriptor, withNewline],
      config,
    );
    expect(succeeded.map((s) => s.service.name)).toEqual(["Good"]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(JSON.stringify(null));
    expect(errors[1]).toContain(JSON.stringify(withNewline.name));
    // перевод строки внутри имени не вырвался наружу и не подделал вторую строку лога
    expect(errors[1]).not.toContain("\n");
  });

  it("LOW: имя сервиса не может совпадать с тем, что импортирует/объявляет сам isolator.ts", () => {
    // "Isolator" — рядом со сгенерированным "import { Isolator } from ...": redeclare
    const asDecorator: TransferServiceDescriptor = {
      name: "Isolator",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    expect(() => emitService(asDecorator, config)).toThrow(/имя сервиса/);

    // "transfer" — имя локальной переменной, которую генератор объявляет сам
    const asTransfer: TransferServiceDescriptor = {
      name: "transfer",
      origin,
      hash: "h",
      methods: [],
      components: {},
    };
    expect(() => emitService(asTransfer, config)).toThrow(/имя сервиса/);

    // то же имя не должно проходить и через emitSchemas — не только через emitIsolator
    const schemas = {
      format: 1,
      components: { Foo: { properties: {} } },
      enums: {},
    } as unknown as FoldedSchemas;
    const asGlobalService = { ...forgedDescriptor(schemas), name: "Promise" };
    expect(() => emitSchemas(asGlobalService)).toThrow(/имя сервиса/);
  });

  it("LOW: имя сервиса, дающее '<имя>Hash' == имени импортируемого компонента — ошибка (redeclare)", () => {
    @ComponentSchema()
    class FooHash {
      @PropertySchema.String({})
      v!: string;
    }

    const evil: TransferServiceDescriptor = {
      name: "Foo",
      origin,
      hash: "h",
      methods: [
        {
          name: "save",
          topic: "t",
          waitForResponse: true,
          singleton: false,
          queue: false,
          args: [{ good: { $ref: "#/components/schemas/FooHash" } }],
        },
      ],
      components: {},
      schemas: foldSchemas([FooHash]),
    };
    expect(() => emitService(evil, config)).toThrow(/FooHash/);
  });
});

describe("codegen: check — сверка снапшота с manifest", () => {
  const descriptorOf = (name: string, hash: string): TransferServiceDescriptor => ({
    name,
    hash,
    origin,
    methods: [],
    components: {},
  });

  it("дрейф: hash в снапшоте разошёлся с manifest", () => {
    const result = diffManifest([descriptorOf("A", "new")], { A: "old" });
    expect(result.drifted.map((d) => d.name)).toEqual(["A"]);
    expect(result.missing).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("не сгенерирован: сервис есть в снапшоте, но не в manifest", () => {
    const result = diffManifest([descriptorOf("A", "x")], {});
    expect(result.missing.map((d) => d.name)).toEqual(["A"]);
  });

  it("удалён: сервис есть в manifest, но пропал из снапшота", () => {
    const result = diffManifest([], { Gone: "x" });
    expect(result.removed).toEqual(["Gone"]);
  });

  it("совпадение — все списки пустые", () => {
    const result = diffManifest([descriptorOf("A", "x")], { A: "x" });
    expect(result).toEqual({ drifted: [], missing: [], removed: [] });
  });
});
