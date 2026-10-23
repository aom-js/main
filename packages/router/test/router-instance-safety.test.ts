import { describe, it, expect } from "vitest";
import {
  Controller,
  Get,
  Middleware,
  Router,
  OpenApi,
  This,
  OnInstance,
  HttpContextValues,
  Run,
  Headers,
  State,
  FwdRef,
  HandlerFunction,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ title: "t", version: "1" });

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

// сигнал вместо таймера: сценарии гонок воспроизводятся точками синхронизации, а не паузами
function signal() {
  let done!: () => void;
  const promise = new Promise<void>((resolve) => (done = resolve));
  return { promise, done };
}

type StateMap = { get(target: unknown): unknown };

// инстанс попадает в общую карту запроса только после того, как его хуки (проверки доступа
// в том числе) прошли; до этого его видит лишь код того самого класса
describe("router: непроверенный инстанс не виден чужому коду", () => {
  it("@State() без аргумента не показывает инстанс, чьи хуки ещё идут", async () => {
    const constructed = signal();
    const inspected = signal();
    let snapshot: unknown = "не смотрели";

    @Controller()
    class Auth {
      token = "PRIVATE-TOKEN";

      // хук выполняется уже после конструктора: к этому моменту инстанс существует
      @OnInstance()
      static async verify() {
        constructed.done();
        await inspected.promise;
      }
    }

    @Controller()
    class App {
      @OnInstance()
      static async pull(@This(Auth) _auth: Auth) {}

      @OnInstance()
      static async peek(@State() state: StateMap) {
        await constructed.promise;
        snapshot = state.get(Auth);
        inspected.done();
      }

      @Get("/state-map")
      static async stateMap(@State(Auth) auth: Auth) {
        return auth.token;
      }
    }

    const router = new Router(App, makeDocs());
    expect(await router.routeOf(App.stateMap).apply(makeContext())).toBe("PRIVATE-TOKEN");
    expect(snapshot).toBeUndefined(); // во время хуков карта Auth не содержала
  });

  it("чужой хук не запускает middleware класса, чья проверка ещё идёт (и отказала)", async () => {
    const log: string[] = [];

    @Controller()
    class Auth {
      @Middleware()
      static async Privileged() {
        log.push("Auth.Privileged");
      }

      @OnInstance()
      static async Verify() {
        await Promise.resolve();
        log.push("Auth.Verify:deny");
        throw new Error("401");
      }
    }

    @Controller()
    class App {
      @OnInstance()
      static async pull(@This(Auth) _auth: Auth) {}

      @OnInstance()
      static async work(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await next(Auth.Privileged).catch((error: Error) => log.push(`work:${error.message}`));
      }

      @Get("/foreign-middleware")
      static async foreignMiddleware() {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.foreignMiddleware).apply(makeContext())).rejects.toThrow("401");
    expect(log).toEqual(["Auth.Verify:deny", "work:401"]);
  });

  it("чужая middleware через next() из хука класса получает ошибку цикла, а не инстанс", async () => {
    const captured: unknown[] = [];

    @Controller()
    class Auth {
      token = "PRIVATE-TOKEN";

      @OnInstance()
      static async audit(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await next(Reporter.report);
      }

      @Get("/audit")
      static async audit_() {
        return "ok";
      }
    }

    @Controller()
    class Reporter {
      @Middleware()
      static async report(@This(Auth) auth: Auth) {
        captured.push(auth);
      }
    }

    const router = new Router(Auth, makeDocs());
    const error = await router.routeOf(Auth.audit_).apply(makeContext()).catch((e: Error) => e);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
    expect((error as Error).message).toContain("Auth");
    expect(captured).toEqual([]);
  });

  it("хук чужого класса, поднятого через next(), получает ошибку цикла, а не инстанс", async () => {
    const captured: unknown[] = [];

    @Controller()
    class Auth {
      token = "PRIVATE-TOKEN";

      @OnInstance()
      static async link(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await next(Profile.load);
      }

      @Get("/link")
      static async link_() {
        return "ok";
      }
    }

    @Controller()
    class Profile {
      @OnInstance()
      static async useAuth(@This(Auth) auth: Auth) {
        captured.push(auth);
      }

      @Middleware()
      static async load() {}
    }

    const router = new Router(Auth, makeDocs());
    const error = await router.routeOf(Auth.link_).apply(makeContext()).catch((e: Error) => e);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
    expect((error as Error).message).toContain("Profile");
    expect(captured).toEqual([]);
  });

  it("чужой класс ждёт окончания хуков: при успехе — проверенный инстанс, при отказе — та же ошибка", async () => {
    @Controller()
    class Auth {
      verified = false;

      @OnInstance()
      static async Verify(@Headers("authorization") token: string, @This() self: Auth) {
        if (token !== "ok") throw new Error("401");
        self.verified = true;
      }
    }

    @Controller()
    class App {
      @Get("/verified")
      static async verified(@This(Auth) auth: Auth) {
        return auth.verified;
      }
    }

    const router = new Router(App, makeDocs());
    const authorized = makeContext({ headers: { authorization: "ok" } });
    expect(await router.routeOf(App.verified).apply(authorized)).toBe(true);
    await expect(router.routeOf(App.verified).apply(makeContext())).rejects.toThrow("401");
  });
});

describe("router: собственный код класса работает во время его хуков", () => {
  it("@This() в своём хуке отдаёт инстанс сразу, next() своей middleware не виснет", async () => {
    const log: string[] = [];

    @Controller()
    class Auth {
      token = "PRIVATE-TOKEN";

      @Middleware()
      static async Privileged(
        @This() self: Auth,
        @Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>,
      ) {
        log.push(`Privileged:${self.token}`);
        await next(Auth.Deep); // вложенный next() из уже вложенного вызова
      }

      @Middleware()
      static async Deep(@This(Auth) self: Auth) {
        log.push(`Deep:${self.token}`);
      }

      @OnInstance()
      static async load(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
        await next(Auth.Privileged);
      }

      @OnInstance()
      static async self(@This() self: Auth) {
        log.push(`self:${self instanceof Auth}`);
      }

      @Get("/own")
      static async own() {
        return log;
      }
    }

    const router = new Router(Auth, makeDocs());
    expect(await router.routeOf(Auth.own).apply(makeContext())).toEqual([
      "self:true",
      "Privileged:PRIVATE-TOKEN",
      "Deep:PRIVATE-TOKEN",
    ]);
  });
});

// цикл — это ошибка определения классов: раньше он либо тихо отдавал непроверенный инстанс,
// либо вешал запрос, либо рвал стек рекурсией
describe("router: циклические зависимости инстансов", () => {
  it("взаимные хуки двух классов дают ошибку с именами классов", async () => {
    const captured: unknown[] = [];

    @Controller()
    class A {
      mark = "A";

      @OnInstance()
      static async needB(@This(FwdRef(() => B)) _b: unknown) {}

      @Get("/hooks-cycle")
      static async hooksCycle() {
        return "ok";
      }
    }

    @Controller()
    class B {
      @OnInstance()
      static async needA(@This(A) a: A) {
        captured.push(a);
      }
    }

    const router = new Router(A, makeDocs());
    const error = await router.routeOf(A.hooksCycle).apply(makeContext()).catch((e: Error) => e);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
    expect((error as Error).message).toContain("A -> B -> A");
    expect(captured).toEqual([]);
  });

  it("цикл «конструктор — хук» даёт ошибку, а не зависание запроса", async () => {
    @Controller()
    class A {
      constructor(@This(FwdRef(() => B)) _b: unknown) {}

      @Get("/ctor-hook-cycle")
      static async ctorHookCycle() {
        return "ok";
      }
    }

    @Controller()
    class B {
      @OnInstance()
      static async needA(@This(A) _a: A) {}
    }

    const router = new Router(A, makeDocs());
    const error = await router.routeOf(A.ctorHookCycle).apply(makeContext()).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
    expect((error as Error).message).toContain("A -> B -> A");
  });

  it("взаимные @This в конструкторах дают ошибку, а не переполнение стека", async () => {
    @Controller()
    class A {
      constructor(@This(FwdRef(() => B)) _b: unknown) {}
    }

    @Controller()
    class B {
      constructor(@This(A) _a: A) {}
    }

    @Controller()
    class App {
      @Get("/ctor-cycle")
      static async ctorCycle(@This(B) _b: B) {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const error = await router.routeOf(App.ctorCycle).apply(makeContext()).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
    expect((error as Error).message).toContain("B -> A -> B");
  });

  it("встречное ожидание двух веток (@This в конструкторах соседних аргументов) — ошибка", async () => {
    @Controller()
    class A {
      constructor(@This(FwdRef(() => B)) _b: unknown) {}
    }

    @Controller()
    class B {
      constructor(@This(A) _a: A) {}
    }

    @Controller()
    class App {
      @Get("/pair-cycle")
      static async pairCycle(@This(A) _a: A, @This(B) _b: B) {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const error = await router.routeOf(App.pairCycle).apply(makeContext()).catch((e: Error) => e);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
  });

  // ветка ждёт сразу нескольких созданий - аргументы конструктора и хуки
  // экземпляра исполняются параллельно. Пока граф помнил по одному ожиданию на ветку, второе
  // затирало первое, и цикл, замыкавшийся через забытое ребро, вешал запрос вместо ошибки
  it("цикл распознаётся, даже когда ждущая ветка ждёт ещё одно создание", async () => {
    // долгая проверка: класс остаётся в процессе создания, когда его попросят вторым
    @Controller()
    class Slow {
      @OnInstance()
      static async hold() {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    @Controller()
    class Waiting {
      @OnInstance()
      static async needsAsker(@This(FwdRef(() => Asker)) _asker: unknown) {}
    }

    // конструктор ждёт двоих сразу: обоих создают соседние ветки эндпоинта
    @Controller()
    class Asker {
      constructor(
        @This(Waiting) public waiting: Waiting,
        @This(Slow) public slow: Slow,
      ) {}
    }

    @Controller()
    class App {
      // три ветки стартуют параллельно
      @Get("/forgotten-edge")
      static async forgottenEdge(
        @This(Waiting) _w: Waiting,
        @This(Slow) _s: Slow,
        @This(Asker) _a: Asker,
      ) {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    // гонка со временем: до исправления запрос не завершался вовсе, и тест должен падать
    // по несовпадению, а не висеть до таймаута vitest
    const outcome = await Promise.race([
      router.routeOf(App.forgottenEdge).apply(makeContext()).then(
        () => "resolved",
        (e: Error) => e.message,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);
    expect(outcome).toContain("CIRCULAR_INSTANCE_ERROR");
    expect(outcome).toContain("Waiting -> Asker -> Waiting");
  });
});

// рабочие примеры рецепта docs/cookbook/this-and-instances.md: здесь они исполняются, чтобы
// текст рецепта не разошёлся с поведением кода
describe("router: @This(class) в конструкторе зависимого класса", () => {
  it("конструктор зависимого класса получает уже проверенный инстанс", async () => {
    const log: string[] = [];

    @Controller()
    class Auth {
      token = "SECRET";

      verified = false;

      @OnInstance()
      static async Verify(@This() self: Auth, @Headers("authorization") token: string) {
        // пауза изображает поход в базу: раньше именно в этом окне чужой код успевал
        // забрать инстанс из общей карты запроса
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (token !== "ok") throw new Error("401");
        self.verified = true;
        log.push("Auth.Verify");
      }
    }

    @Controller()
    class Dependent {
      constructor(@This(Auth) public auth: Auth) {
        log.push(`Dependent:${auth.verified}`);
      }
    }

    @Controller()
    class App {
      @Get("/dependent")
      static async dependent(@This(Dependent) dep: Dependent) {
        return `${dep.auth.token}/${dep.auth.verified}`;
      }
    }

    const router = new Router(App, makeDocs());
    const authorized = makeContext({ headers: { authorization: "ok" } });
    expect(await router.routeOf(App.dependent).apply(authorized)).toBe("SECRET/true");
    // конструктор дождался хука и увидел заполненный им инстанс, а не пустой
    expect(log).toEqual(["Auth.Verify", "Dependent:true"]);
  });

  it("отказ проверки не даёт выполниться конструктору зависимого класса", async () => {
    const log: string[] = [];

    @Controller()
    class Auth {
      @OnInstance()
      static async Verify(@Headers("authorization") token: string) {
        if (token !== "ok") throw new Error("401");
      }
    }

    @Controller()
    class Dependent {
      constructor(@This(Auth) public auth: Auth) {
        log.push("Dependent");
      }
    }

    @Controller()
    class App {
      @Get("/denied")
      static async denied(@This(Dependent) _dep: Dependent) {
        log.push("endpoint");
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    await expect(router.routeOf(App.denied).apply(makeContext())).rejects.toThrow("401");
    // ни конструктор зависимого класса, ни эндпоинт не выполнялись вовсе
    expect(log).toEqual([]);
  });

  it("класс, созданный изнутри хука, видит создателя ещё не проверенным", async () => {
    let seen: boolean | undefined;

    @Controller()
    class Auth {
      verified = false;

      @OnInstance()
      static async Verify(@This() self: Auth, @This(FwdRef(() => Sidecar)) _side: unknown) {
        self.verified = true;
      }
    }

    @Controller()
    class Sidecar {
      // Sidecar создаётся аргументом хука самого Auth, то есть внутри его собственной ветки
      // создания: запереть эту ветку нельзя - класс запер бы сам себя
      constructor(@This(Auth) auth: Auth) {
        seen = auth.verified;
      }
    }

    @Controller()
    class App {
      @Get("/sidecar")
      static async sidecar(@This(Auth) auth: Auth) {
        return auth.verified;
      }
    }

    const router = new Router(App, makeDocs());
    // наружу Auth выходит проверенным, но внутри его ветки создания Sidecar увидел его до проверки
    expect(await router.routeOf(App.sidecar).apply(makeContext())).toBe(true);
    expect(seen).toBe(false);
  });

  it("та же пара классов, запрошенная эндпоинтом параллельно, даёт ошибку цикла", async () => {
    @Controller()
    class Auth {
      @OnInstance()
      static async Verify(@This(FwdRef(() => Sidecar)) _side: unknown) {}
    }

    @Controller()
    class Sidecar {
      constructor(@This(Auth) _auth: Auth) {}
    }

    @Controller()
    class App {
      // порядок решает: здесь Sidecar создаёт эндпоинт, а не хук Auth, поэтому обращение
      // хука к Sidecar становится встречным ожиданием, а не своей веткой
      @Get("/both")
      static async both(@This(Sidecar) _side: Sidecar, @This(Auth) _auth: Auth) {
        return "ok";
      }
    }

    const router = new Router(App, makeDocs());
    const error = await router.routeOf(App.both).apply(makeContext()).catch((e: Error) => e);
    expect((error as Error).message).toContain("CIRCULAR_INSTANCE_ERROR");
  });
});
