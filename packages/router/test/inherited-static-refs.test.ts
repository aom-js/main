import { describe, it, expect } from "vitest";
import {
  AomApi,
  AomCursor,
  Controller,
  Middleware,
  Before,
  Marker,
  UseMarker,
  DelayRefStack,
  QueryParameters,
  ThisRef,
  FwdRef,
  Bridge,
  Get,
  This,
  Router,
  OpenApi,
  type RefFunction,
  type HttpContextValues,
} from "@aom-js/router";

const context = (): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

// воспроизводит паттерн билдеров из @aom-js/api: базовый класс с отложенным
// ThisRef-стеком + фабрика анонимного потомка со статическим значением
@Controller()
class BuilderBase {
  static readonly marker: string;

  @Middleware()
  @DelayRefStack(
    ThisRef((({ marker }: typeof BuilderBase) => {
      if (!marker) throw new Error("marker is not defined");
      return [QueryParameters({ name: marker, schema: { type: "string" } })];
    }) as RefFunction),
  )
  static async Query() {}
}

function Builder(marker: string): typeof BuilderBase {
  return class extends BuilderBase {
    static readonly marker = marker;
  };
}

@Controller()
class ChildQuery extends Builder("child-param") {
  @Middleware()
  @Before(ChildQuery.Query) // ссылка фиксирует статику родителя: @Controller ещё не отработал
  static async Apply() {}
}

describe("router: ссылки на унаследованные статики", () => {
  it("Before(Self.InheritedStatic) резолвится в инстанс потомка", () => {
    const applyApi = AomApi.instance(ChildQuery, "Apply");
    expect(applyApi.element.pre_middlewares.map(($) => $._.target)).toEqual([ChildQuery]);
  });

  it("курсор реализует delayStack в контексте потомка (исходный краш)", () => {
    const applyApi = AomApi.instance(ChildQuery, "Apply");
    const [queryApi] = applyApi.element.pre_middlewares;
    const cursor = new AomCursor(queryApi, applyApi, "/");
    expect(cursor.$._.target).toBe(ChildQuery);
    expect(cursor.$.openApi.parameters).toEqual([
      expect.objectContaining({ name: "child-param", in: "query" }),
    ]);
  });

  it("страховочная перепривязка в AomCursor: родительский инстанс + origin потомка", () => {
    @Controller()
    class RebindChild extends Builder("rebind-param") {
      @Middleware()
      static async Apply() {}
    }
    const parentQueryApi = AomApi.instance(BuilderBase, "Query");
    const originApi = AomApi.instance(RebindChild, "Apply");
    const cursor = new AomCursor(parentQueryApi, originApi, "/");
    expect(cursor.$._.target).toBe(RebindChild);
    expect(cursor.$.openApi.parameters).toEqual([
      expect.objectContaining({ name: "rebind-param", in: "query" }),
    ]);
  });

  it("Before(FwdRef(() => Self.Query)) резолвится в curried-копию потомка", () => {
    @Controller()
    class FwdChild extends Builder("fwd-param") {
      @Middleware()
      @Before(FwdRef(() => FwdChild.Query))
      static async Apply() {}
    }
    const applyApi = AomApi.instance(FwdChild, "Apply");
    expect(applyApi.element.pre_middlewares.map(($) => $._.target)).toEqual([FwdChild]);
  });

  it("UseMarker(Self.InheritedMarker) резолвится в инстанс потомка", () => {
    @Controller()
    class MarkBase {
      @Marker()
      static Tag() {}
    }

    @Controller()
    class MarkChild extends MarkBase {
      @Middleware()
      @UseMarker(MarkChild.Tag)
      static async Mw() {}
    }

    const mwApi = AomApi.instance(MarkChild, "Mw");
    expect(mwApi.element.markers.map(($) => $._.target)).toEqual([MarkChild]);
  });

  it("realizeDelay не расходует стек при ошибке и падает громко повторно", () => {
    @Controller()
    class FailingBase {
      static readonly marker: string;

      @Middleware()
      @DelayRefStack(
        ThisRef((({ marker }: typeof FailingBase) => {
          if (!marker) throw new Error("marker is not defined");
          return [QueryParameters({ name: marker, schema: { type: "string" } })];
        }) as RefFunction),
      )
      static async Query() {}
    }

    @Controller()
    class Unrelated {
      @Middleware()
      static async Mw() {}
    }

    const rootQueryApi = AomApi.instance(FailingBase, "Query");
    const unrelatedApi = AomApi.instance(Unrelated, "Mw");
    // origin не наследует FailingBase — перепривязка невозможна, реализация падает
    expect(() => new AomCursor(rootQueryApi, unrelatedApi, "/")).toThrow("marker is not defined");
    // стек не потреблён — повторная сборка падает так же громко, а не деградирует тихо
    expect(rootQueryApi.delayStack.length).toBe(1);
    expect(rootQueryApi.delayRealized).toBe(false);
    expect(() => new AomCursor(rootQueryApi, unrelatedApi, "/")).toThrow("marker is not defined");
  });

  it("@This(ThisRef(...)) берёт класс шага — потомка, на котором исполняется унаследованный метод", async () => {
    class ModelA {
      readonly name = "a";
    }
    class ModelB {
      readonly name = "b";
    }

    @Controller()
    class Base {
      static readonly Model: new () => { name: string };

      @Get("/")
      static async Index(
        @This(ThisRef((({ Model }: typeof Base) => Model) as RefFunction)) model: { name: string },
      ) {
        return model.name;
      }
    }

    @Controller()
    class A extends Base {
      static readonly Model = ModelA;
    }

    @Controller()
    class B extends Base {
      static readonly Model = ModelB;
    }

    @Controller()
    @Bridge("/a", A)
    @Bridge("/b", B)
    class App {}

    const router = new Router(App, new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } }));
    const call = (path: string) => router.routes.find((route) => route.path === path)!.apply(context());

    expect(await call("/a")).toBe("a");
    expect(await call("/b")).toBe("b");
  });
});
