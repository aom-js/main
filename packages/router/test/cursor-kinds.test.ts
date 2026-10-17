import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  AomApi,
  AomCursorKind,
  AomParameterKind,
  AomValuesSource,
  AomViaKind,
  Controller,
  CursorKind,
  Middleware,
} from "@aom-js/router";

// значения закреплены: сериализация стабильна между версиями (словари — packages/router/readme.md#метаданные-цепочки-tojson-routeof-cursorkind)
describe("router: словари видов", () => {
  it.each([
    ["AomCursorKind", AomCursorKind, {
      Handler: "handler", Checkpoint: "checkpoint", Transport: "transport", Filter: "filter",
      Value: "value", Collector: "collector", Pager: "pager", Response: "response",
      Input: "input", Meta: "meta", Step: "step",
    }],
    ["AomParameterKind", AomParameterKind, {
      This: "this", State: "state", Run: "run", Values: "values", Cursor: "cursor",
      Route: "route", Ctx: "ctx", Req: "req", Res: "res", Err: "err", Other: "other",
    }],
    ["AomValuesSource", AomValuesSource, {
      Query: "query", Body: "body", Params: "params", Headers: "headers",
      Cookies: "cookies", Session: "session", Files: "files",
    }],
    ["AomViaKind", AomViaKind, {
      Endpoint: "endpoint", Before: "before", After: "after", Next: "next",
      ClassBefore: "class-before", ClassAfter: "class-after",
    }],
  ])("%s — значения словаря закреплены", (_name, dictionary, expected) => {
    expect({ ...dictionary }).toEqual(expected);
  });
});

describe("router: @CursorKind", () => {
  it("записывает вид в мета-инстанс метода", () => {
    @Controller()
    class Data {
      @CursorKind(AomCursorKind.Collector)
      @Middleware()
      static async Query() {}
    }
    expect(AomApi.checkExists(Data.Query)?.element.cursorKind).toBe(AomCursorKind.Collector);
  });

  it("наследник получает вид базового шага без ошибки", () => {
    @Controller()
    class Base {
      @CursorKind(AomCursorKind.Filter)
      @Middleware()
      static async Where() {}
    }
    @Controller()
    class Child extends Base {}
    expect(AomApi.checkExists(Child.Where)?.element.cursorKind).toBe(AomCursorKind.Filter);
  });

  it("значение вне словаря — CURSOR_KIND_DEFINE_ERROR при объявлении класса", () => {
    expect(() => {
      @Controller()
      class Typo {
        @CursorKind("colector" as any)
        @Middleware()
        static async Query() {}
      }
      return Typo;
    }).toThrow(expect.objectContaining({ message: "CURSOR_KIND_DEFINE_ERROR" }));
  });

  it("значение undefined (опечатка в имени члена enum) — CURSOR_KIND_DEFINE_ERROR", () => {
    expect(() => CursorKind((AomCursorKind as any).Colector)).toThrow(
      expect.objectContaining({ message: "CURSOR_KIND_DEFINE_ERROR" }),
    );
  });

  it("два @CursorKind на одном методе — CURSOR_KIND_DEFINE_ERROR", () => {
    expect(() => {
      @Controller()
      class Twice {
        @CursorKind(AomCursorKind.Filter)
        @CursorKind(AomCursorKind.Collector)
        @Middleware()
        static async Query() {}
      }
      return Twice;
    }).toThrow(expect.objectContaining({ message: "CURSOR_KIND_DEFINE_ERROR" }));
  });
});
