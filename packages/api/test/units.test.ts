import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  checkLocales,
  BodyBuilder,
  LockedResponse,
  FailedDependencyResponse,
  BaseAccessController,
  parseJsonBody,
  DEFAULT_BODY_LIMIT,
  BODY_UNREAD,
  PayloadTooLargeResponse,
  WrongDataResponse,
  BaseRootController,
  RouteElement,
  RoutesStructure,
} from "@aom-js/api";
import { Bridge, Controller, Get, Next, OpenApi, Router, This, type HttpContextValues } from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
// код ошибки не экспортируется из пакета (constants не входят в публичный API) - берём напрямую из src
import { API_ERROR_423_DATA_LOCKED } from "../src/constants/messages/errors";

const context = (): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body: {}, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

// подделка IncomingMessage: Readable с headers, ничего больше parseJsonBody не использует
function fakeRequest(
  headers: Record<string, string>,
  chunks: (string | Buffer)[],
): IncomingMessage {
  const stream = Readable.from(chunks, { objectMode: false });
  (stream as any).headers = headers;
  return stream as unknown as IncomingMessage;
}

describe("checkLocales (KI-API-04)", () => {
  it("сравнивает значения source с ключами target, а не имена экспортов", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const source = { A: "PREFIX:A", B: "PREFIX:B" };
    const target = { "PREFIX:A": "перевод" }; // B без перевода
    checkLocales("hint", source, target);
    expect(spy).toHaveBeenCalledWith("locales difference hint", ["PREFIX:B"]);
    spy.mockRestore();
  });

  it("не шумит в консоль, когда все значения переведены", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    checkLocales("hint", { A: "PREFIX:A" }, { "PREFIX:A": "перевод" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("BodyBuilder.JSONSchema (KI-API-05)", () => {
  @ComponentSchema({ description: "тестовая схема" })
  class TestSchema {
    @PropertySchema.String({})
    foo!: string;
  }

  it("переданное описание побеждает static description", () => {
    class WithDescription extends BodyBuilder(TestSchema, "static desc") {}
    expect(WithDescription.JSONSchema("explicit desc").description).toBe("explicit desc");
  });

  it("без явного описания используется static description потомка", () => {
    class WithDescription extends BodyBuilder(TestSchema, "static desc") {}
    expect(WithDescription.JSONSchema().description).toBe("static desc");
  });

  it("ни то ни другое не задано - пустая строка, а не 'undefined'", () => {
    class NoDescription extends BodyBuilder(TestSchema) {}
    expect(NoDescription.JSONSchema().description).toBe("");
  });
});

describe("коды и описания 423/424 (KI-API-06)", () => {
  it("код 423 без опечатки 432", () => {
    expect(API_ERROR_423_DATA_LOCKED).toBe("AOM_API:API_ERROR_423_DATA_LOCKED");
  });

  it("у LockedResponse и FailedDependencyResponse собственные описания вместо чужого ERROR_WRONG_DATA", () => {
    expect(LockedResponse.description).toBe("AOM_API:ERROR_DATA_LOCKED");
    expect(FailedDependencyResponse.description).toBe("AOM_API:ERROR_WRONG_DEPENDENCY");
  });
});

describe("BaseAccessController.CheckLayerPass (KI-API-13)", () => {
  class TestAccess extends BaseAccessController {
    static readonly markerName = "test-marker";
  }

  const targetFn = function OriginTarget() {};

  const cursor: any = {
    index: 0,
    origin: { _: { target: targetFn, property: "handler" } },
  };

  const extraCursor: any = {
    index: 1,
    $: { _: { target: targetFn, property: "handler" }, toString: () => "extra-ident" },
    origin: { toString: () => "origin-ident" },
  };

  const makeSelf = () =>
    ({ accessMap: { fullAccess: false, structure: {} }, activeAccessTypes: {} }) as any;

  it("точка доступа не найдена в маркере маршрута - без исключения", async () => {
    const route: any = {
      cursors: [extraCursor],
      markers: { "test-marker": { accessPoints: [] } },
    };
    const self = makeSelf();
    await expect(TestAccess.CheckLayerPass(cursor, route, self)).resolves.toBeUndefined();
    expect(self.layerPassed).toBe(false);
  });

  it("точка доступа найдена, но слой (extra) - нет - без исключения", async () => {
    const route: any = {
      cursors: [extraCursor],
      markers: {
        "test-marker": { accessPoints: [{ ident: "origin-ident", extra: [] }] },
      },
    };
    const self = makeSelf();
    await expect(TestAccess.CheckLayerPass(cursor, route, self)).resolves.toBeUndefined();
    expect(self.layerPassed).toBe(false);
  });
});

describe("parseJsonBody (KI-API-16)", () => {
  it("Content-Length больше лимита - отказ до чтения потока", async () => {
    const req = fakeRequest({ "content-type": "application/json", "content-length": "1000" }, []);
    await expect(parseJsonBody(req, { limit: 10 })).rejects.toBeInstanceOf(PayloadTooLargeResponse);
    // поток не тронут - ни одного слушателя на нём нет
    expect(req.listenerCount("data")).toBe(0);
  });

  it("превышение обнаружено по ходу чтения - помечено BODY_UNREAD", async () => {
    const req = fakeRequest({ "content-type": "application/json" }, ["12345678"]);
    const err: any = await parseJsonBody(req, { limit: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(PayloadTooLargeResponse);
    expect(Reflect.get(err, BODY_UNREAD)).toBe(true);
  });

  it("limit: 0 - без ограничения", async () => {
    const req = fakeRequest({ "content-type": "application/json", "content-length": "999999999" }, [
      JSON.stringify({ a: 1 }),
    ]);
    await expect(parseJsonBody(req, { limit: 0 })).resolves.toEqual({ a: 1 });
  });

  it("не-JSON content-type - {} и поток не тронут", async () => {
    const req = fakeRequest({ "content-type": "multipart/form-data" }, ["не должно читаться"]);
    await expect(parseJsonBody(req)).resolves.toEqual({});
    expect(req.listenerCount("data")).toBe(0);
  });

  it("пустое тело - {}", async () => {
    const req = fakeRequest({ "content-type": "application/json" }, []);
    await expect(parseJsonBody(req)).resolves.toEqual({});
  });

  it("битый JSON - WrongDataResponse (400)", async () => {
    const req = fakeRequest({ "content-type": "application/json" }, ["{не json"]);
    const err: any = await parseJsonBody(req).catch((e) => e);
    expect(err).toBeInstanceOf(WrongDataResponse);
    expect(err.status).toBe(400);
  });

  it("DEFAULT_BODY_LIMIT - 1 МиБ", () => {
    expect(DEFAULT_BODY_LIMIT).toBe(1_048_576);
  });
});

describe("BaseRootController.Index: копия маршрутов на запрос (KI-COMMON-04)", () => {
  it("шаг перед Index сужает копию своего запроса, а не общий роутер", async () => {
    @Controller()
    class Root extends BaseRootController {
      static readonly RoutesStructure = RoutesStructure;
      readonly RouteElement = RouteElement;
      readonly ident = "test";
      markersToRoute() {}
    }

    @Controller()
    class Narrow {
      @Get("/narrow")
      @Next(Root.Index)
      static async Index(@This(Root) root: Root) {
        root.routes = root.routes.filter((route) => route.path !== "/narrow");
      }
    }

    @Controller()
    @Bridge("/", Root)
    @Bridge("/", Narrow)
    class App {}

    const router = new Router(App, new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } }));
    const listed = async (endpoint: Function) => {
      const route = router.routeOf(endpoint);
      const result = (await route.apply(context())) as RoutesStructure<RouteElement>;
      return result.routes.map((element) => element.path);
    };

    expect(await listed(Narrow.Index)).not.toContain("/narrow");
    // роутер один на все запросы: сужение одного запроса не должно в нём остаться
    expect(router.routes.map((route) => route.path)).toContain("/narrow");
    expect(await listed(Root.Index)).toContain("/narrow");
  });
});
