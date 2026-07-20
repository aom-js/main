import { describe, it, expect } from "vitest";

describe("smoke: транспиляция legacy-декораторов", () => {
  it("legacy property-декоратор получает (target, property)", () => {
    const seen: Array<[object, string | symbol]> = [];
    const Dec = (): PropertyDecorator => (target, property) => {
      seen.push([target, property]);
    };
    class S {
      @Dec()
      field!: string;
    }
    expect(seen).toEqual([[S.prototype, "field"]]);
  });

  it("decoratorMetadata эмитится (design:type доступен)", () => {
    const Dec = (): PropertyDecorator => () => {};
    class S {
      @Dec()
      field!: string;
    }
    expect(Reflect.getMetadata("design:type", S.prototype, "field")).toBe(String);
  });
});
