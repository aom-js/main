import { describe, it, expect } from "vitest";
import { Transfer, Isolator, CustomTopic, Executor, IsQueue } from "@aom-js/transfer";
import { MemoryBus } from "./memory-bus";

// Рецепт: https://aom-js.github.io/docs/cookbook/isolators/#очередь-исполнителей-isqueue — то же самое здесь исполняется тестом
const bus = new MemoryBus();

// перехватываем аргументы, с которыми Executor подписывается на топик — сама MemoryBus
// значение queue не использует (доставляет всем подписчикам), поэтому проверяем именно вход subscriber
const subscriptions: { topic: string; queue?: boolean }[] = [];
const node = new Transfer({
  instanceName: "queue-node",
  instanceKey: "q1",
  publisher: bus.publisher,
  subscriber: (args) => {
    subscriptions.push({ topic: args.topic, queue: args.queue });
    bus.subscriber(args);
  },
});

@Isolator(node)
class QueuedService {
  @CustomTopic()
  @IsQueue()
  static async work(): Promise<void> {
    return undefined as never;
  }

  // без @IsQueue — для контраста
  @CustomTopic()
  static async plain(): Promise<void> {
    return undefined as never;
  }
}

@Executor()
class QueuedExecutor extends QueuedService {
  static async work(): Promise<void> {}

  static async plain(): Promise<void> {}
}

describe("transfer: @IsQueue", () => {
  it("метод с @IsQueue подписывается с queue: true, метод без декоратора — без queue", () => {
    void QueuedExecutor; // декоратор уже отработал на импорте класса
    const queued = subscriptions.find((s) => s.topic === "QueuedService.work");
    const plain = subscriptions.find((s) => s.topic === "QueuedService.plain");
    expect(queued?.queue).toBe(true);
    expect(plain?.queue).toBeUndefined();
  });
});
