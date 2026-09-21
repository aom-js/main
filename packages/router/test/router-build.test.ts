import { describe, it, expect } from "vitest";
import {
  Controller, Get, Post, Delete, Bridge, Middleware, Router, OpenApi,
  Before, After, WebSocketPoint, DelayRefStack, RouteRef,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

describe("router: построение маршрутов", () => {
  it("эндпоинты контроллера превращаются в маршруты с методом и путём", () => {
    @Controller()
    class App {
      @Get("/hello")
      static async hello() {}

      @Post("/items")
      static async create() {}

      @Delete("/items/remove")
      static async remove() {}
    }
    const router = new Router(App, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(
      expect.arrayContaining(["get /hello", "post /items", "delete /items/remove"]),
    );
    expect(table).toHaveLength(3);
  });

  it("Bridge монтирует вложенный контроллер под префиксом, включая вложенность в два уровня", () => {
    @Controller()
    class Leaf {
      @Get("/item")
      static async item() {}
    }

    @Controller()
    @Bridge("/leaf", Leaf)
    class Mid {
      @Get()
      static async index() {}
    }

    @Controller()
    @Bridge("/mid", Mid)
    class Root {
      @Get()
      static async home() {}
    }

    const router = new Router(Root, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(
      expect.arrayContaining(["get /", "get /mid", "get /mid/leaf/item"]),
    );
  });

  it("наследник контроллера получает маршруты родителя", () => {
    @Controller()
    class BaseApi {
      @Get("/base")
      static async base() {}
    }

    @Controller()
    class ChildApi extends BaseApi {
      @Get("/own")
      static async own() {}
    }

    const router = new Router(ChildApi, makeDocs());
    const table = router.routes.map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(expect.arrayContaining(["get /base", "get /own"]));
  });

  it("конфликтующие роли метода — ошибка определения", () => {
    expect(() => {
      class Bad {
        @Middleware()
        @Get()
        static async both() {}
      }
      void Bad;
    }).toThrow("MIDDLEWARE_DEFINE_ERROR");
  });

  it("Endpoint поверх Middleware — ошибка определения", () => {
    expect(() => {
      class Bad {
        @Get()
        @Middleware()
        static async both() {}
      }
      void Bad;
    }).toThrow("ENDPOINT_DEFINE_ERROR");
  });

  it("курсоры class-level middleware у каждого маршрута свои и указывают на его эндпоинт", () => {
    class Guard {
      @Middleware()
      static async check() {}
    }

    @Controller()
    @Before(Guard.check)
    class App {
      @Get("/a")
      static async a() {}

      @Get("/b")
      static async b() {}
    }

    const router = new Router(App, makeDocs());
    const [a, b] = router.routes;
    expect(a.cursors[0]).not.toBe(b.cursors[0]);
    router.routes.forEach((route) => {
      route.cursors.forEach((cursor) => expect(cursor.endpoint).toBe(route.endpoint));
    });
  });

  it("DelayRefStack(RouteRef) на class-level middleware — ошибка ROUTE_REF_DELAY_ERROR", () => {
    class Guard {
      @Middleware()
      @DelayRefStack(RouteRef(() => []))
      static async check() {}
    }

    @Controller()
    @Before(Guard.check)
    class App {
      @Get("/a")
      static async a() {}
    }

    expect(() => new Router(App, makeDocs())).toThrow("ROUTE_REF_DELAY_ERROR");
  });

  it("Before/After со ссылкой не на middleware — ошибка определения", () => {
    class Plain {
      static async notMiddleware() {}
    }

    expect(() => {
      @Controller()
      @Before(Plain.notMiddleware)
      class BadBefore {}
      void BadBefore;
    }).toThrow("USE_MIDDLEWARE_DEFINE_ERROR");

    expect(() => {
      @Controller()
      @After(Plain.notMiddleware)
      class BadAfter {}
      void BadAfter;
    }).toThrow("USE_MIDDLEWARE_DEFINE_ERROR");
  });

  it("WebSocketPoint без пути монтируется на префикс контроллера", () => {
    @Controller()
    class App {
      @WebSocketPoint()
      static async live() {}
    }

    const router = new Router(App, makeDocs());
    expect(router.sockets.map((r) => `${r.method} ${r.path}`)).toEqual(["sockets /"]);
  });
});
