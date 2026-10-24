import { describe, it, expect } from "vitest";
import {
  Controller, Get, Middleware, Nextpoint, Router, OpenApi,
  Before, After, Next, UseMarker, FwdRef, AomApi, type HttpContextValues,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ title: "t", version: "1" });

const makeContext = (): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

describe("router: FwdRef в Before/After/Next/UseMarker", () => {
  it("разрывает настоящий цикл импортов, и шаги исполняются в цепочке маршрута", async () => {
    // cycle-b первым: он импортирует cycle-a, и CycleApp объявляется, пока CycleGuard ещё нет
    const { CycleGuard } = await import("./fixtures/cycle-b");
    const { CycleApp } = await import("./fixtures/cycle-a");

    const router = new Router(CycleGuard, makeDocs());
    const route = router.routeOf(CycleApp.hello);
    expect(route.cursors.map((cursor) => cursor.$.toString())).toEqual([
      "CycleGuard.check",
      "CycleGuard.after",
      "CycleApp.hello",
      "CycleGuard.next",
    ]);
    expect(route.markers).toEqual({ cycle: true });
    // проекция цепочки видит те же раскрытые шаги
    expect(route.toJSON().steps.map(({ step, via }) => [step, via])).toEqual([
      ["CycleGuard.check", "class-before"],
      ["CycleGuard.after", "class-after"],
      ["CycleApp.hello", "endpoint"],
      ["CycleGuard.next", "next"],
    ]);

    expect(await route.apply(makeContext())).toBe("done");
    expect(CycleApp.calls).toEqual(["check", "after", "endpoint", "next"]);
  });

  it("цель FwdRef объявлена ниже по файлу — связи видны после объявления", () => {
    @Controller()
    @Before(FwdRef(() => LaterGuard.check))
    class LaterApp {
      @Get("/later")
      @Next(FwdRef(() => LaterGuard.next))
      static async later() {}
    }

    class LaterGuard {
      @Middleware()
      static async check() {}

      @Nextpoint()
      static async next() {}
    }

    expect(AomApi.instance(LaterApp).element.pre_middlewares.map(String)).toEqual([
      "LaterGuard.check",
    ]);
    expect(String(AomApi.instance(LaterApp, "later").element.nextpoint)).toBe("LaterGuard.next");
  });

  it("порядок Before сохраняется при смеси прямых ссылок и FwdRef", () => {
    class Steps {
      @Middleware()
      static async a() {}

      @Middleware()
      static async b() {}

      @Middleware()
      static async c() {}
    }

    @Controller()
    @Before(Steps.a, FwdRef(() => Steps.b))
    @Before(Steps.c)
    class Mixed {
      @Get("/mixed")
      static async mixed() {}
    }

    expect(AomApi.instance(Mixed).element.pre_middlewares.map(String)).toEqual([
      "Steps.c",
      "Steps.a",
      "Steps.b",
    ]);
  });

  it("FwdRef не на тот шаг — ошибка определения при построении маршрутов", () => {
    class Plain {
      static async notStep() {}
    }

    @Controller()
    @Before(FwdRef(() => Plain.notStep))
    class BadBefore {
      @Get("/a")
      static async a() {}
    }
    expect(() => new Router(BadBefore, makeDocs())).toThrow("USE_MIDDLEWARE_DEFINE_ERROR");

    @Controller()
    @After(FwdRef(() => Plain.notStep))
    class BadAfter {
      @Get("/a")
      static async a() {}
    }
    expect(() => new Router(BadAfter, makeDocs())).toThrow("USE_MIDDLEWARE_DEFINE_ERROR");

    @Controller()
    class BadNext {
      @Get("/a")
      @Next(FwdRef(() => Plain.notStep))
      static async a() {}
    }
    expect(() => new Router(BadNext, makeDocs())).toThrow("USE_NEXT_DEFINE_ERROR");

    @Controller()
    class BadMarker {
      @Get("/a")
      @UseMarker(FwdRef(() => Plain.notStep))
      static async a() {}
    }
    expect(() => new Router(BadMarker, makeDocs())).toThrow("USE_MARKER_DEFINE_ERROR");
  });

  it("прямая ссылка не на шаг по-прежнему падает при объявлении", () => {
    class Plain {
      static async notStep() {}
    }
    expect(() => {
      @Controller()
      class BadDirectNext {
        @Get("/a")
        @Next(Plain.notStep)
        static async a() {}
      }
      void BadDirectNext;
    }).toThrow("USE_NEXT_DEFINE_ERROR");

    expect(() => {
      @Controller()
      class BadDirectMarker {
        @Get("/a")
        @UseMarker(Plain.notStep as never)
        static async a() {}
      }
      void BadDirectMarker;
    }).toThrow("USE_MARKER_DEFINE_ERROR");
  });
});
