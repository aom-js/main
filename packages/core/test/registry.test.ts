import { describe, it, expect } from "vitest";
import { AomCore, ClassInstanceMap } from "@aom-js/core";

class Meta extends AomCore {
  label?: string;
}

describe("core: реестр инстансов", () => {
  it("один класс — один и тот же мета-инстанс", () => {
    class A {}
    const a1 = Meta.instance(A);
    const a2 = Meta.instance(A);
    expect(a1).toBe(a2);
    expect(a1).toBeInstanceOf(Meta);
    expect(a1._.target).toBe(A);
  });

  it("наследник получает собственный инстанс, отличный от родителя", () => {
    class A {}
    class B extends A {}
    expect(Meta.instance(B)).not.toBe(Meta.instance(A));
  });

  it("разные мета-классы ведут независимые карты", () => {
    class Other extends AomCore {}
    class A {}
    const m = Meta.instance(A);
    const o = Other.instance(A);
    expect(m).not.toBe(o);
    expect(o).toBeInstanceOf(Other);
  });

  it("статический метод ключуется по идентичности функции", () => {
    class A {
      static handler() {}
    }
    const viaProperty = Meta.instance(A, "handler");
    const viaValue = Meta.instance(A.handler);
    expect(viaProperty).toBe(viaValue);
    expect(viaProperty._.target).toBe(A);
    expect(viaProperty._.property).toBe("handler");
  });

  it("инстанс, созданный по значению функции, дополняется нодой при обращении по свойству", () => {
    class A {
      static handler() {}
    }
    const viaValue = Meta.instance(A.handler); // сначала по функции
    const viaProperty = Meta.instance(A, "handler");
    expect(viaProperty).toBe(viaValue);
    // нода заменена на корректную (см. core.ts: instance(), ветка property && target !== constructor)
    expect(viaValue._.target).toBe(A);
    expect(viaValue._.property).toBe("handler");
  });

  it("свойство инстанса попадает в карту properties корневого класса", () => {
    class A {
      field?: string;
    }
    const $field = Meta.instance(A.prototype, "field");
    const $root = Meta.instance(A);
    expect($root._.properties.get("field")).toBe($field);
    expect($field._.root).toBe($root);
  });

  it("статическое НЕ-методное свойство попадает в карту statics", () => {
    class A {
      static config?: string;
    }
    const $static = Meta.instance(A, "config");
    const $root = Meta.instance(A);
    expect($root._.statics.get("config")).toBe($static);
  });

  it("checkExists не создает инстанс", () => {
    class A {}
    expect(Meta.checkExists(A)).toBeUndefined();
    const created = Meta.instance(A);
    expect(Meta.checkExists(A)).toBe(created);
  });

  it("отсутствующая цель (undefined/null) — ошибка с именем мета-класса", () => {
    expect(() => Meta.checkExists(undefined as never)).toThrow(/Meta: target is undefined/);
    expect(() => Meta.instance(null as never)).toThrow(/Meta: target is null/);
  });
});

describe("core: ClassInstanceMap", () => {
  it("типизированный get/set/has/delete по конструктору", () => {
    class Service {
      x = 1;
    }
    const map = new ClassInstanceMap();
    expect(map.has(Service)).toBe(false);
    map.set(Service, new Service());
    expect(map.has(Service)).toBe(true);
    expect(map.get(Service)!.x).toBe(1);
    map.delete(Service);
    expect(map.get(Service)).toBeUndefined();
  });
});
