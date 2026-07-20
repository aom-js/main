import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, Executor, IsDistributed } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const nodeA = new Transfer({
  instanceName: "node-a",
  instanceKey: "a1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});
const nodeB = new Transfer({
  instanceName: "node-b",
  instanceKey: "b1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

describe("transfer: адресация конкретного инстанса", () => {
  @Isolator(nodeA)
  class Worker {
    @ResponseTopic()
    static async whoami(): Promise<string> {
      return undefined as never;
    }
  }

  @Executor("w1")
  class WorkerOne extends Worker {
    static async whoami() {
      return "w1";
    }
  }

  it("toInstance направляет вызов в топик с суффиксом инстанса", async () => {
    const result = await Transfer.toInstance(Worker, "w1").whoami();
    expect(result).toBe("w1");
    expect(bus.topicCount("Worker.whoami_w1")).toBe(1);
    expect(bus.topicCount("Worker.whoami")).toBe(0); // безадресный топик не использовался
  });
});

describe("transfer: реестр распределенных схем", () => {
  @Isolator(nodeA)
  @IsDistributed()
  class DistService {
    @ResponseTopic()
    static async ping(): Promise<string> {
      return undefined as never;
    }
  }

  it("IsDistributed регистрирует дескриптор в registryMap своего транспорта", () => {
    expect(nodeA.registryMap.get("DistService")).toMatchObject({
      name: "DistService",
      origin: { instanceName: "node-a", instanceKey: "a1" },
    });
    void DistService;
  });

  it("collectDistributions опрашивает другие ноды и получает их схемы", async () => {
    const received: any[] = [];
    nodeB.collectDistributions((data) => received.push(data));
    await tick(10);
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].instance).toMatchObject({
      instanceName: "node-a",
      instanceKey: "a1",
    });
  });

  it("нода не отвечает сама себе на запрос реестра", async () => {
    const received: any[] = [];
    nodeA.collectDistributions((data) => received.push(data));
    await tick(10);
    // ответ мог прийти только от nodeB (у которой реестр пуст) — но не от самой nodeA
    expect(received.every((r) => r.instance.instanceName !== "node-a")).toBe(true);
  });
});
