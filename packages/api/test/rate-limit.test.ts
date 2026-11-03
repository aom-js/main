import { describe, it, expect } from "vitest";
import {
  RateLimit,
  RateLimiterMemory,
  RateLimiterRes,
  TooManyRequestsResponse,
} from "@aom-js/api";
import {
  After,
  Before,
  Controller,
  Middleware,
  OpenApi,
  Post,
  Router,
  This,
  type HttpContextValues,
} from "@aom-js/router";
import { ERROR_TOO_MANY_REQUESTS } from "../src/constants/messages/errors";
import {
  CONTROLLERS_RATE_LIMIT_NO_KEY,
  CONTROLLERS_RATE_LIMIT_NO_LIMITER,
} from "../src/constants/messages/controllers";

// заглушка ответа: запоминает заголовки
function fakeRes() {
  const headers: Record<string, string> = {};
  return { res: { setHeader: (name: string, value: string) => (headers[name] = value) }, headers };
}

const context = (res: unknown): HttpContextValues => ({
  ctx: { req: {}, res }, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

describe("RateLimit", () => {
  it("библиотека отдаётся из @aom-js/api", async () => {
    expect(typeof RateLimiterMemory).toBe("function");
    const res = await new RateLimiterMemory({ points: 1, duration: 60 }).consume("k");
    expect(res).toBeInstanceOf(RateLimiterRes);
  });

  it("TooManyRequestsResponse — статус 429", () => {
    expect(new TooManyRequestsResponse(ERROR_TOO_MANY_REQUESTS).status).toBe(429);
    expect(JSON.stringify(TooManyRequestsResponse.JSONSchema())).toContain("429");
  });

  it("в пределах лимита проходит, сверх — 429 и Retry-After", async () => {
    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 2, duration: 60 });

      @Middleware()
      @After(ByIp.Apply)
      static async ByKey(@This() self: ByIp) {
        self.key = "ip";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.ByKey)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const { res, headers } = fakeRes();
    expect(await route.apply(context(res))).toBe("ok");
    expect(await route.apply(context(res))).toBe("ok");
    await expect(route.apply(context(res))).rejects.toMatchObject({ status: 429 });
    expect(headers["Retry-After"]).toMatch(/^[1-9]\d*$/);
  });

  it("два наследника считают независимо", async () => {
    @Controller()
    class A extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 2, duration: 60 });

      @Middleware()
      @After(A.Apply)
      static async ByKey(@This() self: A) {
        self.key = "k";
      }
    }

    @Controller()
    class B extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 5, duration: 60 });

      @Middleware()
      @After(B.Apply)
      static async ByKey(@This() self: B) {
        self.key = "k";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(A.ByKey, B.ByKey)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const { res } = fakeRes();
    await route.apply(context(res));
    await route.apply(context(res));
    await expect(route.apply(context(res))).rejects.toMatchObject({ status: 429 });
    // отказ A не списывает у B: B посчитал только два пропущенных запроса
    expect((await B.Limiter.get("k"))?.consumedPoints).toBe(2);
  });

  it("ошибка хранилища пробрасывается как есть", async () => {
    @Controller()
    class Broken extends RateLimit {
      static readonly Limiter = { consume: () => Promise.reject(new Error("store down")) } as never;

      @Middleware()
      @After(Broken.Apply)
      static async ByKey(@This() self: Broken) {
        self.key = "k";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(Broken.ByKey)
      static async X() {}
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const failure = route.apply(context(fakeRes().res));
    await expect(failure).rejects.toThrow("store down");
    await expect(failure).rejects.not.toMatchObject({ status: 429 });
  });

  it("без ключа — ошибка разработчика", async () => {
    let key: string | null = null;

    @Controller()
    class NoKey extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 2, duration: 60 });

      @Middleware()
      @After(NoKey.Apply)
      static async ByKey(@This() self: NoKey) {
        self.key = key;
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(NoKey.ByKey)
      static async X() {}
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    await expect(route.apply(context(fakeRes().res))).rejects.toThrow(CONTROLLERS_RATE_LIMIT_NO_KEY);
    key = "";
    await expect(route.apply(context(fakeRes().res))).rejects.toThrow(CONTROLLERS_RATE_LIMIT_NO_KEY);
  });

  it("без Limiter — ошибка разработчика", async () => {
    @Controller()
    class NoLimiter extends RateLimit {
      @Middleware()
      @After(NoLimiter.Apply)
      static async ByKey(@This() self: NoLimiter) {
        self.key = "k";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(NoLimiter.ByKey)
      static async X() {}
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    await expect(route.apply(context(fakeRes().res))).rejects.toThrow(
      CONTROLLERS_RATE_LIMIT_NO_LIMITER,
    );
  });

  it("без setHeader у ctx.res — всё равно 429", async () => {
    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 1, duration: 60 });

      @Middleware()
      @After(ByIp.Apply)
      static async ByKey(@This() self: ByIp) {
        self.key = "ip";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.ByKey)
      static async X() {}
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    await route.apply(context({}));
    await expect(route.apply(context({}))).rejects.toMatchObject({ status: 429 });
  });

  it("Retry-After не меньше 1", async () => {
    @Controller()
    class Almost extends RateLimit {
      static readonly Limiter = {
        consume: () => Promise.reject(new RateLimiterRes(0, 1)),
      } as never;

      @Middleware()
      @After(Almost.Apply)
      static async ByKey(@This() self: Almost) {
        self.key = "k";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(Almost.ByKey)
      static async X() {}
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const { res, headers } = fakeRes();
    await expect(route.apply(context(res))).rejects.toMatchObject({ status: 429 });
    expect(headers["Retry-After"]).toBe("1");
  });

  it("429 в OpenAPI маршрута", () => {
    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 1, duration: 60 });

      @Middleware()
      @After(ByIp.Apply)
      static async ByKey(@This() self: ByIp) {
        self.key = "ip";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.ByKey)
      static async X() {}
    }

    const docs = new OpenApi({ title: "t", version: "1" });
    new Router(Root, docs);
    expect(docs.toJSON().paths["/x"].post.responses["429"]).toBeDefined();
  });
});
