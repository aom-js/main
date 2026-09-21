import { describe, it, expect, vi } from "vitest";
import * as rxjs from "rxjs";
import {
  Transfer,
  Isolator,
  ResponseTopic,
  CustomTopic,
  Executor,
  TransferTimeoutError,
} from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();
const base = { publisher: bus.publisher, subscriber: bus.subscriber };

// ошибки без ожидающего Promise (@CustomTopic) уходят в defaultErrorHandler
const errors: Error[] = [];
// короткий таймаут: тесты не ждут штатные 30 с
const node = new Transfer({
  ...base,
  instanceName: "err-node",
  instanceKey: "e1",
  responseTimeout: 30,
  defaultErrorHandler: (error) => errors.push(error),
});

// исполнителя нет ни у одного метода
@Isolator(node)
class Orphan {
  @ResponseTopic()
  static async ask(x: number): Promise<number> {
    return undefined as never;
  }

  @CustomTopic(true)
  static async poke(x: number): Promise<unknown> {
    return undefined;
  }

  @CustomTopic()
  static async drop(): Promise<unknown> {
    return undefined;
  }
}

// исполнитель отвечает позже таймаута
@Isolator(node)
class Lagging {
  @ResponseTopic()
  static async slow(ms: number): Promise<number> {
    return undefined as never;
  }
}

@Executor()
class LaggingExecutor extends Lagging {
  static async slow(ms: number) {
    await tick(ms);
    return ms;
  }
}

// исполнители отвечают сразу: таймаут с запасом, чтобы не флейковать под нагрузкой
const steady = new Transfer({
  ...base,
  instanceName: "err-steady",
  instanceKey: "e2",
  responseTimeout: 1000,
  defaultErrorHandler: (error) => errors.push(error),
});

@Isolator(steady)
class Faulty {
  @CustomTopic()
  static async crash(): Promise<unknown> {
    return undefined;
  }

  @ResponseTopic()
  static async strict(): Promise<void> {
    return undefined as never;
  }
}

@Executor()
class FaultyExecutor extends Faulty {
  static async crash(): Promise<void> {
    throw new Error("executor crashed");
  }

  // неасинхронный метод исполнителя: синхронный throw
  static strict(): never {
    throw new Error("sync executor boom");
  }
}

// брокер недоступен: publisher бросает синхронно или отклоняет Promise
let downMode: "sync" | "async" = "sync";
const down = new Transfer({
  ...base,
  instanceName: "err-down",
  instanceKey: "e3",
  publisher: ({ topic, message }) => {
    if (!topic.startsWith("Down.")) return bus.publisher({ topic, message });
    const error = new Error(`publish failed: ${downMode}`);
    if (downMode === "sync") throw error;
    return Promise.reject(error);
  },
  responseTimeout: 1000,
  defaultErrorHandler: (error) => errors.push(error),
});

@Isolator(down)
class Down {
  @ResponseTopic()
  static async ask(): Promise<void> {
    return undefined as never;
  }

  @CustomTopic()
  static async fire(): Promise<unknown> {
    return undefined;
  }
}

// ответ исполнителя не уходит: publisher падает на reply-топиках
const mute = new Transfer({
  ...base,
  instanceName: "err-mute",
  instanceKey: "e4",
  publisher: ({ topic, message }) => {
    if (topic.startsWith("reply_Mute.")) throw new Error("reply publish failed");
    bus.publisher({ topic, message });
  },
  responseTimeout: 30,
  defaultErrorHandler: (error) => errors.push(error),
});

@Isolator(mute)
class Mute {
  @ResponseTopic()
  static async ask(): Promise<number> {
    return undefined as never;
  }

  @ResponseTopic()
  static async fail(): Promise<void> {
    return undefined as never;
  }
}

@Executor()
class MuteExecutor extends Mute {
  static async ask() {
    return 1;
  }

  static async fail(): Promise<void> {
    throw new Error("executor failed hard");
  }
}

// uniqKey последнего запроса в топик — ключ его коллбэка в callbackMap
const lastUniqKey = (topic: string) =>
  bus.published.filter((p) => p.topic === topic).at(-1)!.message.headers.uniqKey;

// активные таймеры процесса: снятый таймер ответа уменьшает счётчик
const activeTimers = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const timeoutsOf = (topic: string) =>
  errors.filter((e) => e instanceof TransferTimeoutError && e.topic === topic).length;

describe("transfer: таймаут ответа и ошибки транспорта", () => {
  it("ResponseTopic без исполнителя отклоняется TransferTimeoutError, коллбэк удаляется", async () => {
    await expect(Orphan.ask(1)).rejects.toBeInstanceOf(TransferTimeoutError);
    expect(node.callbackMap.size).toBe(0);
  });

  it("singleton-CustomTopic без исполнителя не склеивает следующие вызовы навсегда", async () => {
    await Orphan.poke(1);
    await Orphan.poke(1); // пока ждём ответа — штатная дедупликация синглтона
    await tick(5);
    expect(bus.topicCount("Orphan.poke")).toBe(1);
    await tick(50); // дольше responseTimeout: процесс снят по таймауту
    await Orphan.poke(1);
    await tick(5);
    expect(bus.topicCount("Orphan.poke")).toBe(2);
    // таймаут без ожидающего Promise — в defaultErrorHandler
    expect(timeoutsOf("Orphan.poke")).toBeGreaterThan(0);
  });

  it("ошибка исполнителя CustomTopic уходит в defaultErrorHandler", async () => {
    await Faulty.crash();
    await tick(20);
    expect(errors.map((e) => e.message)).toContain("executor crashed");
  });

  it("без defaultErrorHandler ошибки логируются console.error; rxjs.config не трогается", async () => {
    // импорт пакета не подменяет глобальный обработчик rxjs
    expect(rxjs.config.onUnhandledError).toBeNull();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const quiet = new Transfer({
        ...base,
        instanceName: "err-quiet",
        instanceKey: "e5",
        responseTimeout: 10,
      });
      @Isolator(quiet)
      class Quiet {
        @CustomTopic()
        static async drop(): Promise<unknown> {
          return undefined;
        }
      }
      await Quiet.drop();
      await tick(40);
      expect(log.mock.calls.flat()).toContainEqual(expect.any(TransferTimeoutError));
    } finally {
      log.mockRestore();
    }
  });

  it("по умолчанию таймаут 30 000 мс, responseTimeout: 0 его выключает", async () => {
    const fallback = new Transfer({ ...base, instanceName: "err-default", instanceKey: "e6" });
    expect(fallback.responseTimeout).toBe(30_000);

    const patient = new Transfer({
      ...base,
      instanceName: "err-patient",
      instanceKey: "e7",
      responseTimeout: 0,
    });
    @Isolator(patient)
    class Patient {
      @ResponseTopic()
      static async wait(): Promise<void> {
        return undefined as never;
      }
    }
    const settled = Patient.wait().then(
      () => "settled",
      () => "settled",
    );
    expect(await Promise.race([settled, tick(50).then(() => "pending")])).toBe("pending");
    expect(patient.callbackMap.size).toBe(1);
  });

  it("responseTimeout вне целых 0…2 147 483 647 мс — RangeError", () => {
    // иначе setTimeout срабатывает через 1 мс и каждый вызов сразу падает по таймауту
    const make = (responseTimeout: number) => () =>
      new Transfer({ ...base, instanceName: "err-range", instanceKey: "e8", responseTimeout });
    [Infinity, -1, 2 ** 31, 1.5, NaN].forEach((value) => expect(make(value)).toThrow(RangeError));
    expect(make(2_147_483_647)).not.toThrow();
  });
});

describe("transfer: гонки и сбои доставки", () => {
  it("поздний ответ после таймаута игнорируется", async () => {
    await expect(Lagging.slow(60)).rejects.toBeInstanceOf(TransferTimeoutError);
    const uniqKey = lastUniqKey("Lagging.slow");
    await tick(80); // исполнитель ответил уже после таймаута
    expect(bus.topicCount("reply_Lagging.slow_e1_err-node")).toBe(1);
    expect(node.callbackMap.has(uniqKey)).toBe(false);
  });

  it("отписка от CustomTopic до ответа снимает коллбэк и таймер", async () => {
    const subscription = (await Orphan.drop()) as { unsubscribe(): void };
    await tick(5); // запрос ушёл, коллбэк ждёт ответа
    const uniqKey = lastUniqKey("Orphan.drop");
    expect(node.callbackMap.has(uniqKey)).toBe(true);
    subscription.unsubscribe();
    expect(node.callbackMap.has(uniqKey)).toBe(false);
    // rxjs молча глотает error после отписки: снятие таймера — только по тому, что он не срабатывает позже
    await tick(50); // дольше responseTimeout: снятый таймер не срабатывает
    expect(timeoutsOf("Orphan.drop")).toBe(0);
  });

  it("таймер ответа unref()-нут: не держит процесс живым ни до ответа, ни после отписки", async () => {
    const pending = activeTimers();
    const subscription = (await Orphan.drop()) as { unsubscribe(): void };
    await tick(5); // запрос ушёл, таймер ответа создан, но не в счётчике удерживающих ресурсов
    expect(activeTimers()).toBe(pending);
    subscription.unsubscribe();
    expect(activeTimers()).toBe(pending);
  });

  it.each(["sync", "async"] as const)(
    "publisher падает (%s): вызов отклонён этой ошибкой, коллбэк снят",
    async (mode) => {
      downMode = mode;
      await expect(Down.ask()).rejects.toThrow(`publish failed: ${mode}`);
      await Down.fire();
      await tick(5);
      expect(errors.map((e) => e.message)).toContain(`publish failed: ${mode}`);
      expect(down.callbackMap.size).toBe(0);
    },
  );

  it("синхронный throw неасинхронного исполнителя доходит до вызывающего как reject", async () => {
    await expect(Faulty.strict()).rejects.toThrow("sync executor boom");
  });

  it("сбой публикации ответа у исполнителя уходит в defaultErrorHandler", async () => {
    await expect(Mute.ask()).rejects.toBeInstanceOf(TransferTimeoutError); // ответ не ушёл
    expect(errors.map((e) => e.message)).toContain("reply publish failed");
  });

  it("исполнитель упал и ответ-ошибка не ушёл — ошибка исполнителя в cause сбоя отправки", async () => {
    await expect(Mute.fail()).rejects.toBeInstanceOf(TransferTimeoutError); // ответ не ушёл
    const reported = errors.find(
      (e) => (e.cause as Error | undefined)?.message === "executor failed hard",
    );
    expect(reported).toMatchObject({ message: "reply publish failed" });
  });

  it("сбой publisher у протокола реестра уходит в defaultErrorHandler узла", async () => {
    const registryErrors: Error[] = [];
    // асинхронный publisher отклоняет только системные топики реестра
    const flaky = new Transfer({
      ...base,
      instanceName: "err-flaky",
      instanceKey: "e10",
      publisher: ({ topic, message }) =>
        topic.startsWith("!Transfer_Registry_")
          ? Promise.reject(new Error(`registry publish failed: ${topic}`))
          : bus.publisher({ topic, message }),
      defaultErrorHandler: (error) => registryErrors.push(error),
    });
    const asker = new Transfer({ ...base, instanceName: "err-asker", instanceKey: "e11" });
    flaky.collectDistributions(() => {}); // запрос реестра не ушёл
    asker.collectDistributions(() => {}); // ответ flaky на чужой запрос не ушёл
    await tick(20);
    expect(registryErrors.map((e) => e.message)).toEqual([
      `registry publish failed: ${flaky.registryRequestTopic}`,
      `registry publish failed: ${flaky.registryResponseTopic}`,
    ]);
  });

  it.each(["sync", "async"] as const)(
    "сбой самого defaultErrorHandler (%s) не роняет процесс — пишется в console.error",
    async (mode) => {
      const boom = new Error("handler boom");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const fragile = new Transfer({
          ...base,
          instanceName: `err-fragile-${mode}`,
          instanceKey: "e9",
          responseTimeout: 10,
          // TS пропускает async-обработчик в (error) => void — его отклонение тоже ловится
          defaultErrorHandler:
            mode === "sync"
              ? () => {
                  throw boom;
                }
              : async () => {
                  throw boom;
                },
        });
        @Isolator(fragile)
        class Fragile {
          @CustomTopic()
          static async drop(): Promise<unknown> {
            return undefined;
          }
        }
        await Fragile.drop();
        await tick(40);
        expect(log).toHaveBeenCalledWith(
          "transfer defaultErrorHandler failed",
          boom,
          expect.any(TransferTimeoutError),
        );
      } finally {
        log.mockRestore();
      }
    },
  );
});
