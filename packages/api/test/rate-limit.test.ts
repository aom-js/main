import { describe, it, expect } from "vitest";
import {
  RateLimit,
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  TooManyRequestsResponse,
  WrongDataResponse,
  type HttpCtx,
} from "@aom-js/api";
import {
  After,
  Before,
  Body,
  Controller,
  Ctx,
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

const context = (res: unknown, req: object = {}, body: object = {}): HttpContextValues => ({
  ctx: { req, res }, req, res: {}, body, files: {}, query: {},
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

  // см. https://aom.js.org/cookbook/rate-limit/#один-лимит-по-ip-адресу
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

  // см. https://aom.js.org/cookbook/rate-limit/#в-тестах-сброс-счётчика
  it("сброс счётчика в тесте: Limiter.delete(ключ) без keyPrefix", async () => {
    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ keyPrefix: "ip", points: 1, duration: 60 });

      @Middleware()
      @After(ByIp.Apply)
      static async Key(@Ctx() ctx: HttpCtx, @This() self: ByIp) {
        self.key = ctx.req.socket.remoteAddress ?? null;
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.Key)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const request = (address: string) =>
      route.apply(context(fakeRes().res, { socket: { remoteAddress: address } }));
    const address = "203.0.113.5";
    expect(await request(address)).toBe("ok");
    await expect(request(address)).rejects.toMatchObject({ status: 429 });
    await ByIp.Limiter.delete(address);
    expect(await request(address)).toBe("ok");
  });

  // см. https://aom.js.org/cookbook/rate-limit/#память-и-база
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

  // см. https://aom.js.org/cookbook/rate-limit/#антипример-флаг-для-тестов
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
    // и вовсе без ctx.res
    await expect(route.apply(context(undefined))).rejects.toMatchObject({ status: 429 });
  });

  it("Retry-After не меньше 1", async () => {
    let refusal = new RateLimiterRes(0, 1);

    @Controller()
    class Almost extends RateLimit {
      static readonly Limiter = {
        consume: () => Promise.reject(refusal),
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
    // ноль мс до сброса: Math.ceil даёт 0, заголовок всё равно «1»
    headers["Retry-After"] = "";
    refusal = new RateLimiterRes(0, 0);
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

  // см. https://aom.js.org/cookbook/rate-limit/#один-лимит-по-ip-адресу
  it("лимит по IP-адресу из сокета: у каждого адреса свой счётчик", async () => {
    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 2, duration: 60 });

      @Middleware()
      @After(ByIp.Apply)
      static async Key(@Ctx() ctx: HttpCtx, @This() self: ByIp) {
        self.key = ctx.req.socket.remoteAddress ?? null;
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.Key)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const from = (ip: string) => context(fakeRes().res, { socket: { remoteAddress: ip } });
    await route.apply(from("1.1.1.1"));
    await route.apply(from("1.1.1.1"));
    await expect(route.apply(from("1.1.1.1"))).rejects.toMatchObject({ status: 429 });
    expect(await route.apply(from("2.2.2.2"))).toBe("ok");
    // сокет без адреса — ключа нет: ошибка разработчика, а не пропуск
    await expect(route.apply(context(fakeRes().res, { socket: {} }))).rejects.toThrow(
      CONTROLLERS_RATE_LIMIT_NO_KEY,
    );
  });

  // см. https://aom.js.org/cookbook/rate-limit/#каскад-из-двух-лимитов
  it("каскад: общий лимит по IP, затем лимит по логину из тела", async () => {
    @Controller()
    class IpLimit extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 4, duration: 60 });

      @Middleware()
      @After(IpLimit.Apply)
      static async ByIp(@Ctx() ctx: HttpCtx, @This() self: IpLimit) {
        self.key = ctx.req.socket.remoteAddress ?? null;
      }
    }

    @Controller()
    class LoginLimit extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 2, duration: 60 });

      @Middleware()
      @After(LoginLimit.Apply)
      static async ByLogin(@This() self: LoginLimit, @Body() body: { login?: string }) {
        self.key = body.login ?? null;
      }
    }

    @Controller()
    class Auth {
      @Post("/login")
      @Before(IpLimit.ByIp, LoginLimit.ByLogin)
      static async login() {
        return "ok";
      }
    }

    const route = new Router(Auth, new OpenApi({ title: "t", version: "1" })).routeOf(Auth.login);
    const attempt = (ip: string, login: string) =>
      route.apply(context(fakeRes().res, { socket: { remoteAddress: ip } }, { login }));

    await attempt("1.1.1.1", "ann");
    await attempt("1.1.1.1", "ann");
    // логин «ann» исчерпан, хотя адрес ещё не на пределе
    await expect(attempt("1.1.1.1", "ann")).rejects.toMatchObject({ status: 429 });
    // тот же логин с другого адреса — тоже отказ: счёт по логину общий для всех адресов
    await expect(attempt("9.9.9.9", "ann")).rejects.toMatchObject({ status: 429 });
    // другой логин с первого адреса проходит; адрес израсходовал 4 из 4 (три раза на «ann» + раз на «bob»)
    expect(await attempt("1.1.1.1", "bob")).toBe("ok");
    // пятый запрос с адреса — отказ ещё на первом шаге, до проверки логина
    await expect(attempt("1.1.1.1", "carl")).rejects.toMatchObject({ status: 429 });
    expect((await LoginLimit.Limiter.get("carl"))?.consumedPoints).toBeUndefined();
  });

  // см. https://aom.js.org/cookbook/rate-limit/#ключ-из-логина-нормализация-и-проверка-типа
  it("ключ из логина: нормализация, не строка — 400 до Apply", async () => {
    @Controller()
    class LoginLimit extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 1, duration: 60 });

      @Middleware()
      @After(LoginLimit.Apply)
      static async ByLogin(@This() self: LoginLimit, @Body() body: { login?: unknown }) {
        if (typeof body.login !== "string" || !body.login.trim()) {
          throw new WrongDataResponse("APP:LOGIN_REQUIRED");
        }
        // та же нормализация, что и при поиске учётной записи
        self.key = body.login.trim().toLowerCase();
      }
    }

    @Controller()
    class Auth {
      @Post("/login")
      @Before(LoginLimit.ByLogin)
      static async login() {
        return "ok";
      }
    }

    const route = new Router(Auth, new OpenApi({ title: "t", version: "1" })).routeOf(Auth.login);
    const attempt = (login: unknown) => route.apply(context(fakeRes().res, {}, { login }));

    expect(await attempt("Ann")).toBe("ok");
    // «ann» и " ann " — тот же счётчик, что и у «Ann»
    await expect(attempt("ann")).rejects.toMatchObject({ status: 429 });
    await expect(attempt(" ann ")).rejects.toMatchObject({ status: 429 });
    // не строка — 400 ещё до Apply: счётчик «[object Object]» не создаётся
    await expect(attempt({ a: 1 })).rejects.toMatchObject({ status: 400 });
    expect(await LoginLimit.Limiter.get("[object Object]")).toBeNull();
  });

  // см. https://aom.js.org/cookbook/rate-limit/#память-и-база
  it("хранилище из приложения: RateLimiterRedis со своим клиентом", async () => {
    // заглушка клиента ioredis: ровно то, что просит RateLimiterRedis
    const counts = new Map<string, number>();
    const redis = {
      defineCommand() {},
      rlflxIncr: async ([key, points]: string[]) => {
        const total = (counts.get(key) ?? 0) + Number(points);
        counts.set(key, total);
        return [total, 60_000];
      },
    };

    @Controller()
    class ByIp extends RateLimit {
      static readonly Limiter = new RateLimiterRedis({
        storeClient: redis,
        points: 1,
        duration: 60,
        keyPrefix: "ip",
      });

      @Middleware()
      @After(ByIp.Apply)
      static async Key(@This() self: ByIp) {
        self.key = "1.1.1.1";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByIp.Key)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const { res, headers } = fakeRes();
    expect(await route.apply(context(res))).toBe("ok");
    await expect(route.apply(context(res))).rejects.toMatchObject({ status: 429 });
    expect(headers["Retry-After"]).toBe("60");
    expect([...counts.keys()]).toEqual(["ip:1.1.1.1"]);
  });

  // см. https://aom.js.org/cookbook/rate-limit/#за-прокси
  it("за прокси: ключ — последняя запись X-Forwarded-For, левые пишет клиент", async () => {
    @Controller()
    class ByClientIp extends RateLimit {
      static readonly Limiter = new RateLimiterMemory({ points: 1, duration: 60 });

      @Middleware()
      @After(ByClientIp.Apply)
      static async Key(@Ctx() ctx: HttpCtx, @This() self: ByClientIp) {
        const forwarded = ctx.req.headers["x-forwarded-for"];
        const chain = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "").split(",");
        self.key = chain.at(-1)?.trim() || ctx.req.socket.remoteAddress || null;
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(ByClientIp.Key)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    const via = (forwarded: string) =>
      context(fakeRes().res, { headers: { "x-forwarded-for": forwarded }, socket: {} });
    expect(await route.apply(via("6.6.6.1, 203.0.113.9"))).toBe("ok");
    // клиент подменил левую часть, но прокси дописал тот же адрес справа — счётчик общий
    await expect(route.apply(via("6.6.6.2, 203.0.113.9"))).rejects.toMatchObject({ status: 429 });
    expect(await route.apply(via("6.6.6.2, 203.0.113.77"))).toBe("ok");
  });

  // см. https://aom.js.org/cookbook/rate-limit/#антипример-лимитер-в-поле-экземпляра
  it("антипример: лимитер в поле экземпляра — счётчик пуст на каждый запрос", async () => {
    @Controller()
    class Leaky extends RateLimit {
      // @ts-expect-error — TypeScript не даёт заменить геттер полем; здесь это нарочно
      limiter = new RateLimiterMemory({ points: 1, duration: 60 });

      @Middleware()
      @After(Leaky.Apply)
      static async Key(@This() self: Leaky) {
        self.key = "ip";
      }
    }

    @Controller()
    class Root {
      @Post("/x")
      @Before(Leaky.Key)
      static async X() {
        return "ok";
      }
    }

    const route = new Router(Root, new OpenApi({ title: "t", version: "1" })).routeOf(Root.X);
    // лимит в одну попытку, а проходят все: у каждого запроса свой новый лимитер
    for (let i = 0; i < 5; i++) expect(await route.apply(context(fakeRes().res))).toBe("ok");
  });
});
