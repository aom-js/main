import { describe, it, expect } from "vitest";
import {
  AomApi,
  AomCursorKind,
  After,
  Before,
  Controller,
  CursorKind,
  Get,
  Middleware,
  OpenApi,
  Router,
  type AomCursor,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import {
  BaseAccessController,
  BodyBuilder,
  CookieBuilder,
  HeadersBuilder,
  ParamsBuilder,
  QueryStringBuilder,
  UUIDParam,
} from "@aom-js/api";
import { describeRoute, describeRouter, kindOf, manifestOf } from "@aom-js/api/testing";
import { parentsOf } from "@aom-js/router/testing";

type Fn = (...args: never[]) => unknown;

const routerOf = (root: abstract new (...args: never[]) => unknown) => new Router(root as never, new OpenApi({ title: "t", version: "1" }));
const stepOf = (router: Router, endpoint: Fn, step: Fn): AomCursor =>
  router.routeOf(endpoint).cursors.find((cursor) => cursor.$ === AomApi.checkExists(step))!;

describe("kindOf: правила ядра", () => {
  it("эндпоинт — Handler", () => {
    @Controller()
    class Plain {
      @Get("/h")
      static async H() {}
    }
    const router = routerOf(Plain);
    expect(kindOf(stepOf(router, Plain.H, Plain.H))).toBe(AomCursorKind.Handler);
  });

  it("шаг наследника BaseAccessController — Checkpoint", () => {
    @Controller()
    class Access extends BaseAccessController {}
    @Controller()
    class Pages {
      @Get("/c")
      @Before(Access.Init)
      static async C() {}
    }
    const router = routerOf(Pages);
    expect(kindOf(stepOf(router, Pages.C, Access.Init))).toBe(AomCursorKind.Checkpoint);
  });

  it("эндпоинт в наследнике BaseAccessController — Handler, а не Checkpoint", () => {
    @Controller()
    class Access extends BaseAccessController {
      @Get("/own")
      static async Own() {}
    }
    const router = routerOf(Access);
    expect(kindOf(stepOf(router, Access.Own, Access.Own))).toBe(AomCursorKind.Handler);
  });

  it("шаги билдеров query, params и IDController — Input", () => {
    @ComponentSchema()
    class Filter {
      @PropertySchema.String({ isOptional: true })
      name?: string;
    }
    @ComponentSchema()
    class SlugParam {
      @PropertySchema.String({})
      slug!: string;
    }
    @Controller()
    class FilterQuery extends QueryStringBuilder(Filter) {}
    @Controller()
    class SlugValue extends ParamsBuilder(SlugParam) {}
    @Controller()
    class ItemID extends UUIDParam("itemId") {}
    @Controller()
    class Pages {
      @Get(`/pages/${SlugValue}/${ItemID}`)
      @Before(FilterQuery.Query)
      @Before(SlugValue.Params)
      @Before(ItemID.PathID)
      static async Page() {}
    }
    const router = routerOf(Pages);
    for (const step of [FilterQuery.Query, SlugValue.Params, ItemID.PathID]) {
      expect(kindOf(stepOf(router, Pages.Page, step))).toBe(AomCursorKind.Input);
    }
  });

  it("шаги билдеров body, headers и cookie — Input", () => {
    @ComponentSchema()
    class Payload {
      @PropertySchema.String({})
      title!: string;
    }
    @Controller()
    class PayloadBody extends BodyBuilder(Payload) {}
    @Controller()
    class PayloadHeaders extends HeadersBuilder(Payload) {}
    @Controller()
    class PayloadCookies extends CookieBuilder(Payload) {}
    @Controller()
    class Pages {
      @Get("/inputs")
      @Before(PayloadBody.Body)
      @Before(PayloadHeaders.Headers)
      @Before(PayloadCookies.Cookie)
      static async Inputs() {}
    }
    const router = routerOf(Pages);
    for (const step of [PayloadBody.Body, PayloadHeaders.Headers, PayloadCookies.Cookie]) {
      expect(kindOf(stepOf(router, Pages.Inputs, step))).toBe(AomCursorKind.Input);
    }
  });

  it("пустой @Before класса — Meta", () => {
    @Controller()
    @Before(Group.Setup)
    class Group {
      @Middleware()
      static async Setup() {}

      @Get("/m")
      static async M() {}
    }
    const router = routerOf(Group);
    expect(kindOf(stepOf(router, Group.M, Group.Setup))).toBe(AomCursorKind.Meta);
  });

  it("свой метод наследника билдера — Step, не Input", () => {
    @ComponentSchema()
    class Filter {
      @PropertySchema.String({ isOptional: true })
      name?: string;
    }
    @Controller()
    class FilterQuery extends QueryStringBuilder(Filter) {
      @Middleware()
      static async Apply() {}
    }
    @Controller()
    class Pages {
      @Get("/s")
      @Before(FilterQuery.Apply)
      static async S() {}
    }
    const router = routerOf(Pages);
    expect(kindOf(stepOf(router, Pages.S, FilterQuery.Apply))).toBe(AomCursorKind.Step);
  });

  it("объявленный @CursorKind побеждает вывод", () => {
    @Controller()
    class Access extends BaseAccessController {
      @Middleware()
      @CursorKind(AomCursorKind.Collector)
      static async Collect() {}
    }
    @Controller()
    class Pages {
      @Get("/k")
      @Before(Access.Collect)
      static async K() {}
    }
    const router = routerOf(Pages);
    expect(kindOf(stepOf(router, Pages.K, Access.Collect))).toBe(AomCursorKind.Collector);
  });
});

describe("kindOf: options.kindOf", () => {
  it("вид приложения для своего класса — Transport", () => {
    @Controller()
    class Shells {
      @Middleware()
      static async Carry() {}
    }
    @Controller()
    class Pages {
      @Get("/t")
      @Before(Shells.Carry)
      static async T() {}
    }
    const router = routerOf(Pages);
    const options = {
      kindOf: ({ $ }: AomCursor) => ($._.target === Shells ? AomCursorKind.Transport : undefined),
    };
    expect(kindOf(stepOf(router, Pages.T, Shells.Carry), options)).toBe(AomCursorKind.Transport);
    expect(kindOf(stepOf(router, Pages.T, Shells.Carry))).toBe(AomCursorKind.Step);
  });

  it("undefined — решают правила ядра, а не Step", () => {
    @Controller()
    class Access extends BaseAccessController {}
    @Controller()
    class Pages {
      @Get("/u")
      @Before(Access.Init)
      static async U() {}
    }
    const router = routerOf(Pages);
    expect(kindOf(stepOf(router, Pages.U, Access.Init), { kindOf: () => undefined })).toBe(AomCursorKind.Checkpoint);
  });

  it("порядок: Handler раньше options.kindOf, options.kindOf раньше Checkpoint", () => {
    @Controller()
    class Access extends BaseAccessController {}
    @Controller()
    class Pages {
      @Get("/o")
      @Before(Access.Init)
      static async O() {}
    }
    const router = routerOf(Pages);
    const options = { kindOf: () => AomCursorKind.Transport };
    expect(kindOf(stepOf(router, Pages.O, Pages.O), options)).toBe(AomCursorKind.Handler);
    expect(kindOf(stepOf(router, Pages.O, Access.Init), options)).toBe(AomCursorKind.Transport);
  });
});

describe("describeRoute, describeRouter, manifestOf", () => {
  @Controller()
  class Probe {
    @Get("/b")
    static async B() {}

    @Get("/a")
    static async A() {}
  }
  const router = routerOf(Probe);

  it("describeRoute: вид у каждого шага, поле проекции ядра доходит до результата", () => {
    const route = router.routeOf(Probe.A);
    const withExtra = Object.assign(Object.create(route), {
      toJSON: () => {
        const json = route.toJSON();
        return { ...json, steps: json.steps.map((step) => ({ ...step, extra: step.i })) };
      },
    });
    const { steps } = describeRoute(withExtra);
    expect(steps.every((step) => Object.values(AomCursorKind).includes(step.kind))).toBe(true);
    expect(steps.map((step) => (step as { extra?: number }).extra)).toEqual(route.toJSON().steps.map(({ i }) => i));
    expect(Object.keys(steps[0]).slice(0, 4)).toEqual(["i", "step", "origin", "via"]);
    expect(Object.keys(steps[0])).toContain("kind");
  });

  it("describeRoute: parent шага — parentsOf цепочки, верхние шаги — -1", () => {
    @Controller()
    @Before(Chain.Setup)
    class Chain {
      @Middleware()
      static async Setup() {}

      @Middleware()
      static async Inner() {}

      @Middleware()
      @Before(Chain.Inner)
      static async Gate() {}

      @Middleware()
      static async Finish() {}

      @Get("/p")
      @Before(Chain.Gate)
      @After(Chain.Finish)
      static async P() {}
    }
    const route = routerOf(Chain).routeOf(Chain.P);
    const { steps } = describeRoute(route);
    expect(steps.map((step) => step.parent)).toEqual(parentsOf(route.cursors));
    expect(steps.some((step) => step.parent === -1)).toBe(true);
    expect(steps.some((step) => step.parent > -1)).toBe(true);
    expect(steps.find((step) => step.via === "endpoint")?.parent).toBe(-1);
    expect(Object.keys(steps[0]).slice(0, 6)).toEqual(["i", "step", "origin", "via", "parent", "kind"]);
  });

  it("describeRouter: порядок маршрутов — как в Router.toJSON", () => {
    const order = (routes: Array<{ method: string; path: string }>) =>
      routes.map(({ method, path }) => `${method} ${path}`);
    expect(order(describeRouter(router).routes)).toEqual(order(router.toJSON().routes));
  });

  it("manifestOf: JSON с отступом 2 и переводом строки в конце", () => {
    const text = manifestOf(router);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(describeRouter(router))));
    expect(text).toBe(`${JSON.stringify(describeRouter(router), null, 2)}\n`);
  });
});
