import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import {
  Controller,
  Get,
  Ctx,
  Bridge,
  Middleware,
  Before,
  After,
  This,
  WebSocketPoint,
  Router,
  OpenApi,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import {
  Server,
  AomServerEvents,
  AomWebSockets,
  WebSocketsController,
  type HttpCtx,
} from "@aom-js/api";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (check: () => boolean, ms = 1000) => {
  for (const start = Date.now(); !check(); ) {
    if (Date.now() - start > ms) throw new Error("не дождались");
    await tick(5);
  }
};

// обработчик ждёт, пока тест его не отпустит
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open, started: false };
}

function get(url: string, agent: http.Agent | false) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get(url, { agent }, (res) => res.resume().once("end", () => resolve(res))).on("error", reject);
  });
}

describe("Server.stop()", () => {
  @ComponentSchema()
  class Ping {
    @PropertySchema.Number({})
    n!: number;
  }

  const events = new AomServerEvents({ ping: Ping }, { heartbeat: 0 });

  @Controller()
  class Sockets {
    static Sockets = new AomWebSockets();

    @Middleware()
    @Before(WebSocketsController.Define)
    @After(WebSocketsController.Connect)
    static async Id(@This(WebSocketsController) ws: WebSocketsController) {
      ws.id = "x";
    }

    @WebSocketPoint("/ws")
    @Before(Sockets.Id)
    static async Point() {}
  }

  @Controller()
  @Bridge("/", Sockets)
  class Root {
    static gate = gate();

    @Get("/slow")
    static async Slow() {
      Root.gate.started = true;
      await Root.gate.wait;
      return { ok: true };
    }

    @Get("/quick")
    static Quick() {
      return { ok: true };
    }

    @Get("/events")
    static Events(@Ctx() { res }: HttpCtx) {
      return events.connect("x", res);
    }
  }

  const docs = new OpenApi({ title: "t", version: "1" });

  async function start() {
    const server = new Server({ port: 0, url: "http://localhost" }, new Router(Root, docs));
    await new Promise((resolve) => server.server.once("listening", resolve));
    const { port } = server.server.address() as AddressInfo;
    return { server, port, base: `http://127.0.0.1:${port}` };
  }

  it("дожидается начатого запроса, новых соединений не принимает, простой keep-alive закрывает", async () => {
    const { server, base } = await start();
    Root.gate = gate();
    const keepAlive = new http.Agent({ keepAlive: true });
    // соединение, которое к остановке уже простаивает
    const idle = new http.Agent({ keepAlive: true });
    await get(`${base}/quick`, idle);

    const pending = get(`${base}/slow`, keepAlive);
    await until(() => Root.gate.started);

    let stopped = false;
    const stopping = server.stop().then(() => (stopped = true));
    await tick();
    expect(stopped).toBe(false);
    await expect(get(`${base}/slow`, false)).rejects.toThrow();

    Root.gate.open();
    expect((await pending).statusCode).toBe(200);
    // keep-alive соединения не держат остановку до своего таймаута (5 с)
    await Promise.race([stopping, tick(1000).then(() => Promise.reject(new Error("stop() ждёт keep-alive")))]);
    expect(server.server.listening).toBe(false);
    keepAlive.destroy();
    idle.destroy();
  });

  it("закрывает долгие соединения: поток SSE и WebSocket", async () => {
    const { server, base, port } = await start();

    const sse = await new Promise<http.IncomingMessage>((resolve) =>
      http.get(`${base}/events`, { agent: false }, resolve),
    );
    const sseClosed = new Promise((resolve) => sse.once("close", resolve));
    sse.resume();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => ws.once("open", resolve));
    const wsClosed = new Promise((resolve) => ws.once("close", resolve));

    await server.stop();
    await Promise.all([sseClosed, wsClosed]);
  });

  it("повторный stop() возвращает то же ожидание; stopAll() останавливает все серверы процесса", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    const first = a.server.stop();
    expect(a.server.stop()).toBe(first);

    await Server.stopAll();
    expect(a.server.server.listening).toBe(false);
    expect(b.server.server.listening).toBe(false);
  });
});
