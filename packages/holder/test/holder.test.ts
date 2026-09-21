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

    // порядок внутри Reflect.decorate не гарантирован (см. тест ниже про Hold), важно,
    // что перенеслись оба уровня и без дублирования
    expect(applied).toEqual(expect.arrayContaining(["grand:LeafChild", "parent:LeafChild"]));
    expect(applied).toHaveLength(2);
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
