import { describe, it, expect } from "vitest";
import { Controller, Get, Middleware, Before, Router, OpenApi } from "@aom-js/router";
import { BodyOptions, BODY_OPTIONS_MARKER } from "@aom-js/api";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });

describe("api: @BodyOptions", () => {
  it("маркер попадает в route.markers собранного маршрута", () => {
    @Controller()
    class App {
      @Get("/limited")
      @BodyOptions({ limit: 2048 })
      static async limited() {}
    }

    const router = new Router(App, makeDocs());
    const route = router.routes.find((r) => r.path === "/limited")!;
    expect(route.markers[BODY_OPTIONS_MARKER]).toEqual({ limit: 2048 });
  });

  it("маршрут без декоратора не получает маркер", () => {
    @Controller()
    class App {
      @Get("/plain")
      static async plain() {}
    }

    const router = new Router(App, makeDocs());
    const route = router.routes.find((r) => r.path === "/plain")!;
    expect(route.markers[BODY_OPTIONS_MARKER]).toBeUndefined();
  });

  it("лимит эндпоинта перекрывает больший лимит middleware", () => {
    @Controller()
    class App {
      @Middleware()
      @BodyOptions({ limit: 4096 })
      static async Mw() {}

      @Get("/override-down")
      @Before(App.Mw)
      @BodyOptions({ limit: 1024 })
      static async endpoint() {}
    }

    const router = new Router(App, makeDocs());
    const route = router.routes.find((r) => r.path === "/override-down")!;
    expect(route.markers[BODY_OPTIONS_MARKER]).toEqual({ limit: 1024 });
  });

  it("лимит эндпоинта перекрывает меньший лимит middleware", () => {
    @Controller()
    class App {
      @Middleware()
      @BodyOptions({ limit: 512 })
      static async Mw() {}

      @Get("/override-up")
      @Before(App.Mw)
      @BodyOptions({ limit: 8192 })
      static async endpoint() {}
    }

    const router = new Router(App, makeDocs());
    const route = router.routes.find((r) => r.path === "/override-up")!;
    expect(route.markers[BODY_OPTIONS_MARKER]).toEqual({ limit: 8192 });
  });
});
