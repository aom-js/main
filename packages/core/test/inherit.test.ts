import { describe, it, expect } from "vitest";
import { AomCore, ExecutionPhase } from "@aom-js/core";

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
});
