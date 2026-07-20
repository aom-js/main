import { describe, it, expect } from "vitest";
import {
  Controller, Get, Middleware, Before, Router, OpenApi,
  Query, Body, Err, This, OnInstance, HttpContextValues,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

const makeContext = (partial: Partial<HttpContextValues> = {}): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
  ...partial,
});

async function call(router: Router, method: string, path: string, ctx: HttpContextValues) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route.apply(ctx);
}

describe("router: исполнение запроса", () => {
  it("миддлвари выполняются до эндпоинта; undefined продолжает цепочку; результат эндпоинта — ответ", async () => {
    const calls: string[] = [];

    class Guard {
      @Middleware()
      static async check() {
        calls.push("guard"); // возвращает undefined — цепочка продолжается
      }
    }

    @Controller()
    @Before(Guard.check)
    class App {
      @Get("/hello")
      static async hello(@Query("name") name: string) {
        calls.push("endpoint");
        return `hi ${name}`;
      }
    }

    const router = new Router(App, makeDocs());
    const result = await call(router, "get", "/hello", makeContext({ query: { name: "aom" } }));
    expect(result).toBe("hi aom");
    expect(calls).toEqual(["guard", "endpoint"]);
  });

  it("миддлварь, вернувшая значение, перехватывает ответ — эндпоинт не вызывается", async () => {
    const calls: string[] = [];

    class Blocker {
      @Middleware()
      static async block() {
        return { denied: true };
      }
    }

    @Controller()
    @Before(Blocker.block)
    class App {
      @Get("/secure")
      static async secure() {
        calls.push("endpoint");
        return "secret";
      }
    }

    const router = new Router(App, makeDocs());
    const result = await call(router, "get", "/secure", makeContext());
    expect(result).toEqual({ denied: true });
    expect(calls).toEqual([]);
  });

  it("возврат экземпляра Error приводит к reject", async () => {
    @Controller()
    class App {
      @Get("/fail")
      static async fail(@Err() err: (message: string, status?: number) => Error) {
        return err("boom", 418);
      }
    }
    const router = new Router(App, makeDocs());
    await expect(call(router, "get", "/fail", makeContext())).rejects.toMatchObject({
      message: "boom",
      status: 418,
    });
  });

  it("выброшенное исключение приводит к reject", async () => {
    @Controller()
    class App {
      @Get("/throw")
      static async explode() {
        throw new Error("crashed");
      }
    }
    const router = new Router(App, makeDocs());
    await expect(call(router, "get", "/throw", makeContext())).rejects.toThrow("crashed");
  });

  it("Body и Query извлекают значения по ключу и целиком", async () => {
    @Controller()
    class App {
      @Get("/echo")
      static async echo(@Body() body: unknown, @Query("q") q: string) {
        return { body, q };
      }
    }
    const router = new Router(App, makeDocs());
    const result = await call(
      router, "get", "/echo",
      makeContext({ body: { a: 1 }, query: { q: "x" } }),
    );
    expect(result).toEqual({ body: { a: 1 }, q: "x" });
  });

  it("This создает инстанс с аргументами конструктора и хуком OnInstance; новый запрос — новый инстанс", async () => {
    const hookLog: string[] = [];

    // ИНВАРИАНТ: класс-цель @This с декораторами аргументов (конструктор, хуки) обязан быть
    // @Controller() — только он вызывает apply() и разбирает LAST-очередь параметр-декораторов;
    // без него handlers молча остаются пустыми
    @Controller()
    class Session {
      who: string;
      constructor(@Query("user") user: string) {
        this.who = user;
      }

      @OnInstance()
      static async init(@This() self: Session) {
        hookLog.push(`init:${self.who}`);
      }
    }

    @Controller()
    class App {
      @Get("/me")
      static async me(@This(Session) a: Session) {
        return { who: a.who };
      }
    }

    const router = new Router(App, makeDocs());
    const first = await call(router, "get", "/me", makeContext({ query: { user: "alice" } }));
    expect(first).toEqual({ who: "alice" });
    expect(hookLog).toEqual(["init:alice"]); // хук вызван однократно

    const second = await call(router, "get", "/me", makeContext({ query: { user: "bob" } }));
    expect(second).toEqual({ who: "bob" }); // новый запрос — новый инстанс
    expect(hookLog).toEqual(["init:alice", "init:bob"]);
  });

  // FINDING: аргументы метода решаются конкурентно (Promise.all), а This делает async
  // check-then-create по context.state без дедупликации — два @This одного класса в одном
  // методе создают два инстанса (гонка)
  it.fails("два @This одного класса в одном методе дают один инстанс (дефект: гонка Promise.all)", async () => {
    @Controller()
    class Service {
      constructor(@Query("user") public who: string) {}
    }

    @Controller()
    class App {
      @Get("/pair")
      static async pair(@This(Service) a: Service, @This(Service) b: Service) {
        return { same: a === b };
      }
    }

    const router = new Router(App, makeDocs());
    const result = await call(router, "get", "/pair", makeContext({ query: { user: "x" } }));
    expect(result).toEqual({ same: true });
  });
});
