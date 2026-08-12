import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, IsDistributed, TopicSchema } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const portA = bus.port("A");
const portB = bus.port("B");
const portC = bus.port("C");

const nodeA = new Transfer({
  instanceName: "cache-a", instanceKey: "ca",
  publisher: portA.publisher, subscriber: portA.subscriber,
});
const nodeB = new Transfer({
  instanceName: "cache-b", instanceKey: "cb",
  publisher: portB.publisher, subscriber: portB.subscriber,
});
const nodeC = new Transfer({
  instanceName: "cache-c", instanceKey: "cc",
  publisher: portC.publisher, subscriber: portC.subscriber,
});

@Isolator(nodeA)
@IsDistributed()
class CachedService {
  @ResponseTopic()
  @TopicSchema({ returns: "string" })
  static async ping(): Promise<string> {
    return undefined as never;
  }
}

describe("transfer: кэш реестра (условно-независимая система)", () => {
  it("узел сохраняет чужие дескрипторы и раздаёт их, когда источник погашен", async () => {
    void CachedService;
    // B опрашивает реестр — и кэширует дескриптор A
    nodeB.collectDistributions(() => {});
    await tick(10);
    expect(nodeB.registryMap.get("CachedService")).toMatchObject({
      name: "CachedService",
      origin: { instanceName: "cache-a", instanceKey: "ca" },
    });

    // источник погашен
    bus.mute("A");

    // C опрашивает — ответить может только B, и он отдаёт дескриптор A из кэша
    const received: any[] = [];
    nodeC.collectDistributions((data) => received.push(data));
    await tick(10);

    const fromB = received.find((r) => r.instance.instanceName === "cache-b");
    expect(fromB).toBeDefined();
    expect(fromB.value.find((d: any) => d.name === "CachedService")).toMatchObject({
      origin: { instanceName: "cache-a", instanceKey: "ca" },
    });
  });
});
