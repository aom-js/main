import { describe, it, expect } from "vitest";
import {
  Transfer,
  AomIsolator,
  Isolator,
  ResponseTopic,
  CustomTopic,
  Executor,
  TopicTimeout,
  TransferTimeoutError,
} from "@aom-js/transfer";
import { MemoryBus, tick } from "./memory-bus";

const bus = new MemoryBus();

// общий таймаут узла короткий, но не нулевой — чтобы отличить его от перекрытий метода
const node = new Transfer({
  instanceName: "tt-node",
  instanceKey: "t1",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
  responseTimeout: 50,
});

// исполнителя нет ни у одного метода — проверяем сам таймаут ответа, не факт доставки
@Isolator(node)
class Orphan {
  // без @TopicTimeout — берёт responseTimeout транспорта
  @ResponseTopic()
  static async base(): Promise<void> {
    return undefined as never;
  }

  // короче общего: должен сработать раньше 50 мс узла
  @TopicTimeout(15)
  @ResponseTopic()
  static async short(): Promise<number> {
    return undefined as never;
  }
}

@Isolator(node)
class Svc {
  // длиннее общего: должен пережить 50 мс узла и дождаться ответа
  @TopicTimeout(200)
  @ResponseTopic()
  static async long(): Promise<number> {
    return undefined as never;
  }
}

@Executor()
class SvcExecutor extends Svc {
  static async long(x: number) {
    await tick(70); // дольше 50 мс узла, короче 200 мс метода
    return x;
  }
}

// узел с ненулевым responseTimeout: @TopicTimeout(0) на методе обязан снять ограничение сам,
// не полагаясь на то, что у узла таймаут и так отключён
const zeroNode = new Transfer({
  instanceName: "tt-zero",
  instanceKey: "t2",
  publisher: bus.publisher,
  subscriber: bus.subscriber,
  responseTimeout: 30,
});

@Isolator(zeroNode)
class Patient {
  @TopicTimeout(0)
  @ResponseTopic()
  static async wait(): Promise<string> {
    return undefined as never;
  }
}

@Executor()
class PatientExecutor extends Patient {
  static async wait() {
    await tick(60); // дольше 30 мс узла, @TopicTimeout(0) снимает ограничение
    return "ok";
  }
}

// singleton-CustomTopic без исполнителя: проверяем таймер и отписку, а не доставку
@Isolator(zeroNode)
class OrphanPoke {
  @TopicTimeout(0)
  @CustomTopic(true)
  static async poke(): Promise<unknown> {
    return undefined;
  }
}

// активные таймеры процесса: снятый/несозданный таймер уменьшает счётчик
const activeTimers = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

describe("transfer: @TopicTimeout — приоритет над responseTimeout транспорта", () => {
  it("без @TopicTimeout метод использует responseTimeout транспорта", async () => {
    const rejection = expect(Orphan.base()).rejects;
    await rejection.toBeInstanceOf(TransferTimeoutError);
    await rejection.toMatchObject({ timeout: node.responseTimeout });
  });

  it("@TopicTimeout короче общего — таймаут метода срабатывает раньше", async () => {
    const rejection = expect(Orphan.short(1)).rejects;
    await rejection.toBeInstanceOf(TransferTimeoutError);
    await rejection.toMatchObject({ timeout: 15 });
  });

  it("@TopicTimeout длиннее общего — запрос переживает общий таймаут и получает ответ", async () => {
    await expect(Svc.long(9)).resolves.toBe(9);
  });

  it("@TopicTimeout(0) — ответ дольше общего таймаута доходит, таймер ответа не создаётся, утечки нет", async () => {
    const before = activeTimers();
    const promise = Patient.wait();
    await tick(5); // запрос ушёл; исполнитель уже завёл свой tick(60) — это его собственный таймер
    // без приоритета метода над транспортом тут был бы ещё один таймер — таймаут ответа на 30 мс узла
    expect(activeTimers()).toBe(before + 1);
    await expect(promise).resolves.toBe("ok");
    expect(zeroNode.callbackMap.size).toBe(0);
  });

  it("@TopicTimeout(0) на singleton-CustomTopic без исполнителя — таймер не создаётся, отписка снимает коллбэк", async () => {
    const pending = activeTimers();
    const subscription = (await OrphanPoke.poke()) as unknown as { unsubscribe(): void };
    await tick(5); // запрос ушёл, коллбэк ждёт ответа — которого не будет
    expect(activeTimers()).toBe(pending); // @TopicTimeout(0) — таймер не создавался
    subscription.unsubscribe();
    expect(zeroNode.callbackMap.size).toBe(0); // без таймера снятие держится на отписке
  });

  it("дробное, отрицательное и слишком большое значение — RangeError", () => {
    [Infinity, -1, 2 ** 31, 1.5, NaN].forEach((value) =>
      expect(() => TopicTimeout(value)).toThrow(RangeError),
    );
    expect(() => TopicTimeout(2_147_483_647)).not.toThrow();
    expect(() => TopicTimeout(0)).not.toThrow();
  });

  it("FIRST phase: значение @TopicTimeout переносится на наследника при inherit", () => {
    class Base {
      @TopicTimeout(77)
      static async m(): Promise<void> {
        return undefined as never;
      }
    }
    class Heir extends Base {}
    AomIsolator.instance(Heir)._.inherit(Base);
    const heir$ = AomIsolator.instance(Heir, "m");
    expect(heir$.responseTimeout).toBe(77);
  });
});
