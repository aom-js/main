import { describe, it, expect } from "vitest";
import {
  Controller,
  Get,
  Middleware,
  Before,
  Router,
  OpenApi,
  Body,
  Query,
  HttpContextValues,
  lazy,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

const makeContext = (partial: Partial<HttpContextValues> = {}): HttpContextValues => ({
  ctx: {},
  req: {},
  res: {},
  body: {},
  files: {},
  query: {},
  params: {},
  cookies: {},
  headers: {},
  session: {},
  ...partial,
});

describe("router: ленивые значения контекста (lazy/@Body)", () => {
  it("одна фабрика на все обращения @Body в запросе: два параметра метода и отдельный курсор маршрута", async () => {
    let calls = 0;
    const parsed = { ok: true };

    // ИНВАРИАНТ: класс с декораторами аргументов обязан быть @Controller() — только он
    // вызывает apply() и разбирает очередь параметр-декораторов (см. router-exec.test.ts)
    @Controller()
    class Guard {
      @Middleware()
      static async check(@Body() body: unknown) {
        expect(body).toBe(parsed);
      }
    }

    @Controller()
    @Before(Guard.check)
    class App {
      @Get("/body")
      static async handler(@Body() first: unknown, @Body() second: unknown) {
        expect(first).toBe(parsed);
        expect(second).toBe(parsed);
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.handler).apply(
      makeContext({
        body: lazy(() => {
          calls += 1;
          return parsed;
        }),
      }),
    );

    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("фабрика не вызывается, если тело никто не запросил", async () => {
    let calls = 0;

    @Controller()
    class App {
      @Get("/no-body")
      static async handler(@Query("q") q: string) {
        return q;
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.handler).apply(
      makeContext({
        query: { q: "x" },
        body: lazy(() => {
          calls += 1;
          return {};
        }),
      }),
    );

    expect(result).toBe("x");
    expect(calls).toBe(0);
  });

  it("отказ фабрики отдаётся всем обращениям и не перезапускает её", async () => {
    let calls = 0;

    @Controller()
    class App {
      @Get("/reject")
      static async handler(@Body() first: unknown, @Body() second: unknown) {
        return { first, second };
      }
    }

    const router = new Router(App, makeDocs());
    await expect(
      router.routeOf(App.handler).apply(
        makeContext({
          body: lazy(() => {
            calls += 1;
            return Promise.reject(new Error("boom"));
          }),
        }),
      ),
    ).rejects.toThrow("boom");

    expect(calls).toBe(1);
  });

  it("синхронный throw внутри фабрики становится отказом, а не падением процесса", async () => {
    let calls = 0;

    @Controller()
    class App {
      @Get("/throw")
      static async handler(@Body() body: unknown) {
        return body;
      }
    }

    const router = new Router(App, makeDocs());
    await expect(
      router.routeOf(App.handler).apply(
        makeContext({
          body: lazy(() => {
            calls += 1;
            throw new Error("sync boom");
          }),
        }),
      ),
    ).rejects.toThrow("sync boom");

    expect(calls).toBe(1);
  });

  it("готовое (не ленивое) значение ведёт себя как обычное поле контекста", async () => {
    @Controller()
    class App {
      @Get("/plain")
      static async handler(@Body() body: unknown) {
        return body;
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.handler).apply(makeContext({ body: { a: 1 } }));
    expect(result).toEqual({ a: 1 });
  });
});
