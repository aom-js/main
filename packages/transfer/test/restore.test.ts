import { describe, it, expect } from "vitest";
import {
  Transfer, Isolator, ResponseTopic, Executor, TopicSchema,
  TransferServiceDescriptor,
} from "@aom-js/transfer";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const nodeA = new Transfer({
  instanceName: "restore-a",
  instanceKey: "ra",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});
const nodeB = new Transfer({
  instanceName: "restore-b",
  instanceKey: "rb",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

@ComponentSchema()
class PairDto {
  @PropertySchema.Number({})
  a!: number;

  @PropertySchema.Number({})
  b!: number;
}

@Isolator(nodeA, { distributed: true })
class CalcService {
  @ResponseTopic()
  @TopicSchema({ args: [{ pair: PairDto }], returns: "number" })
  static async mul(pair: PairDto): Promise<number> {
    return undefined as never;
  }

  @ResponseTopic()
  @TopicSchema({})
  static async fail(): Promise<void> {
    return undefined as never;
  }
}

@Executor()
class CalcExecutor extends CalcService {
  static async mul(pair: PairDto) {
    return pair.a * pair.b;
  }

  static async fail(): Promise<void> {
    throw Object.assign(new Error("no luck"), { status: 500 });
  }
}

describe("transfer: восстановление клиента из дескриптора", () => {
  // дескриптор получаем так, как его получит реальный узел — по шине
  async function fetchDescriptor(): Promise<TransferServiceDescriptor> {
    const received: any[] = [];
    nodeB.collectDistributions((data) => received.push(data));
    await tick(10);
    return received[0].value.find((d: TransferServiceDescriptor) => d.name === "CalcService");
  }

  it("восстановленный прокси вызывает удалённый метод и получает результат", async () => {
    const descriptor = await fetchDescriptor();
    const client = nodeB.restore(descriptor);
    await expect(client.mul({ a: 3, b: 4 })).resolves.toBe(12);
  });

  it("ошибка удалённого метода доходит через восстановленный прокси", async () => {
    const descriptor = await fetchDescriptor();
    const client = nodeB.restore(descriptor);
    await expect(client.fail()).rejects.toMatchObject({ message: "no luck", status: 500 });
  });

  it("повторный restore того же дескриптора возвращает тот же клиент", async () => {
    const descriptor = await fetchDescriptor();
    expect(nodeB.restore(descriptor)).toBe(nodeB.restore(descriptor));
  });
});
