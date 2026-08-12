import { describe, it, expect, vi } from "vitest";
import {
  Transfer, Isolator, ResponseTopic, CustomTopic, IsDistributed, TopicSchema,
} from "@aom-js/transfer";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const node = new Transfer({
  instanceName: "desc-node",
  instanceKey: "d1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

@ComponentSchema()
class PriceDto {
  @PropertySchema.Number({})
  amount!: number;
}

@ComponentSchema()
class GoodDto {
  @PropertySchema.String({})
  title!: string;

  @PropertySchema.Type({ value: () => PriceDto })
  price!: PriceDto;
}

@Isolator(node)
@IsDistributed()
class GoodsService {
  @ResponseTopic()
  @TopicSchema({ args: [{ good: GoodDto }], returns: GoodDto })
  static async save(good: GoodDto): Promise<GoodDto> {
    return undefined as never;
  }

  // именованные аргументы: скаляры строками, [T] — массив
  @ResponseTopic()
  @TopicSchema({
    args: [{ id: "string" }, { maxWidth: "number" }, { tags: ["string"] }],
    returns: "number",
  })
  static async resize(_id: string, _maxWidth: number, _tags: string[]): Promise<number> {
    return undefined as never;
  }

  // явное «аргументов нет»
  @CustomTopic()
  @TopicSchema({})
  static async ping(): Promise<void> {}

  // сознательно не описан — в дескрипторе не будет поля args
  @CustomTopic()
  static async poke(): Promise<unknown> {
    return undefined;
  }
}

describe("transfer: дескриптор сервиса", () => {
  it("IsDistributed кладёт в реестр дескриптор с методами, топиками и происхождением", () => {
    const descriptor = node.registryMap.get("GoodsService")!;
    expect(descriptor).toMatchObject({
      name: "GoodsService",
      origin: { instanceName: "desc-node", instanceKey: "d1" },
    });
    expect(descriptor.hash).toMatch(/^[a-f0-9]{64}$/);

    const save = descriptor.methods.find((m) => m.name === "save")!;
    expect(save).toMatchObject({
      topic: "GoodsService.save",
      waitForResponse: true,
      singleton: false,
      queue: false,
      args: [{ good: { $ref: "#/components/schemas/GoodDto" } }],
      returns: { $ref: "#/components/schemas/GoodDto" },
    });

    const poke = descriptor.methods.find((m) => m.name === "poke")!;
    expect(poke).toMatchObject({ topic: "GoodsService.poke", waitForResponse: false });
  });

  it("именованные аргументы: [{ имя: схема }], скаляры строками, [T] — массив", () => {
    const descriptor = node.registryMap.get("GoodsService")!;
    const resize = descriptor.methods.find((m) => m.name === "resize")!;
    expect(resize.args).toEqual([
      { id: { type: "string" } },
      { maxWidth: { type: "number" } },
      { tags: { type: "array", items: { type: "string" } } },
    ]);
    expect(resize.returns).toEqual({ type: "number" });
  });

  it("валидация @TopicSchema: дубли имён, чужие классы, неизвестные скаляры, кратные пары", () => {
    expect(() => {
      @Isolator(node)
      class BadDup {
        @ResponseTopic()
        @TopicSchema({ args: [{ id: "string" }, { id: "number" }] })
        static async m(_a: string, _b: number): Promise<void> {}
      }
      void BadDup;
    }).toThrow(/duplicate argument name "id"/);

    class Naked {}
    expect(() => {
      @Isolator(node)
      class BadClass {
        @ResponseTopic()
        @TopicSchema({ args: [{ item: Naked }] })
        static async m(_item: unknown): Promise<void> {}
      }
      void BadClass;
    }).toThrow(/"Naked" is not a @ComponentSchema-decorated class/);

    expect(() => {
      @Isolator(node)
      class BadScalar {
        @ResponseTopic()
        @TopicSchema({ args: [{ id: "strng" }] })
        static async m(_id: string): Promise<void> {}
      }
      void BadScalar;
    }).toThrow(/unknown scalar type "strng"/);

    expect(() => {
      @Isolator(node)
      class BadPair {
        @ResponseTopic()
        @TopicSchema({ args: [{ a: "string", b: "number" }] })
        static async m(_a: string, _b: number): Promise<void> {}
      }
      void BadPair;
    }).toThrow(/exactly one \{ name: type \} pair/);

    expect(() => {
      @Isolator(node)
      class BadArray {
        @ResponseTopic()
        @TopicSchema({ args: [{ tags: [] as never }] })
        static async m(_tags: string[]): Promise<void> {}
      }
      void BadArray;
    }).toThrow(/exactly one element type/);
  });

  it("«аргументов нет» и «не описан» различимы: args [] против отсутствия поля", () => {
    const descriptor = node.registryMap.get("GoodsService")!;
    const ping = descriptor.methods.find((m) => m.name === "ping")!;
    expect(ping.args).toEqual([]);
    const poke = descriptor.methods.find((m) => m.name === "poke")!;
    expect(poke.args).toBeUndefined();
    expect("args" in poke).toBe(false);
  });

  it("метод без @TopicSchema в распределенном классе даёт предупреждение", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      @Isolator(node)
      @IsDistributed()
      class WarnService {
        @CustomTopic()
        static async mystery(payload: unknown): Promise<void> {
          void payload;
        }
      }
      void WarnService;
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("WarnService.mystery"));
      expect(node.registryMap.get("WarnService")!.methods[0].args).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("каскад связей попадает в components", () => {
    const descriptor = node.registryMap.get("GoodsService")!;
    expect(Object.keys(descriptor.components)).toEqual(
      expect.arrayContaining(["GoodDto", "PriceDto"]),
    );
  });

  it("дескриптор переживает JSON-сериализацию без потерь", () => {
    const descriptor = node.registryMap.get("GoodsService")!;
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  it("реестр уезжает по шине запрос-ответом в сериализуемом виде", async () => {
    const nodeB = new Transfer({
      instanceName: "desc-b",
      instanceKey: "b1",
      publisher: bus.publisher,
      subscriber: bus.subscriber,
    });
    const received: any[] = [];
    nodeB.collectDistributions((data) => received.push(data));
    await tick(10);
    const schemas = received[0].value;
    expect(Array.isArray(schemas)).toBe(true);
    expect(schemas.find((d: any) => d.name === "GoodsService")).toMatchObject({
      name: "GoodsService",
      origin: { instanceName: "desc-node" },
    });
  });
});
