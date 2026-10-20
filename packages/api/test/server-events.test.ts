import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { PassThrough } from "node:stream";
import {
  Controller,
  Get,
  Middleware,
  Before,
  Headers,
  Ctx,
  Router,
  OpenApi,
  Responses,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import {
  AomServerEvents,
  AuthRequiredResponse,
  Server,
  formatServerEvent,
  type HttpCtx,
  type HttpResponse,
} from "@aom-js/api";

@ComponentSchema()
class Unread {
  @PropertySchema.Number({})
  total!: number;
}

// заглушка ответа: реестру нужен только setHeader
function fakeRes() {
  const headers: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) };
  return { res: res as unknown as HttpResponse, headers };
}

// всё, что поток успел накопить (PassThrough без читателя держит записанное в буфере)
const drained = (stream: PassThrough) => String(stream.read() ?? "");

describe("formatServerEvent: кадр события", () => {
  it("event, data одной строкой JSON, пустая строка в конце", () => {
    expect(formatServerEvent("unread", { total: 2 })).toBe('event: unread\ndata: {"total":2}\n\n');
  });

  it("id — между event и data, если задан", () => {
    expect(formatServerEvent("unread", 1, "42")).toBe("event: unread\nid: 42\ndata: 1\n\n");
  });

  it("перевод строки внутри данных не рвёт кадр: JSON экранирует его", () => {
    expect(formatServerEvent("note", { text: "a\nb\r\nc" })).toBe(
      'event: note\ndata: {"text":"a\\nb\\r\\nc"}\n\n',
    );
  });

  it("перевод строки в имени события или в id — ошибка", () => {
    expect(() => formatServerEvent("a\nb", 1)).toThrow();
    expect(() => formatServerEvent("a\rb", 1)).toThrow();
    expect(() => formatServerEvent("a", 1, "1\n2")).toThrow();
  });
});

describe("AomServerEvents: реестр потоков", () => {
  it("connect ставит заголовки потока и кладёт первый кадр", () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 0 });
    const { res, headers } = fakeRes();
    const stream = events.connect("a", res);

    expect(headers).toEqual({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    expect(drained(stream)).toBe(": connected\n\n");
    stream.destroy();
  });

  it("с retry первый кадр — retry", () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 0, retry: 3000 });
    const stream = events.connect("a", fakeRes().res);
    expect(drained(stream)).toBe("retry: 3000\n\n");
    stream.destroy();
  });

  it("send — только потокам своего id, broadcast — всем", () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 0 });
    const [a1, a2, b] = ["a", "a", "b"].map((id) => events.connect(id, fakeRes().res));
    [a1, a2, b].forEach(drained);

    events.send("a", "unread", { total: 1 }, "7");
    expect([a1, a2, b].map(drained)).toEqual([
      'event: unread\nid: 7\ndata: {"total":1}\n\n',
      'event: unread\nid: 7\ndata: {"total":1}\n\n',
      "",
    ]);

    events.broadcast("unread", { total: 2 });
    expect([a1, a2, b].map(drained)).toEqual(Array(3).fill('event: unread\ndata: {"total":2}\n\n'));
    [a1, a2, b].forEach((s) => s.destroy());
  });

  it("send по неизвестному id ничего не делает и не бросает", () => {
    const events = new AomServerEvents({ unread: Unread });
    expect(() => events.send("nobody", "unread", { total: 1 })).not.toThrow();
  });

  it("disconnect снимает поток, последний — вместе с ключом", () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 0 });
    const [a1, a2] = ["a", "a"].map((id) => events.connect(id, fakeRes().res));

    events.disconnect("a", a1);
    expect(events.connections.get("a")).toEqual([a2]);
    events.disconnect("a", a2);
    expect(events.connections.has("a")).toBe(false);
  });

  it("закрытие потока снимает его с реестра", async () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 0 });
    const stream = events.connect("a", fakeRes().res);
    stream.destroy();
    await new Promise((resolve) => stream.once("close", resolve));
    expect(events.connections.has("a")).toBe(false);
  });

  it("heartbeat пишет комментарий ping, после закрытия — перестаёт", async () => {
    const events = new AomServerEvents({ unread: Unread }, { heartbeat: 20 });
    const stream = events.connect("a", fakeRes().res);
    drained(stream);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(drained(stream)).toMatch(/^(: ping\n\n)+$/);

    stream.destroy();
    await new Promise((resolve) => stream.once("close", resolve));
    const write = vi.spyOn(stream, "write");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(write).not.toHaveBeenCalled();
  });
});

// клиент SSE на http.get: статус, заголовки и всё принятое тело; destroy — уход клиента
function listen(url: string, headers: Record<string, string> = {}) {
  let body = "";
  let request!: http.ClientRequest;
  const response = new Promise<http.IncomingMessage>((resolve, reject) => {
    request = http.get(url, { headers }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      resolve(res);
    });
    request.on("error", reject);
  });
  return { response, body: () => body, destroy: () => request.destroy() };
}

const until = async (check: () => boolean, ms = 1000) => {
  for (const start = Date.now(); !check();) {
    if (Date.now() - start > ms) throw new Error("не дождались");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("AomServerEvents через реальный Server", () => {
  const events = new AomServerEvents({ unread: Unread }, { heartbeat: 50 });
  const docs = new OpenApi({ title: "t", version: "1" });
  let server: Server;
  let base: string;

  @Controller()
  class Gate {
    @Middleware()
    static async Check(@Headers("x-user") user?: string) {
      if (!user) throw new AuthRequiredResponse("auth required");
    }
  }

  @Controller()
  @Before(Gate.Check)
  class Events {
    @Get("/events")
    @Responses(events.JSONSchema("поток событий"))
    static Connect(@Headers("x-user") user: string, @Ctx() { res }: HttpCtx) {
      return events.connect(user, res);
    }
  }

  beforeAll(async () => {
    server = new Server({ port: 0, url: "http://localhost" }, new Router(Events, docs));
    // проверка таймаутов запускается по событию listening — до него настройки ещё применяются
    server.server.requestTimeout = 100;
    server.server.headersTimeout = 100;
    (
      server.server as unknown as { connectionsCheckingInterval: number }
    ).connectionsCheckingInterval = 20;
    await new Promise((resolve) => server.server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.server.closeAllConnections();
    server.server.close();
  });

  it("заголовки потока и первый кадр приходят сразу", async () => {
    const client = listen(`${base}/events`, { "x-user": "first" });
    const res = await client.response;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    await until(() => client.body().length > 0);
    expect(client.body()).toBe(": connected\n\n");
    client.destroy();
  });

  it("send доходит до своего id, не до чужого; broadcast — до всех", async () => {
    const [mine, other] = [
      listen(`${base}/events`, { "x-user": "mine" }),
      listen(`${base}/events`, { "x-user": "other" }),
    ];
    await Promise.all([mine.response, other.response]);
    await until(() => events.connections.has("mine") && events.connections.has("other"));

    events.send("mine", "unread", { total: 1 });
    await until(() => mine.body().includes('data: {"total":1}'));
    events.broadcast("unread", { total: 2 });
    await until(() => mine.body().includes('total":2') && other.body().includes('total":2'));
    expect(other.body()).not.toContain('total":1');
    mine.destroy();
    other.destroy();
  });

  it("heartbeat: комментарий ping по таймеру", async () => {
    const client = listen(`${base}/events`, { "x-user": "ping" });
    await client.response;
    await until(() => client.body().includes(": ping\n\n"));
    client.destroy();
  });

  it("уход клиента: поток снят с реестра, console.error не вызван", async () => {
    const error = vi.spyOn(console, "error");
    try {
      const client = listen(`${base}/events`, { "x-user": "gone" });
      await client.response;
      await until(() => events.connections.has("gone"));
      client.destroy();
      await until(() => !events.connections.has("gone"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("requestTimeout не рвёт долгий GET: принятый запрос уже не считается", async () => {
    // контроль: недосланные заголовки тот же сервер рвёт по таймауту (408)
    const raw = net.connect((server.server.address() as AddressInfo).port, "127.0.0.1");
    let rawOut = "";
    raw.on("data", (d) => (rawOut += d));
    raw.write("GET /events HTTP/1.1\r\nHost: x\r\n");
    const client = listen(`${base}/events`, { "x-user": "long" });
    await client.response;
    await until(() => rawOut.startsWith("HTTP/1.1 408"));
    raw.destroy();

    await new Promise((resolve) => setTimeout(resolve, 300));
    events.send("long", "unread", { total: 3 });
    await until(() => client.body().includes('total":3'));
    client.destroy();
  });

  it("JSONSchema реестра: поток в OpenAPI с событиями словаря", () => {
    expect(events.JSONSchema("поток событий")).toEqual({
      status: 200,
      description: "поток событий",
      events: { unread: Unread },
    });
    const media =
      docs.toJSON().paths!["/events"]!.get!.responses!["200"].content["text/event-stream"];
    expect(media.schema).toEqual({ type: "string" });
    expect(
      media.itemSchema.oneOf.map(
        (v: { properties: { event: { const: string } } }) => v.properties.event.const,
      ),
    ).toEqual(["unread"]);
    expect(media.itemSchema.oneOf[0].properties.data.contentSchema).toEqual({
      $ref: "#/components/schemas/Unread",
    });
  });

  it("гейт отказал: JSON 401, поток не открыт, реестр пуст", async () => {
    await until(() => events.connections.size === 0); // клиенты прошлых тестов ушли
    const res = await fetch(`${base}/events`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect((await res.json()).status).toBe(401);
    expect(events.connections.size).toBe(0);
  });
});
