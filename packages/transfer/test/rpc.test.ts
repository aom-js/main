import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, CustomTopic, Executor } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const node = new Transfer({
  instanceName: "test-node",
  instanceKey: "k1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
});

const fired: string[] = [];

@Isolator(node)
class MathService {
  @ResponseTopic()
  static async sum(a: number, b: number): Promise<number> {
    return undefined as never; // тело изолятора не выполняется — интерфейс
  }

  @ResponseTopic()
  static async boom(): Promise<void> {
    return undefined as never;
  }

  @ResponseTopic()
  static async zero(): Promise<number> {
    return undefined as never;
  }

  @ResponseTopic(true)
  static async slow(x: number): Promise<number> {
    return undefined as never;
  }

  @CustomTopic()
  static async fire(msg: string): Promise<unknown> {
    return undefined;
  }
}

@Executor()
class MathExecutor extends MathService {
  static async sum(a: number, b: number) {
    return a + b;
  }

  static async boom(): Promise<void> {
    throw new Error("executor failed");
  }

  static async zero(): Promise<number> {
    return 0;
  }

  static async slow(x: number) {
    await tick(20);
    return x * 2;
  }

  static async fire(msg: string) {
    fired.push(msg);
  }
}

describe("transfer: RPC поверх шины", () => {
  it("вызов изолированного метода публикует сообщение и возвращает результат исполнителя", async () => {
    await expect(MathService.sum(2, 3)).resolves.toBe(5);
    expect(bus.topicCount("MathService.sum")).toBe(1);
    // ответ ушел в reply-топик с ключами инстанса
    expect(
      bus.published.some((p) => p.topic === "reply_MathService.sum_k1_test-node"),
    ).toBe(true);
  });

  it("falsy-результат исполнителя (0) доставляется как есть, а не как {}", async () => {
    await expect(MathService.zero()).resolves.toBe(0);
  });

  it("ошибка исполнителя доставляется вызывающему как reject", async () => {
    await expect(MathService.boom()).rejects.toThrow("executor failed");
  });

  it("синглтон дедуплицирует параллельные вызовы с одинаковыми аргументами", async () => {
    const before = bus.topicCount("MathService.slow");
    const [r1, r2] = await Promise.all([MathService.slow(4), MathService.slow(4)]);
    expect(r1).toBe(8);
    expect(r2).toBe(8);
    expect(bus.topicCount("MathService.slow") - before).toBe(1); // одна публикация
  });

  it("синглтон с разными аргументами публикует отдельно", async () => {
    const before = bus.topicCount("MathService.slow");
    await Promise.all([MathService.slow(1), MathService.slow(2)]);
    expect(bus.topicCount("MathService.slow") - before).toBe(2);
  });

  it("CustomTopic не ждёт ответа, но исполнитель получает сообщение", async () => {
    await MathService.fire("hello");
    await tick(10);
    expect(fired).toContain("hello");
  });
});
