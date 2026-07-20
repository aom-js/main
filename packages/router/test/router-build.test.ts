import { describe, it, expect } from "vitest";
import { Controller, Get, Post, Delete, Bridge, Middleware, Router, OpenApi } from "@aom-js/router";

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
});
