import { describe, it, expect } from "vitest";
import { Hold, Delay, Apply } from "@aom-js/holder";

describe("holder: отложенное применение декораторов при наследовании", () => {
  it("Hold на свойстве родителя + Apply на потомке применяет декоратор к потомку", () => {
    const applied: string[] = [];
    const Spy =
      (label: string): PropertyDecorator =>
      (target, property) => {
        applied.push(`${label}:${(target as any).constructor.name}.${String(property)}`);
      };

    class HeldBase {
      @Hold(Spy("a"))
      field!: string;
    }

    @Apply()
    class HeldChild extends HeldBase {}
    void HeldChild;

    expect(applied).toEqual(["a:HeldChild.field"]);
  });

  it("Apply применяет переданные ему декораторы класса к самому классу", () => {
    const applied: string[] = [];
    const ClassSpy =
      (label: string): ClassDecorator =>
      (target) => {
        applied.push(`${label}:${target.name}`);
      };

    @Apply(ClassSpy("cls"))
    class Applied {}
    void Applied;

    expect(applied).toEqual(["cls:Applied"]);
  });

  it("Delay на родителе + Apply на потомке переносит класс-декораторы родителя", () => {
    const applied: string[] = [];
    const ClassSpy =
      (label: string): ClassDecorator =>
      (target) => {
        applied.push(`${label}:${target.name}`);
      };

    @Delay(ClassSpy("cls"))
    class DelayedBase {}

    @Apply()
    class DelayedChild extends DelayedBase {}
    void DelayedChild;

    expect(applied).toEqual(["cls:DelayedChild"]);
  });

  it("трёхуровневая цепочка Delay/Delay/Apply переносит очередь прародителя и родителя", () => {
    const applied: string[] = [];
    const ClassSpy =
      (label: string): ClassDecorator =>
      (target) => {
        applied.push(`${label}:${target.name}`);
      };

    @Delay(ClassSpy("grand"))
    class GrandBase {}

    @Delay(ClassSpy("parent"))
    class MiddleBase extends GrandBase {}

    @Apply()
    class LeafChild extends MiddleBase {}
    void LeafChild;

    // дальний предок применяется первым, ближний — последним; без дублей
    expect(applied).toEqual(["grand:LeafChild", "parent:LeafChild"]);
  });

  it("несколько Hold-декораторов применяются в сохраненном порядке", () => {
    const applied: string[] = [];
    const Spy =
      (label: string): PropertyDecorator =>
      () => {
        applied.push(label);
      };

    class MultiBase {
      @Hold(Spy("first"), Spy("second"))
      field!: string;
    }

    @Apply()
    class MultiChild extends MultiBase {}
    void MultiChild;

    expect(applied).toEqual(expect.arrayContaining(["first", "second"]));
  });
});

describe("holder: порядок класс-декораторов по цепочке Delay/Apply", () => {
  // классовый декоратор, перезаписывающий одно значение (как ComponentSchema описание схемы)
  const setup = () => {
    const calls: string[] = [];
    const descriptions = new Map<object, string>();
    const Describe =
      (description: string): ClassDecorator =>
      (target) => {
        calls.push(`${description}:${target.name}`);
        descriptions.set(target, description);
      };
    return { calls, descriptions, Describe };
  };

  it("на Apply-потомке ближний класс срабатывает последним и перекрывает предков", () => {
    const { calls, descriptions, Describe } = setup();

    @Delay(Describe("дед"))
    class Grand {}

    @Delay(Describe("отец"))
    class Father extends Grand {}

    @Apply(Describe("сын"))
    class Son extends Father {}

    expect(calls).toEqual(["дед:Son", "отец:Son", "сын:Son"]);
    expect(descriptions.get(Son)).toBe("сын");
  });

  it("без своих декораторов у потомка побеждает прямой родитель", () => {
    const { calls, descriptions, Describe } = setup();

    @Delay(Describe("дед"))
    class Grand {}

    @Delay(Describe("отец"))
    class Father extends Grand {}

    @Apply()
    class Son extends Father {}

    expect(calls).toEqual(["дед:Son", "отец:Son"]);
    expect(descriptions.get(Son)).toBe("отец");
  });

  it("Delay и Apply на одном потомке: оба собственных выше предков", () => {
    const { calls, Describe } = setup();

    @Delay(Describe("отец"))
    class Father {}

    @Apply(Describe("apply"))
    @Delay(Describe("delay"))
    class Son extends Father {}
    void Son;

    expect(calls).toEqual(["отец:Son", "delay:Son", "apply:Son"]);
  });

  it("класс-декораторы доходят через промежуточный класс без декораторов холдера", () => {
    const { calls, Describe } = setup();

    @Delay(Describe("дед"))
    class Grand {}

    class Father extends Grand {}

    @Apply(Describe("сын"))
    class Son extends Father {}
    void Son;

    expect(calls).toEqual(["дед:Son", "сын:Son"]);
  });
});

describe("holder: Hold через промежуточный класс без декораторов холдера", () => {
  const setup = () => {
    const applied: string[] = [];
    const Spy =
      (label: string): PropertyDecorator =>
      (target, property) => {
        applied.push(`${label}:${(target as object).constructor.name}.${String(property)}`);
      };
    return { applied, Spy };
  };

  it("Hold деда применяется на Apply-внуке через обычный класс посередине", () => {
    const { applied, Spy } = setup();

    class Grand {
      @Hold(Spy("a"))
      field!: string;
    }

    class Father extends Grand {}

    @Apply()
    class Son extends Father {}
    void Son;

    expect(applied).toEqual(["a:Son.field"]);
  });

  it("Hold деда доходит через промежуточный класс, у которого только свой Hold", () => {
    const { applied, Spy } = setup();

    class Grand {
      @Hold(Spy("a"))
      grandField!: string;
    }

    class Father extends Grand {
      @Hold(Spy("b"))
      fatherField!: string;
    }

    @Apply()
    class Son extends Father {}
    void Son;

    expect([...applied].sort()).toEqual(["a:Son.grandField", "b:Son.fatherField"]);
  });

  it("два потомка одного промежуточного класса получают Hold по одному разу", () => {
    const { applied, Spy } = setup();

    class Grand {
      @Hold(Spy("a"))
      field!: string;
    }

    class Father extends Grand {}

    @Apply()
    class FirstSon extends Father {}

    @Apply()
    class SecondSon extends Father {}
    void FirstSon;
    void SecondSon;

    expect(applied).toEqual(["a:FirstSon.field", "a:SecondSon.field"]);
  });
});

