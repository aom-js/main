import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import {
  Controller,
  WebSocketPoint,
  Middleware,
  Before,
  After,
  Headers,
  Params,
  This,
  Bridge,
  Router,
  OpenApi,
} from "@aom-js/router";
import { Server, AomWebSockets, WebSocketsController } from "@aom-js/api";
import { CONTROLLERS_WEBSOCKETS_WRONG_TARGET } from "../src/constants/messages/controllers";

// заглушка соединения для юнит-проверок реестра: нужен только send
function fakeSocket() {
  return { send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

describe("AomWebSockets: реестр соединений", () => {
  it("connect кладёт несколько сокетов под один id, send шлёт только своему id", () => {
    const sockets = new AomWebSockets();
    const [a1, a2, b] = [fakeSocket(), fakeSocket(), fakeSocket()];
    sockets.connect("a", a1).connect("a", a2).connect("b", b);

    sockets.send("a", "hi");

    expect(a1.send).toHaveBeenCalledWith("hi");
    expect(a2.send).toHaveBeenCalledWith("hi");
    expect(b.send).not.toHaveBeenCalled();
  });

  it("send по неизвестному id ничего не делает и не бросает", () => {
    const sockets = new AomWebSockets();
    expect(() => sockets.send("nobody", "hi")).not.toThrow();
  });

  it("broadcast шлёт всем сокетам всех id", () => {
    const sockets = new AomWebSockets();
    const [a, b] = [fakeSocket(), fakeSocket()];
    sockets.connect("a", a).connect("b", b);

    sockets.broadcast("all");

    expect(a.send).toHaveBeenCalledWith("all");
    expect(b.send).toHaveBeenCalledWith("all");
  });

  it("disconnect снимает ровно этот сокет, остальные под тем же id остаются", () => {
    const sockets = new AomWebSockets();
    const [a1, a2] = [fakeSocket(), fakeSocket()];
    sockets.connect("a", a1).connect("a", a2);

    sockets.disconnect("a", a1);
    sockets.send("a", "after");

    expect(a1.send).not.toHaveBeenCalled();
    expect(a2.send).toHaveBeenCalledWith("after");
  });

  it("disconnect последнего сокета оставляет под id пустой массив (ключ не удаляется)", () => {
    const sockets = new AomWebSockets();
    const a = fakeSocket();
    sockets.connect("a", a).disconnect("a", a);
    expect(sockets.connections.get("a")).toEqual([]);
  });
});

// клиент ws: ждём открытия или отказа. Отказ рукопожатия у ws-клиента - событие error, затем close
function connect(url: string, headers: Record<string, string> = {}) {
  const client = new WebSocket(url, { headers });
  const messages: string[] = [];
  client.on("message", (data) => messages.push(String(data)));
  const opened = new Promise<boolean>((resolve) => {
    client.once("open", () => resolve(true));
    client.once("error", () => resolve(false));
  });
  const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
  return { client, messages, opened, closed };
}

describe("WebSocketsController через реальный Server", () => {
  const received: Array<{ id: string; data: unknown }> = [];
  // кто и в каком порядке отработал - и что к телу точки сокет уже в реестре
  const steps: string[] = [];

  @Controller()
  class Gate {
    @Middleware()
    static async Check(@Headers("x-deny") deny?: string) {
      steps.push("gate");
      if (deny) throw new Error("gate denied");
    }
  }

  @Controller()
  @Before(Gate.Check)
  class EchoSocket {
    // обработчик приложения асинхронный, как в приложении; на "boom" он отклоняется
    static sockets = new AomWebSockets(async (id, _socket, data) => {
      if (data === "boom") throw new Error("handler failed");
      received.push({ id, data });
    });

    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async UserId(
      @Headers("x-user") user: string | undefined,
      @This(WebSocketsController) ws: WebSocketsController,
    ) {
      steps.push("id");
      ws.id = user ?? null;
    }

    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async RoomId(
      @Params("roomId") roomId: string,
      @This(WebSocketsController) ws: WebSocketsController,
    ) {
      ws.id = roomId;
    }

    @WebSocketPoint("/echo")
    @Before(EchoSocket.UserId)
    static async Point(
      @This(WebSocketsController) { id }: WebSocketsController,
      @Headers("x-fail-body") failBody?: string,
    ) {
      steps.push(`point:${EchoSocket.sockets.connections.get(id!)?.length ?? 0}`);
      if (failBody) throw new Error("point failed");
    }

    @WebSocketPoint("/rooms/:roomId")
    @Before(EchoSocket.RoomId)
    static async Room() {}
  }

  // контроллеры с точкой сокета, но без `sockets: AomWebSockets`
  @Controller()
  class NoSockets {
    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async Id(@This(WebSocketsController) ws: WebSocketsController) {
      ws.id = "x";
    }

    @WebSocketPoint("/no-sockets")
    @Before(NoSockets.Id)
    static async Point() {}
  }

  @Controller()
  class WrongSockets {
    static sockets = { send() {} };

    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async Id(@This(WebSocketsController) ws: WebSocketsController) {
      ws.id = "x";
    }

    @WebSocketPoint("/wrong-sockets")
    @Before(WrongSockets.Id)
    static async Point() {}
  }

  @Controller()
  @Bridge("/", EchoSocket)
  @Bridge("/", NoSockets)
  @Bridge("/", WrongSockets)
  class Root {}

  let server: Server;
  let base: string;

  beforeAll(() => {
    const docs = new OpenApi({ title: "test", version: "1" });
    const router = new Router(Root, docs);
    server = new Server({ port: 0, url: "http://localhost" }, router);
    base = `ws://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.server.close();
  });

  it("id из заголовка: рукопожатие проходит, порядок шагов гейт -> id -> тело, к телу сокет в реестре", async () => {
    steps.length = 0;
    const c = connect(`${base}/echo`, { "x-user": "u1" });
    expect(await c.opened).toBe(true);
    expect(steps).toEqual(["gate", "id", "point:1"]);
    c.client.close();
    await c.closed;
  });

  it("sockets.send(id) доходит только до клиентов этого id", async () => {
    const u1 = connect(`${base}/echo`, { "x-user": "send-1" });
    const u2 = connect(`${base}/echo`, { "x-user": "send-2" });
    expect(await u1.opened).toBe(true);
    expect(await u2.opened).toBe(true);

    EchoSocket.sockets.send("send-1", "only for 1");
    await vi.waitFor(() => expect(u1.messages).toEqual(["only for 1"]));
    expect(u2.messages).toEqual([]);

    u1.client.close();
    u2.client.close();
    await Promise.all([u1.closed, u2.closed]);
  });

  it("сообщение клиента приходит в onMessage(id, socket, data)", async () => {
    received.length = 0;
    const c = connect(`${base}/echo`, { "x-user": "talker" });
    expect(await c.opened).toBe(true);

    c.client.send("ping");
    await vi.waitFor(() => expect(received).toEqual([{ id: "talker", data: "ping" }]));

    c.client.close();
    await c.closed;
  });

  it("ошибка обработчика onMessage не уходит в необработанный reject: логируется, соединение живо", async () => {
    received.length = 0;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = connect(`${base}/echo`, { "x-user": "faulty" });
    try {
      expect(await c.opened).toBe(true);
      c.client.send("boom");
      c.client.send("after");
      await vi.waitFor(() => expect(received).toEqual([{ id: "faulty", data: "after" }]));
      const logged = errors.mock.calls.flat().map((arg) => (arg as Error)?.message);
      expect(logged).toContain("handler failed");
    } finally {
      errors.mockRestore();
      c.client.close();
      await c.closed;
    }
  });

  it("после закрытия клиента сокет снят с регистрации", async () => {
    const c = connect(`${base}/echo`, { "x-user": "leaver" });
    expect(await c.opened).toBe(true);
    expect(EchoSocket.sockets.connections.get("leaver")).toHaveLength(1);

    c.client.close();
    await c.closed;
    await vi.waitFor(() => expect(EchoSocket.sockets.connections.get("leaver")).toEqual([]));
  });

  it("id из параметра пути: соединение регистрируется под значением параметра", async () => {
    const c = connect(`${base}/rooms/r42`);
    expect(await c.opened).toBe(true);
    expect(EchoSocket.sockets.connections.get("r42")).toHaveLength(1);
    c.client.close();
    await c.closed;
  });

  it("без id (self.id пуст) соединение разрывается и в реестр не попадает", async () => {
    // сервер снимает сокеты прошлых тестов позже, чем клиент видит close: иначе снятие попадёт между снимком и проверкой
    await vi.waitFor(() => expect([...EchoSocket.sockets.connections.values()].flat()).toEqual([]));
    const before = new Map(EchoSocket.sockets.connections);
    const c = connect(`${base}/echo`);
    expect(await c.opened).toBe(false);
    await c.closed;
    expect(EchoSocket.sockets.connections).toEqual(before);
  });

  it("исключение в цепочке (гейт бросает) - соединение разрывается, сервер жив", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      steps.length = 0;
      const denied = connect(`${base}/echo`, { "x-user": "denied", "x-deny": "1" });
      expect(await denied.opened).toBe(false);
      await denied.closed;
      expect(steps).toEqual(["gate"]);
      expect(EchoSocket.sockets.connections.has("denied")).toBe(false);
    } finally {
      errors.mockRestore();
    }

    const ok = connect(`${base}/echo`, { "x-user": "after-deny" });
    expect(await ok.opened).toBe(true);
    ok.client.close();
    await ok.closed;
  });

  it("исключение в теле точки разрывает уже открытое соединение и снимает его с регистрации", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const c = connect(`${base}/echo`, { "x-user": "body-fail", "x-fail-body": "1" });
      await c.closed;
      await vi.waitFor(() =>
        expect(EchoSocket.sockets.connections.get("body-fail")).toEqual([]),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it.each(["/no-sockets", "/wrong-sockets"])(
    "Define бросает CONTROLLERS_WEBSOCKETS_WRONG_TARGET, если у контроллера нет sockets: AomWebSockets (%s)",
    async (path) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const c = connect(`${base}${path}`);
        expect(await c.opened).toBe(false);
        await c.closed;
        const thrown = errors.mock.calls.map(([, err]) => (err as Error)?.message);
        expect(thrown).toContain(CONTROLLERS_WEBSOCKETS_WRONG_TARGET);
      } finally {
        errors.mockRestore();
      }
    },
  );
});
