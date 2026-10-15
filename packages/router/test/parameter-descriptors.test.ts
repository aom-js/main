import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  AomApi,
  AomCursor,
  Args,
  Before,
  Body,
  Controller,
  Cookies,
  Ctx,
  Cursor,
  DelayRefStack,
  Err,
  Files,
  FwdRef,
  Get,
  Headers,
  Middleware,
  OpenApi,
  Params,
  Query,
  QueryParameters,
  Req,
  Res,
  Route,
  RouteRef,
  Router,
  Run,
  Session,
  State,
  This,
  ThisRef,
  resolveTarget,
  type HttpContextValues,
  type RefFunction,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } });
const context = (): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});
const descriptorsOf = (method: Function) => AomApi.checkExists(method)!.element.parameters.descriptors;

describe("router: дескрипторы параметров", () => {
  class Target {}

  @Controller()
  class Host {
    @Middleware()
    static async All(
      @This(Target) _this: unknown,
      @State(Target) _state: unknown,
      @Run() _run: unknown,
      @Query("q") _query: unknown,
      @Body("b") _body: unknown,
      @Params("p") _params: unknown,
      @Headers("h") _headers: unknown,
      @Cookies("c") _cookies: unknown,
      @Session("s") _session: unknown,
      @Files("f") _files: unknown,
      @Cursor() _cursor: unknown,
      @Route() _route: unknown,
      @Ctx() _ctx: unknown,
      @Req() _req: unknown,
      @Res() _res: unknown,
      @Err() _err: unknown,
    ) {}
  }

  it.each([
    [0, "This", { kind: "this", ref: Target }],
    [1, "State", { kind: "state", ref: Target }],
    [2, "Run", { kind: "run" }],
    [3, "Query", { kind: "values", source: "query", ref: "q" }],
    [4, "Body", { kind: "values", source: "body", ref: "b" }],
    [5, "Params", { kind: "values", source: "params", ref: "p" }],
    [6, "Headers", { kind: "values", source: "headers", ref: "h" }],
    [7, "Cookies", { kind: "values", source: "cookies", ref: "c" }],
    [8, "Session", { kind: "values", source: "session", ref: "s" }],
    [9, "Files", { kind: "values", source: "files", ref: "f" }],
    [10, "Cursor", { kind: "cursor" }],
    [11, "Route", { kind: "route" }],
    [12, "Ctx", { kind: "ctx" }],
    [13, "Req", { kind: "req" }],
    [14, "Res", { kind: "res" }],
    [15, "Err", { kind: "err" }],
  ])("параметр %i (@%s) пишет свой дескриптор", (index, _name, expected) => {
    expect(descriptorsOf(Host.All)[index]).toEqual(expected);
  });

  it("Args(handler) без дескриптора — {kind: other}", () => {
    @Controller()
    class Custom {
      @Middleware()
      static async Step(@Args(() => 1) _value: unknown) {}
    }
    expect(descriptorsOf(Custom.Step)).toEqual([{ kind: "other" }]);
  });
});

// унаследованный шаг с ThisRef: базовый класс объявляет, наследник подставляет свои статики
class BaseShells {}
class ChildShells {}
const injected: object[] = [];

@Controller()
class BaseSteps {
  static Shells: Function = BaseShells;

  @Middleware()
  static async Step(@This(ThisRef((({ Shells }: typeof BaseSteps) => Shells) as RefFunction)) shells: object) {
    injected.push(shells);
  }
}

@Controller()
@Before(BaseSteps.Step)
class ChildSteps extends BaseSteps {
  static Shells: Function = ChildShells;

  @Get("/child")
  static async Index(@This() _self: unknown) {
    return "ok";
  }
}

describe("router: resolveTarget", () => {
  const router = new Router(ChildSteps, makeDocs());
  const [route] = router.routes;
  const stepOf = (method: Function) => route.cursors.find((c) => c.$ === AomApi.checkExists(method))!;

  it("класс — тот же класс", () => {
    expect(resolveTarget(BaseShells, route.cursors[0])).toBe(BaseShells);
  });

  it("FwdRef — результат функции", () => {
    expect(resolveTarget(FwdRef(() => ChildShells), route.cursors[0])).toBe(ChildShells);
  });

  it("ThisRef на унаследованном шаге — класс наследника", () => {
    const cursor = new AomCursor(AomApi.instance(BaseSteps.Step), AomApi.instance(ChildSteps), "/");
    expect(resolveTarget(ThisRef(), cursor)).toBe(ChildSteps);
  });

  it("RouteRef — класс эндпоинта маршрута", () => {
    expect(resolveTarget(RouteRef(), stepOf(ChildSteps.Step))).toBe(ChildSteps);
  });

  it("RouteRef у курсора без эндпоинта — ROUTE_REF_DELAY_ERROR", () => {
    const cursor = new AomCursor(AomApi.instance(ChildSteps.Step), AomApi.instance(ChildSteps), "/");
    expect(() => resolveTarget(RouteRef(), cursor)).toThrow(
      expect.objectContaining({ message: "ROUTE_REF_DELAY_ERROR" }),
    );
  });

  it("цель из cursor.parameters() — тот же класс, что замыкание внедрило при исполнении", async () => {
    injected.length = 0;
    expect(await route.apply(context())).toBe("ok");
    expect(injected).toHaveLength(1);
    const [parameter] = stepOf(ChildSteps.Step).parameters();
    expect(parameter.kind).toBe("this");
    expect(parameter.target).toBe(injected[0].constructor);
    expect(parameter.target).toBe(ChildShells);
  });

  it("@This() без аргумента — цель: класс самого курсора", () => {
    expect(stepOf(ChildSteps.Index).parameters()).toEqual([{ kind: "this", target: ChildSteps }]);
  });

  it("@This(ref), разрешившийся в undefined, не подменяется классом курсора", async () => {
    const seen: unknown[] = [];
    @Controller()
    class Lost {
      @Get("/lost")
      static async Index(@This(ThisRef((() => undefined) as RefFunction)) value: unknown) {
        seen.push(value);
        return "ok";
      }
    }
    const [lost] = new Router(Lost, makeDocs()).routes;
    await expect(lost.apply(context())).rejects.toThrow();
    expect(seen).toEqual([]);
    expect(lost.cursors.at(-1)!.parameters()).toEqual([{ kind: "this" }]);
  });

  it("cursor.parameters() ничего не хранит — каждый вызов вычисляет заново", () => {
    const cursor = stepOf(ChildSteps.Step);
    expect(cursor.parameters()).not.toBe(cursor.parameters());
    expect(cursor.parameters()).toEqual(cursor.parameters());
  });
});

describe("router: RouteRef в DelayRefStack", () => {
  it("на общем шаге (не эндпоинте) — ROUTE_REF_DELAY_ERROR при сборке Router", () => {
    class Shared {
      @Middleware()
      @DelayRefStack(RouteRef(() => []))
      static async Step() {}
    }

    @Controller()
    class App {
      @Get("/a")
      @Before(Shared.Step)
      static async a() {
        return "a";
      }
    }

    expect(() => new Router(App, makeDocs())).toThrow(
      expect.objectContaining({ message: "ROUTE_REF_DELAY_ERROR" }),
    );
  });

  it("на эндпоинт-методе — маршрут собирается и работает", async () => {
    @Controller()
    class App {
      static readonly param = "endpoint-param";

      @Get("/b")
      @DelayRefStack(
        RouteRef((({ param }: typeof App) => [
          QueryParameters({ name: param, schema: { type: "string" } }),
        ]) as RefFunction),
      )
      static async b() {
        return "b";
      }
    }

    const router = new Router(App, makeDocs());
    const [route] = router.routes;
    expect(AomApi.checkExists(App.b)!.openApi.parameters).toEqual([
      expect.objectContaining({ name: "endpoint-param", in: "query" }),
    ]);
    expect(await route.apply(context())).toBe("b");
  });
});
