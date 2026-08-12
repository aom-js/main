import { describe, it, expect } from "vitest";
import { emitService, serviceDirName, TransferServiceDescriptor } from "@aom-js/codegen";

const descriptor: TransferServiceDescriptor = {
  name: "GoodsService",
  origin: { instanceName: "orders", instanceKey: "k1" },
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
      args: [
        { id: { type: "string" } },
        { tags: { type: "array", items: { type: "string" } } },
      ],
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
  components: {
    GoodDto: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        price: { $ref: "#/components/schemas/PriceDto" },
        at: { type: "string", format: "date-time" },
      },
      required: ["title", "price"],
    },
    PriceDto: {
      type: "object",
      properties: { amount: { type: "number", description: "сумма" } },
      required: ["amount"],
    },
  },
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

  it("DTO: классы с @ComponentSchema/@PropertySchema, связи через Type, потери отмечены", () => {
    expect(schemas).toContain("@ComponentSchema()\nexport class GoodDto {");
    expect(schemas).toContain("@PropertySchema.String({})");
    expect(schemas).toContain("title!: string;");
    expect(schemas).toContain("@PropertySchema.Type({ value: () => PriceDto })");
    expect(schemas).toContain("price!: PriceDto;");
    // не required → isOptional и знак вопроса; date-time → Date
    expect(schemas).toContain("@PropertySchema.Date({ isOptional: true })");
    expect(schemas).toContain("at?: Date;");
    // сквозные параметры переносятся, непереносимое отмечается
    expect(schemas).toContain(`description: "сумма"`);
    expect(schemas).toContain("TODO(codegen): не перенесено: minLength");
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
    expect(isolator).toContain("static async resize(id: string, tags: string[]): Promise<number> {");
    // @IsDistributed в сгенерированный код не переносится
    expect(isolator).not.toContain("IsDistributed");
  });

  it("три состояния метода: явное «без аргументов», неописанный — честная заглушка", () => {
    expect(isolator).toContain("@TopicSchema({})\n  static async ping(): Promise<void> {");
    expect(isolator).toContain("static async poke(...args: unknown[]): Promise<void> {");
  });

  it("сервис без компонент обходится без schemas.ts и импорта", () => {
    const bare = emitService(
      { ...descriptor, methods: [descriptor.methods[3]], components: {} },
      config,
    );
    expect(bare.files.map((f) => f.path)).toEqual(["isolator.ts"]);
    expect(bare.files[0].source).not.toContain("./schemas");
  });
});
