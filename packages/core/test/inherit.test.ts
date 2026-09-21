import { describe, it, expect } from "vitest";
import { AomCore, ExecutionPhase, InheritPlacement } from "@aom-js/core";

class Meta extends AomCore {}

const makeLog = () => {
  const log: string[] = [];
  const MarkClass = (l: string) =>
    Meta.classDecorator(($) => log.push(`${l}@${$._.target.name}`));
  const MarkMethod = (l: string) =>
    Meta.methodDecorator(($) => log.push(`${l}@${$._.target.name}.${String($._.property)}`));
  return { log, MarkClass, MarkMethod };
};

describe("core: наследование декораторов", () => {
  it("inherit повторяет FIRST-вызовы родителя в контексте потомка", () => {
    const { log, MarkClass } = makeLog();
    @MarkClass("cls")
    class Parent {}
    class Child extends Parent {}
    expect(log).toEqual(["cls@Parent"]);
    Meta.instance(Child)._.inherit(Parent);
    expect(log).toEqual(["cls@Parent", "cls@Child"]);
  });

  it("статический метод родителя переносится на потомка каррированной копией", () => {
    const { log, MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run() {
        return "from-parent";
      }
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    // потомок получил СОБСТВЕННОЕ свойство (не прототипное наследование)
    expect(Object.prototype.hasOwnProperty.call(Child, "run")).toBe(true);
    expect(Child.run).not.toBe(Parent.run); // каррированная копия — иная идентичность
    expect(Child.run()).toBe("from-parent"); // поведение сохранено
    // и мета-вызов повторён в контексте потомка
    expect(log).toContain("m@Child.run");
    // у родителя ничего не изменилось
    expect(log.filter((l) => l === "m@Parent.run")).toHaveLength(1);
  });

  // Статики защищены проверкой физического владения (Object.hasOwn на конструкторе):
  // собственный статик потомка не затирается родительским независимо от того,
  // задекорирован он или нет. Оба случая закреплены ниже.
  it("унаследованный статический метод получает потомка как this при вызове", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run(this: unknown) {
        return this;
      }
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    expect(Child.run()).toBe(Child);
    expect(Parent.run()).toBe(Parent); // у родителя контекст не подменился
  });

  it("унаследованный прототипный метод получает инстанс как this при вызове", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      run(this: unknown) {
        return this;
      }
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    const child = new Child();
    expect(child.run()).toBe(child);
  });

  it("повторный inherit того же родителя не повторяет FIRST-вызовы", () => {
    const { log, MarkClass } = makeLog();
    @MarkClass("cls")
    class Parent {}
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.inherit(Parent);
    expect(log).toEqual(["cls@Parent", "cls@Child"]);
  });

  it("собственное ЗАдекорированное переопределение потомка не затирается переносом", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run() {
        return "parent";
      }
    }
    class Child extends Parent {
      @MarkMethod("m")
      static run() {
        return "child";
      }
    }
    Meta.instance(Child)._.inherit(Parent);
    expect(Child.run()).toBe("child");
  });

  it("собственное НЕдекорированное переопределение потомка тоже не затирается", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      static run() {
        return "parent";
      }
    }
    class Child extends Parent {
      static run() {
        return "child";
      }
    }
    Meta.instance(Child)._.inherit(Parent);
    expect(Child.run()).toBe("child");
  });

  it("отложенные LAST-вызовы родителя переносятся и выполняются при apply() потомка", () => {
    const log: string[] = [];
    const Late = (l: string) =>
      Meta.classDecorator(($) => log.push(`${l}@${$._.target.name}`), ExecutionPhase.LAST);
    @Late("late")
    class Parent {}
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    expect(log).toEqual([]); // у родителя apply не вызывался, у потомка тоже
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["late@Child"]);
  });

  it("собственный прототипный метод потомка не затирается переносом", () => {
    const { MarkMethod } = makeLog();
    class Parent {
      @MarkMethod("m")
      run() {
        return "parent";
      }
    }
    class Child extends Parent {
      run() {
        return "child";
      }
    }
    Meta.instance(Child)._.inherit(Parent);
    expect(new Child().run()).toBe("child");
  });

  it("PREPEND: родительские LAST-вызовы встают единым блоком перед собственными вызовами потомка", () => {
    const log: string[] = [];
    const Late = (l: string, inherit?: InheritPlacement) =>
      Meta.classDecorator(() => log.push(l), ExecutionPhase.LAST, inherit);
    class Parent {}
    class Child extends Parent {}
    // применяем декораторы явными вызовами, чтобы порядок добавления был очевиден
    Late("p1", InheritPlacement.PREPEND)(Parent);
    Late("p2", InheritPlacement.PREPEND)(Parent);
    Late("own")(Child);
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.apply();
    // блок родителя впереди, внутренний порядок p1→p2 не развёрнут
    expect(log).toEqual(["p1", "p2", "own"]);
  });

  it("PREPEND у нескольких уровней: блок прародителя встаёт раньше блока родителя", () => {
    const log: string[] = [];
    const Late = (l: string) =>
      Meta.classDecorator(() => log.push(l), ExecutionPhase.LAST, InheritPlacement.PREPEND);
    class Grand {}
    class Parent extends Grand {}
    class Child extends Parent {}
    Late("grand")(Grand);
    Late("parent")(Parent);
    Late("own")(Child);
    // порядок как в @Controller: сначала ближайший родитель, затем выше по цепочке
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.inherit(Grand);
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["grand", "parent", "own"]);
  });

  it("SKIP: вызов не переносится на потомка, APPEND-соседи переносятся как раньше", () => {
    const log: string[] = [];
    const Late = (l: string, inherit?: InheritPlacement) =>
      Meta.classDecorator(() => log.push(l), ExecutionPhase.LAST, inherit);
    class Parent {}
    class Child extends Parent {}
    Late("skipped", InheritPlacement.SKIP)(Parent);
    Late("kept")(Parent);
    Late("own")(Child);
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["own", "kept"]);
  });

  it("перенос декораторов свойств инстанса: у потомка появляется собственный мета-инстанс свойства", () => {
    const Late = () => Meta.propertyDecorator(() => {}, ExecutionPhase.LAST);
    class Parent {
      @Late()
      field!: string;
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    const $childField = Meta.checkExists(Child.prototype, "field");
    const $parentField = Meta.checkExists(Parent.prototype, "field");
    expect($childField).toBeDefined();
    expect($childField).not.toBe($parentField);
  });

  it("метод с FIRST-декоратором не первого параметра переносится на потомка без ошибки", () => {
    const seen: string[] = [];
    const Param = () =>
      Meta.parameterDecorator(($, index) => seen.push(`${$._.target.name}:${index}`));
    class Parent {
      static run(a: string, @Param() b: string) {}
    }
    class Child extends Parent {}
    expect(() => Meta.instance(Child)._.inherit(Parent)).not.toThrow();
    expect(seen).toEqual(["Parent:1", "Child:1"]);
  });

  it("потомок со своими декораторами параметров конструктора не получает родительские", () => {
    const log: string[] = [];
    const Param = (l: string) =>
      Meta.parameterDecorator(
        ($, index) => log.push(`${l}@${$._.target.name}:${index}`),
        ExecutionPhase.LAST,
      );
    class Parent {
      constructor(@Param("p") a: string) {}
    }
    class Child extends Parent {
      constructor(@Param("c") a: string) {
        super(a);
      }
    }
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["c@Child:0"]);
  });

  it("потомок без своего конструктора получает декораторы параметров конструктора родителя", () => {
    const log: string[] = [];
    const Param = (l: string) =>
      Meta.parameterDecorator(
        ($, index) => log.push(`${l}@${$._.target.name}:${index}`),
        ExecutionPhase.LAST,
      );
    class Parent {
      constructor(@Param("p") a: string) {}
    }
    class Child extends Parent {}
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.apply();
    expect(log).toEqual(["p@Child:0"]);
  });

  it("собственные декораторы полей потомка не дополняются родительскими", () => {
    const log: string[] = [];
    const Late = (l: string) =>
      Meta.propertyDecorator(
        ($) => log.push(`${l}@${$._.target.name}.${String($._.property)}`),
        ExecutionPhase.LAST,
      );
    class Parent {
      @Late("p") field!: string;
      @Late("p") static shared: string;
    }
    class Child extends Parent {
      @Late("c") field!: string;
      @Late("c") static shared: string;
    }
    Meta.instance(Child)._.inherit(Parent);
    Meta.instance(Child)._.apply();
    expect(log.sort()).toEqual(["c@Child.field", "c@Child.shared"]);
  });
});
