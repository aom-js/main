import { describe, it, expect } from "vitest";
import {
  Controller, Get, Middleware, Before, After, Router, OpenApi,
  Query, Body, Err, This, OnInstance, HttpContextValues,
  Run, Headers, State, Args, HandlerFunction, AomApi,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ title: "t", version: "1" });

const makeContext = (partial: Partial<HttpContextValues> = {}): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
  ...partial,
});

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
    const result = await router.routeOf(App.hello).apply(makeContext({ query: { name: "aom" } }));
    expect(result).toBe("hi aom");
    expect(calls).toEqual(["guard", "endpoint"]);
  });

  it("наследование: Before родителя выполняется ДО Before потомка (InheritPlacement.PREPEND)", async () => {
    const calls: string[] = [];

    class M {
      @Middleware()
      static async parentBefore() {
        calls.push("parent-before");
      }

      @Middleware()
      static async childBefore() {
        calls.push("child-before");
      }

      @Middleware()
      static async parentAfter() {
        calls.push("parent-after");
      }

      @Middleware()
      static async childAfter() {
        calls.push("child-after");
      }
    }

    @Controller()
    @Before(M.parentBefore)
    @After(M.parentAfter)
    class Base {}

    @Controller()
    @Before(M.childBefore)
    @After(M.childAfter)
    class App extends Base {
      @Get("/ping")
      static async ping() {
        calls.push("endpoint");
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.ping).apply(makeContext());
    expect(result).toBe("ok");
    // Before: родитель первым (PREPEND); After: родитель последним (APPEND, как раньше)
    expect(calls).toEqual([
      "parent-before",
      "child-before",
      "child-after",
      "parent-after",
      "endpoint",
    ]);
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
    const result = await router.routeOf(App.secure).apply(makeContext());
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
    await expect(router.routeOf(App.fail).apply(makeContext())).rejects.toMatchObject({
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
    await expect(router.routeOf(App.explode).apply(makeContext())).rejects.toThrow("crashed");
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
    const result = await router.routeOf(App.echo).apply(
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
    const first = await router.routeOf(App.me).apply(makeContext({ query: { user: "alice" } }));
    expect(first).toEqual({ who: "alice" });
    expect(hookLog).toEqual(["init:alice"]); // хук вызван однократно

    const second = await router.routeOf(App.me).apply(makeContext({ query: { user: "bob" } }));
    expect(second).toEqual({ who: "bob" }); // новый запрос — новый инстанс
    expect(hookLog).toEqual(["init:alice", "init:bob"]);
  });

  it("потомок со своим конструктором получает свои аргументы, а не родительские", async () => {
    @Controller()
    class P {
      v: string;
      constructor(@Query("p") p: string) {
        this.v = `P:${p}`;
      }
    }

    @Controller()
    class C extends P {
      constructor(@Query("c") c: string) {
        super(c);
      }
    }

    @Controller()
    class App {
      @Get("/x")
      static async x(@This(C) c: C) {
        return c.v;
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.x).apply(
      makeContext({ query: { p: "fromP", c: "fromC" } }),
    );
    expect(result).toBe("P:fromC");
  });

  // аргументы метода решаются конкурентно (Promise.all): идущее создание хранится в context.pending,
  // и повторный @This того же класса ждёт его, а не создаёт второй инстанс
  it("два @This одного класса в одном методе дают один инстанс и один вызов @OnInstance", async () => {
    let hooks = 0;

    @Controller()
    class Service {
      constructor(@Query("user") public who: string) {}

      @OnInstance()
      static async init() {
        hooks += 1;
      }
    }

    @Controller()
    class App {
      @Get("/pair")
      static async pair(@This(Service) a: Service, @This(Service) b: Service) {
        return { same: a === b };
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.pair).apply(makeContext({ query: { user: "x" } }));
    expect(result).toEqual({ same: true });
    expect(hooks).toBe(1);
  });

  it("класс, нужный методу и конструктору другого @This-класса, создаётся один раз", async () => {
    let created = 0;

    class Data {
      constructor() {
        created += 1;
      }
    }

    @Controller()
    class Value {
      constructor(@This(Data) public data: Data) {}
    }

    @Controller()
    class App {
      @Get("/deps")
      static async deps(@This(Data) data: Data, @This(Value) value: Value) {
        return { same: data === value.data };
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.deps).apply(makeContext());
    expect(result).toEqual({ same: true });
    expect(created).toBe(1);
  });

  it("перехваченная ошибка конструктора не пускает следующий курсор того же класса без инстанса", async () => {
    @Controller()
    class Auth {
      constructor(@Headers("authorization") token: string) {
        if (token !== "ok") throw new Error("401");
      }

      @Middleware()
      static async Required() {}
    }

    // необязательная авторизация: ошибку проверки перехватывает и продолжает цепочку
    @Controller()
    class Optional {
      @Middleware()
      static async Check(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        try {
          await next(Auth.Required);
        } catch {
          // гость — идём дальше
        }
      }
    }

    @Controller()
    @Before(Optional.Check, Auth.Required)
    class App {
      @Get("/secret")
      static async secret() {
        return "secret";
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.secret).apply(makeContext())).rejects.toThrow("401");
    const authorized = makeContext({ headers: { authorization: "ok" } });
    expect(await router.routeOf(App.secret).apply(authorized)).toBe("secret");
  });

  it("два @This класса с падающим конструктором: конструктор вызван один раз, запрос отклонён его ошибкой", async () => {
    let created = 0;

    class Broken {
      constructor() {
        created += 1;
        throw new Error("ctor-boom");
      }
    }

    @Controller()
    class App {
      @Get("/broken")
      static async broken(@This(Broken) a: Broken, @This(Broken) b: Broken) {
        return { a, b };
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.broken).apply(makeContext())).rejects.toThrow("ctor-boom");
    expect(created).toBe(1);
  });

  it("@State(X) во время создания X видит только готовые инстансы, а не промис создания", async () => {
    class Slow {}

    @Controller()
    class App {
      @Get("/state")
      static async state(
        @This(Slow) slow: Slow,
        @State(Slow) fromState: Slow | undefined,
        @Args(({ context }) => ({ raw: context.state.get(Slow) })) holder: { raw: unknown },
      ) {
        return { slow, fromState, raw: holder.raw };
      }
    }

    const router = new Router(App, makeDocs());
    const result = await router.routeOf(App.state).apply(makeContext());
    expect(result.slow).toBeInstanceOf(Slow);
    expect(result.fromState).toBeUndefined();
    expect(result.raw).toBeUndefined();
  });

  it("курсор класса, чьё создание уже идёт, ждёт готового инстанса", async () => {
    const order: string[] = [];

    @Controller()
    class Slow {
      constructor(@Args(() => new Promise((resolve) => setTimeout(resolve, 5))) _: unknown) {
        order.push("Slow:ctor");
      }

      @Middleware()
      static async Check() {
        order.push("Slow.Check");
      }
    }

    // хук Fast запускает курсор Slow, пока Slow ещё создаётся параллельным @This
    @Controller()
    class Fast {
      @OnInstance()
      static async init(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await next(Slow.Check);
      }
    }

    @Controller()
    class App {
      @Get("/sequence")
      static async sequence(@This(Slow) _slow: Slow, @This(Fast) _fast: Fast) {
        return order;
      }
    }

    const router = new Router(App, makeDocs());
    expect(await router.routeOf(App.sequence).apply(makeContext())).toEqual(["Slow:ctor", "Slow.Check"]);
  });

  it("перехваченная ошибка хука-проверки не пускает следующий курсор того же класса без авторизации", async () => {
    let checks = 0;

    @Controller()
    class Auth {
      @OnInstance()
      static async Verify(@Headers("authorization") token: string) {
        checks += 1;
        if (token !== "ok") throw new Error("401");
      }

      @Middleware()
      static async Required() {}
    }

    // необязательная авторизация: ошибку проверки перехватывает и продолжает цепочку
    @Controller()
    class Optional {
      @Middleware()
      static async Check(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        try {
          await next(Auth.Required);
        } catch {
          // гость — идём дальше
        }
      }
    }

    @Controller()
    @Before(Optional.Check, Auth.Required)
    class App {
      @Get("/secret")
      static async secret() {
        return "secret";
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.secret).apply(makeContext())).rejects.toThrow("401");
    expect(checks).toBe(1); // отказ запомнен до конца запроса: Auth.Required получает ту же ошибку
    const authorized = makeContext({ headers: { authorization: "ok" } });
    expect(await router.routeOf(App.secret).apply(authorized)).toBe("secret");
  });

  it("отказ хука-проверки запоминается до конца запроса: соседний хук не пересоздаёт класс в фоне", async () => {
    let checks = 0;

    @Controller()
    class Auth {
      @OnInstance()
      static async Verify(@Headers("authorization") token: string) {
        checks += 1;
        if (token !== "ok") throw new Error("401");
      }

      // соседний хук после паузы снова обращается к Auth через класс с @This(Auth)
      @OnInstance()
      static async Audit(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await new Promise((resolve) => setImmediate(resolve));
        await next(AuditLog.write);
      }
    }

    @Controller()
    class AuditLog {
      @Middleware()
      static async write(@This(Auth) _auth: Auth) {}
    }

    @Controller()
    class App {
      @Get("/audit")
      static async audit(@This(Auth) _auth: Auth) {
        return "done";
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.audit).apply(makeContext())).rejects.toThrow("401");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checks).toBe(1);
  });

  it("повторное обращение к классу после отказа в том же запросе получает ту же ошибку", async () => {
    let created = 0;

    class Broken {
      constructor() {
        created += 1;
        throw new Error(`ctor-boom-${created}`);
      }
    }

    @Controller()
    class Probe {
      @Middleware()
      static async use(@This(Broken) _broken: Broken) {}
    }

    @Controller()
    class App {
      @Get("/again")
      static async again(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        const first = await next(Probe.use).catch((error: Error) => error.message);
        const second = await next(Probe.use).catch((error: Error) => error.message);
        return { first, second, created };
      }
    }

    const router = new Router(App, makeDocs());
    expect(await router.routeOf(App.again).apply(makeContext())).toEqual({
      first: "ctor-boom-1",
      second: "ctor-boom-1",
      created: 1,
    });
  });

  it("CURSOR_NOT_EXECUTABLE_ERROR: endpoint, переподвешенный через Reflect.decorate без дескриптора, роняет маршрут громко, а не исполняет пустышку", async () => {
    // miniature of the tickets' ResponseByType pattern: a decorator re-applies @Get
    // via a 3-argument Reflect.decorate — the polyfill hands the decorator
    // `descriptor = undefined`, @Get assigns it to element.descriptor, and before the
    // fail-closed guard the endpoint body was silently skipped (the bug class that once left a class-level access gate unexecuted)
    const Relay = AomApi.methodDecorator(($) => {
      const { target, property } = $._;
      Reflect.decorate([Get("/replayed")], target, property!);
    });

    @Controller()
    class App {
      @Relay
      static async index() {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const error = await router.routeOf(App.index).apply(makeContext()).then(
      () => {
        throw new Error("ожидали CURSOR_NOT_EXECUTABLE_ERROR");
      },
      (e: Error) => e,
    );
    expect(error.message).toContain("CURSOR_NOT_EXECUTABLE_ERROR");
    expect(error.message).toContain("App.index");
  });
});
