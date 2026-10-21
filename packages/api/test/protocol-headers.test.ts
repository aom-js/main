import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import {
  Controller,
  Middleware,
  WebSocketPoint,
  Before,
  After,
  Bridge,
  Headers,
  This,
  Router,
  OpenApi,
} from "@aom-js/router";
import {
  Server,
  AomWebSockets,
  WebSocketsController,
  AuthHeaderToken,
  protocolHeaders,
  type AomServerSettings,
} from "@aom-js/api";

// клиент кладёт тот же объект заголовков, что и в fetch, только встроенными функциями
const asProtocol = (headers: Record<string, unknown>) => encodeURIComponent(JSON.stringify(headers));

describe("protocolHeaders: развёртка подпротокола в заголовки", () => {
  it("элемент encodeURIComponent(JSON) разворачивается в заголовки; кириллица и разделители — без потерь", () => {
    const headers = { authorization: "Bearer a.b-c_d", "data-org-id": "org-1", note: "Привет / = + : , {}" };
    expect(protocolHeaders(asProtocol(headers))).toEqual(headers);
  });

  it("ключи — в нижнем регистре; из одинаковых в разном регистре побеждает последний", () => {
    expect(protocolHeaders(asProtocol({ "Data-Org-Id": "a", "DATA-ORG-ID": "b" }))).toEqual({
      "data-org-id": "b",
    });
  });

  it("берутся только строковые значения", () => {
    expect(protocolHeaders(asProtocol({ a: "1", b: 2, c: null, d: { e: "f" }, g: ["h"] }))).toEqual({
      a: "1",
    });
  });

  it("битые элементы и не-объекты пропускаются, остальные элементы списка разворачиваются", () => {
    const value = ["%E0%A4%A", "not-json", asProtocol(["x"]), asProtocol("str"), asProtocol({ a: "1" })];
    expect(protocolHeaders(value.join(", "))).toEqual({ a: "1" });
    expect(protocolHeaders([asProtocol({ a: "1" }), asProtocol({ b: "2" })])).toEqual({ a: "1", b: "2" });
    expect(protocolHeaders(undefined)).toEqual({});
  });

  it("список извлекаемых — без учёта регистра; не задан — всё; пустой — ничего", () => {
    const value = asProtocol({ authorization: "Bearer t", "data-org-id": "o", "x-forwarded-for": "1.1.1.1" });
    expect(protocolHeaders(value, ["Authorization", "DATA-ORG-ID"])).toEqual({
      authorization: "Bearer t",
      "data-org-id": "o",
    });
    expect(Object.keys(protocolHeaders(value))).toHaveLength(3);
    expect(protocolHeaders(value, [])).toEqual({});
  });
});

describe("Server: заголовки подпротоколом доходят до цепочки точки сокета", () => {
  // что увидела цепочка: заголовки x-user и authorization
  const seen: Array<{ user?: string; authorization?: string }> = [];

  @Controller()
  class EchoSocket {
    static sockets = new AomWebSockets();

    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async UserId(
      @Headers() headers: Record<string, string>,
      @This(WebSocketsController) ws: WebSocketsController,
    ) {
      seen.push({ user: headers["x-user"], authorization: headers.authorization });
      ws.id = headers["x-user"] ?? null;
    }

    @WebSocketPoint("/echo")
    @Before(EchoSocket.UserId)
    static async Point() {}
  }

  @Controller()
  @Bridge("/", EchoSocket)
  class Root {}

  let server: Server | undefined;

  const start = (settings: Partial<AomServerSettings> = {}) => {
    const router = new Router(Root, new OpenApi({ title: "test", version: "1" }));
    server = new Server({ port: 0, url: "http://localhost", ...settings }, router);
    return `ws://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  };

  const open = (url: string, protocols: string[], headers: Record<string, string> = {}) => {
    const client = new WebSocket(url, protocols, { headers });
    return new Promise<{ opened: boolean; protocol: string }>((resolve) => {
      client.once("open", () => {
        resolve({ opened: true, protocol: client.protocol });
        client.close();
      });
      client.once("error", () => resolve({ opened: false, protocol: "" }));
    });
  };

  afterEach(() => {
    seen.length = 0;
    server?.server.closeAllConnections();
    server?.server.close();
  });

  it("заголовки из подпротокола видны шагам как обычные; клиент принимает ответ сервера", async () => {
    const base = start();
    const result = await open(`${base}/echo`, [asProtocol({ "X-User": "u1", authorization: "Bearer t" })]);
    expect(result.opened).toBe(true);
    expect(result.protocol).not.toBe("");
    expect(seen).toEqual([{ user: "u1", authorization: "Bearer t" }]);
  });

  it("настоящий заголовок побеждает развёрнутый", async () => {
    const base = start();
    const result = await open(`${base}/echo`, [asProtocol({ "x-user": "fake" })], { "x-user": "real" });
    expect(result.opened).toBe(true);
    expect(seen).toEqual([{ user: "real", authorization: undefined }]);
  });

  it("protocolHeaders ограничивает извлекаемое; пустой список выключает развёртку", async () => {
    const limited = start({ protocolHeaders: ["Authorization"] });
    const first = await open(`${limited}/echo`, [asProtocol({ "x-user": "u1", authorization: "Bearer t" })]);
    // x-user не извлечён — ключа нет, соединение разорвано
    expect(first.opened).toBe(false);
    expect(seen).toEqual([{ user: undefined, authorization: "Bearer t" }]);
    server!.server.close();

    seen.length = 0;
    const off = start({ protocolHeaders: [] });
    expect((await open(`${off}/echo`, [asProtocol({ "x-user": "u1" })])).opened).toBe(false);
    expect(seen).toEqual([{ user: undefined, authorization: undefined }]);
  });
});

describe("AuthHeaderToken: подстановки Bearer_ больше нет", () => {
  it("«Bearer_<token>» — неверный тип токена, «Bearer <token>» — принят", async () => {
    const self = new AuthHeaderToken();
    await expect(
      AuthHeaderToken.Required.call(AuthHeaderToken, self, { authorization: "Bearer_t1" }),
    ).rejects.toMatchObject({ status: 401 });

    const ok = new AuthHeaderToken();
    await AuthHeaderToken.Required.call(AuthHeaderToken, ok, { authorization: "Bearer t1" });
    expect([ok.type, ok.value]).toEqual(["Bearer", "t1"]);
  });
});
