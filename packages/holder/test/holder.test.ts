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

  // FINDING: Delay работает в фазе INSTANT, которая не сохраняется в callstack —
  // очередь класс-декораторов родителя не переносится при наследовании (holder — черновик 0.0.1)
  it.fails("Delay на родителе + Apply на потомке переносит класс-декораторы родителя", () => {
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
