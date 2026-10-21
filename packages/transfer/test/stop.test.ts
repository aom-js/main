import { describe, it, expect } from "vitest";
import { Transfer, Isolator, ResponseTopic, CustomTopic, Executor } from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

// обработчик ждёт, пока тест его не отпустит
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

describe("transfer: stop()", () => {
  it("ждёт начатый обработчик и его ответ, новые сообщения исполнителю не доставляются", async () => {
    const bus = new MemoryBus();
    const node = new Transfer({
      instanceName: "stop-node",
      instanceKey: "s1",
      publisher: bus.publisher,
      subscriber: bus.subscriber,
    });
    const g = gate();
    const calls: number[] = [];

    @Isolator(node)
    class StopService {
      @ResponseTopic()
      static async work(_x: number): Promise<number> {
        return undefined as never;
      }
    }

    @Executor()
    class StopExecutor extends StopService {
      static async work(x: number) {
        calls.push(x);
        await g.wait;
        return x * 2;
      }
    }
    void StopExecutor;
    await tick(); // подписка исполнителя — в отложенной фазе декоратора

    const result = StopService.work(1);
    await tick();
    expect(calls).toEqual([1]);

    let stopped = false;
    const stopping = node.stop().then(() => (stopped = true));
    await tick();
    expect(stopped).toBe(false);

    g.open();
    await stopping;
    // ответ отправлен до завершения stop() и дошёл: подписка на ответы не снята
    expect(bus.published.some((p) => p.topic === "reply_StopService.work_s1_stop-node")).toBe(true);
    await expect(result).resolves.toBe(2);

    bus.publisher({ topic: "StopService.work", message: { value: [5], headers: {} } });
    await tick();
    expect(calls).toEqual([1]);
  });

  it("после stop() вызов чужого исполнителя получает ответ", async () => {
    const bus = new MemoryBus();
    const make = (name: string) =>
      new Transfer({ instanceName: name, instanceKey: name, ...bus.port(name) });
    const caller = make("caller");
    const owner = make("owner");

    const remote = (node: Transfer) => {
      @Isolator(node)
      class Remote {
        @ResponseTopic()
        static async ping(): Promise<string> {
          return undefined as never;
        }
      }
      return Remote;
    };
    const RemoteOnCaller = remote(caller);

    @Executor()
    class RemoteExecutor extends remote(owner) {
      static async ping() {
        return "pong";
      }
    }
    void RemoteExecutor;
    await tick();

    await caller.stop();
    await expect(RemoteOnCaller.ping()).resolves.toBe("pong");
  });

  it("подписчик без ручки отписки: stop() всё равно ждёт начатый обработчик", async () => {
    const bus = new MemoryBus();
    const node = new Transfer({
      instanceName: "plain-node",
      instanceKey: "p1",
      publisher: bus.publisher,
      subscriber: (args) => {
        bus.subscriber(args);
      },
    });
    const g = gate();
    const done: string[] = [];

    @Isolator(node)
    class PlainService {
      @CustomTopic()
      static async fire(_msg: string): Promise<void> {
        return undefined as never;
      }
    }

    @Executor()
    class PlainExecutor extends PlainService {
      static async fire(msg: string) {
        await g.wait;
        done.push(msg);
      }
    }
    void PlainExecutor;
    await tick();

    await PlainService.fire("x");
    await tick();
    let stopped = false;
    const stopping = node.stop().then(() => (stopped = true));
    await tick();
    expect(stopped).toBe(false);
    g.open();
    await stopping;
    expect(done).toEqual(["x"]);
  });

  it("повторный вызов возвращает то же ожидание", () => {
    const bus = new MemoryBus();
    const node = new Transfer({
      instanceName: "twice",
      instanceKey: "t1",
      publisher: bus.publisher,
      subscriber: bus.subscriber,
    });
    expect(node.stop()).toBe(node.stop());
  });
});
