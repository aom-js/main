import { describe, it, expect } from "vitest";
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
  @TopicSchema({ args: [GoodDto], returns: GoodDto })
  static async save(good: GoodDto): Promise<GoodDto> {
    return undefined as never;
  }

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
      args: [{ $ref: "#/components/schemas/GoodDto" }],
      returns: { $ref: "#/components/schemas/GoodDto" },
    });

    const poke = descriptor.methods.find((m) => m.name === "poke")!;
    expect(poke).toMatchObject({ topic: "GoodsService.poke", waitForResponse: false, args: [] });
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
