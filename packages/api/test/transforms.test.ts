import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { IsString, validateSync } from "class-validator";
import { TransformTrim, QueryBoolean } from "@aom-js/api";

describe("TransformTrim", () => {
  class Trimmed {
    @TransformTrim()
    @IsString()
    value!: unknown;
  }

  it("обрезает пробелы у строки", () => {
    expect(plainToInstance(Trimmed, { value: "  a b  " }).value).toBe("a b");
  });

  it.each([null, 123, true, ["a"]])(
    "не строку (%j) отдаёт как есть, и IsString её отвергает",
    (value) => {
      const instance = plainToInstance(Trimmed, { value });
      expect(instance.value).toStrictEqual(value);
      expect(validateSync(instance)).toHaveLength(1);
    },
  );
});

describe("QueryBoolean", () => {
  class Flag {
    @QueryBoolean()
    active!: unknown;
  }

  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
    [true, true],
    [false, false],
  ])("%j -> %j", (value, expected) => {
    const instance = plainToInstance(Flag, { active: value });
    expect(instance.active).toBe(expected);
    expect(validateSync(instance)).toHaveLength(0);
  });

  it.each(["yes", "", "2", "TRUE"])("%j остаётся как есть и не проходит IsBoolean", (value) => {
    const instance = plainToInstance(Flag, { active: value });
    expect(instance.active).toBe(value);
    expect(validateSync(instance)).toHaveLength(1);
  });
});
