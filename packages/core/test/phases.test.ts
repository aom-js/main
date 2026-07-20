import { describe, it, expect } from "vitest";
import { AomCore, ExecutionPhase } from "@aom-js/core";

class Meta extends AomCore {}

describe("core: фабрики декораторов и фазы", () => {
  it("classDecorator FIRST выполняется в момент декорирования, $ указывает на класс", () => {
    const log: string[] = [];
    const Mark = (label: string) =>
      Meta.classDecorator(($) => {
        log.push(`${label}@${$._.target.name}`);
      });
    @Mark("cls")
    class A {}
    expect(log).toEqual(["cls@A"]);
    expect(Meta.checkExists(A)).toBeDefined();
  });

  it("methodDecorator FIRST получает дескриптор и корректный $", () => {
    let seen: { name: string; property: string; hasValue: boolean } | undefined;
    const Mark = () =>
      Meta.methodDecorator(($, descriptor) => {
        seen = {
          name: $._.target.name,
          property: String($._.property),
          hasValue: typeof descriptor.value === "function",
        };
      });
    class B {
      @Mark()
      static run() {}
    }
    expect(seen).toEqual({ name: "B", property: "run", hasValue: true });
  });

  it("LAST на методе выполняется только при apply() корневого класса", () => {
    const log: string[] = [];
    const Late = () => Meta.methodDecorator(($) => log.push("last"), ExecutionPhase.LAST);
    class C {
      @Late()
      static run() {}
    }
    expect(log).toEqual([]); // отложено
    Meta.instance(C)._.apply(); // класс разбирает очереди методов через origins
    expect(log).toEqual(["last"]);
  });

  it("порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)", async () => {
    const log: string[] = [];
    const Mark = (label: string, phase: ExecutionPhase) =>
      Meta.classDecorator(($) => log.push(label), phase);
    // legacy-декораторы применяются снизу вверх: delay, last, first
    @Mark("first", ExecutionPhase.FIRST)
    @Mark("last", ExecutionPhase.LAST)
    @Mark("delay", ExecutionPhase.DELAY)
    class D {}
    expect(log).toEqual(["first"]); // только FIRST сработал при декорировании
    Meta.instance(D)._.apply();
    expect(log).toEqual(["first", "last"]); // DELAY еще нет — он через setTimeout
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["first", "last", "delay"]);
  });

  it("INSTANT выполняется немедленно и не сохраняется в очередях", () => {
    const log: string[] = [];
    const Now = () => Meta.classDecorator(($) => log.push("now"), ExecutionPhase.INSTANT);
    @Now()
    class E {}
    expect(log).toEqual(["now"]);
    Meta.instance(E)._.apply();
    expect(log).toEqual(["now"]); // повторного вызова нет
  });

  it("propertyDecorator работает на свойствах инстанса", () => {
    const log: string[] = [];
    const Prop = () =>
      Meta.propertyDecorator(($) => log.push(String($._.property)), ExecutionPhase.LAST);
    class F {
      @Prop()
      field!: string;
    }
    Meta.instance(F)._.apply();
    expect(log).toEqual(["field"]);
  });

  it("parameterDecorator получает индекс параметра, порядок стабилен по индексам", () => {
    const seen: number[] = [];
    const Param = () => Meta.parameterDecorator(($, index) => seen.push(index));
    class G {
      static run(@Param() a: string, @Param() b: string, @Param() c: string) {}
    }
    // legacy применяет параметры справа налево, но индексы приходят корректные
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("combinedDecorator различает класс и статический метод", () => {
    const kinds: string[] = [];
    const Both = () =>
      Meta.combinedDecorator(($, descriptor) => {
        kinds.push(descriptor ? "method" : "class");
      });
    @Both()
    class H {
      @Both()
      static run() {}
    }
    expect(kinds).toEqual(["method", "class"]); // метод декорируется раньше класса
  });
});
