import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  Controller,
  Get,
  Post,
  Options,
  Body,
  Query,
  Params,
  Cookies,
  Ctx,
  Router,
  OpenApi,
  WebSocketPoint,
  Middleware,
  Before,
  Run,
  type HandlerFunction,
} from "@aom-js/router";
import {
  Server,
  type AomServerSettings,
  type HttpCtx,
  type SocketCtx,
  MessageResponse,
  DataResponse,
  ConflictResponse,
  ErrorMessage,
  SeeOtherResponse,
  AuthRequiredResponse,
  BodyOptions,
  Logger,
} from "@aom-js/api";

// поток, который падает уже на первом чтении - имитирует, например, отсутствие файла на диске
class FailingStream extends Readable {
  _read() {
    this.destroy(new Error("no such file"));
  }
}

// бесконечный поток для проверки, что источник разрушается при обрыве клиента
let infiniteStream: Readable | undefined;

// шлём сырой HTTP-запрос по TCP и собираем ответ - нужно, чтобы отправить буквальные `..`-сегменты
// и разрезать тело между двумя независимыми `write`, чего через fetch() не добиться
function rawRequest(port: number, payload: string | Buffer, waitMs = 500): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let out = "";
    socket.on("data", (d) => (out += d.toString("latin1")));
    socket.on("error", () => resolve(out + "[error]"));
    socket.on("close", () => resolve(out));
    socket.write(payload);
    setTimeout(() => {
      socket.destroy();
      resolve(out + "[timeout]");
    }, waitMs);
  });
}

// конец тела ответа в накопленном буфере: по Content-Length, а если его нет - разбором
// chunked-кусков до нулевого (node отвечает именно chunked, когда длину заранее не знает).
// -1 - ответ ещё не дочитан
function responseEnd(head: string, buf: string, bodyStart: number): number {
  const length = head.match(/content-length:\s*(\d+)/i)?.[1];
  if (length !== undefined) return bodyStart + Number(length);
  if (!/transfer-encoding:[^\r\n]*chunked/i.test(head)) return bodyStart;

  let at = bodyStart;
  for (;;) {
    const lineEnd = buf.indexOf("\r\n", at);
    if (lineEnd === -1) return -1;
    const size = parseInt(buf.slice(at, lineEnd), 16);
    if (Number.isNaN(size)) return -1;
    // нулевой кусок закрывает тело: "0\r\n" плюс завершающий пустой блок трейлеров "\r\n"
    if (size === 0) return lineEnd + 4 <= buf.length ? lineEnd + 4 : -1;
    at = lineEnd + 2 + size + 2;
    if (at > buf.length) return -1;
  }
}

// несколько запросов по ОДНОМУ keep-alive соединению: следующий уходит только после полного ответа
// на предыдущий - иначе сервер получил бы их склеенными (pipelining) и тест проверял бы не то.
// waitMs - страховка от зависания: тест должен падать, а не ждать вечно
function keepAliveSession(
  port: number,
  payloads: Array<string | Buffer>,
  waitMs = 1000,
): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const responses: string[] = [];
    let rest = "";
    let sent = 0;
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(responses);
    };
    const timer = setTimeout(finish, waitMs);
    const sendNext = () => {
      if (sent < payloads.length) socket.write(payloads[sent++]);
      else finish();
    };
    socket.on("connect", sendNext);
    // сервер закрыл соединение сам (Connection: close) - отдаём то, что успели собрать
    socket.on("close", finish);
    socket.on("error", finish);
    socket.on("data", (d) => {
      // latin1: один байт - один символ, границы ответов считаются по байтам без декодирования
      rest += d.toString("latin1");
      for (;;) {
        const headEnd = rest.indexOf("\r\n\r\n");
        if (headEnd === -1) break;
        const total = responseEnd(rest.slice(0, headEnd), rest, headEnd + 4);
        if (total === -1 || rest.length < total) break;
        responses.push(rest.slice(0, total));
        rest = rest.slice(total);
        sendNext();
      }
    });
  });
}

@Controller()
class TestApi {
  @Get("/hello")
  static async hello() {
    return "hello world";
  }

  // строка с кириллицей - проверяем, что charset=utf-8 в заголовке не расходится с реальной кодировкой тела
  @Get("/hello-ru")
  static async helloRu() {
    return "Привет, мир";
  }

  // обработчик сам выставляет Content-Type до return - пакет не должен его перетирать дефолтом
  @Get("/hello-html")
  static async helloHtml(@Ctx() ctx: HttpCtx) {
    ctx.res.setHeader("Content-Type", "text/html; charset=utf-8");
    return "<p>hello</p>";
  }

  // условно "закрытый" маршрут - в реальности фильтруется прокси/WAF по пути запроса до приложения;
  // если приложение само переразбирает путь и вытаскивает из него "/admin", фильтр обходится
  @Get("/admin")
  static async admin() {
    return new MessageResponse("admin panel");
  }

  // тот же условно "закрытый" путь, но для upgrade-запросов (sockets) - тем же способом проверяем
  // обход по хосту через socket-маршрут
  @WebSocketPoint("/admin")
  static async wsAdmin(@Ctx() ctx: SocketCtx) {
    ctx.res.end("MATCHED\r\n");
  }

  @Get("/query-echo")
  static async queryEcho(@Query() query: any) {
    return new DataResponse("query", query);
  }

  @Get("/json")
  static async json() {
    return new MessageResponse("ok");
  }

  // параметр с валидатором прямо в пути: проверку делает сам regexp маршрута, отдельной
  // проверки значения после совпадения нет
  @Get("/items/:id(\\d+)")
  static async itemById(@Params("id") id: string) {
    return new DataResponse("item", { id });
  }

  @Get("/cookies")
  static async cookies(@Cookies() cookies: Record<string, string>) {
    return new DataResponse("cookies", cookies);
  }

  // точка в статической части пути - обычный символ, а не "любой символ"
  @Get("/file.json")
  static async fileJson() {
    return new MessageResponse("file");
  }

  @Post("/echo")
  static async echo(@Body() body: any) {
    return new DataResponse("echo", body);
  }

  @Get("/error-message")
  static async errorMessage() {
    throw new ConflictResponse("conflict happened");
  }

  @Get("/plain-error")
  static async plainError() {
    throw new Error("boom");
  }

  @Get("/status-error")
  static async statusError() {
    const err: any = new Error("nope");
    err.status = 418;
    throw err;
  }

  @Get("/invalid-status-error")
  static async invalidStatusError() {
    // статус вне допустимого HTTP-диапазона - раньше writeHead с ним ронял процесс
    const err: any = new Error("boom");
    err.status = 99999;
    throw err;
  }

  @Get("/em-invalid-status")
  static async emInvalidStatus() {
    // сам ErrorMessage со статусом вне HTTP-диапазона (например, от стороннего middleware)
    throw new ErrorMessage("bad status", 99999);
  }

  @Get("/em-bigint-data")
  static async emBigintData() {
    // несериализуемые data - JSON.stringify бросает уже внутри catch
    throw new ErrorMessage("bad data", 400, { n: 1n });
  }

  @Get("/infinite-stream")
  static async infiniteStream() {
    infiniteStream = new Readable({
      read() {
        this.push(Buffer.alloc(65536, 97));
      },
    });
    return infiniteStream;
  }

  @Get("/foreign-conflict")
  static async foreignConflict() {
    // сторонняя ошибка с "чужим" полем status и текстом, который не должен уйти клиенту
    const err: any = new Error("secret internal detail XYZ");
    err.status = 409;
    throw err;
  }

  @Get("/headers-sent-then-throw")
  static async headersSentThenThrow(@Ctx() ctx: HttpCtx) {
    // обработчик сам начал отвечать и затем бросил - catch не должен вызывать writeHead повторно
    ctx.res.writeHead(200, { "Content-Type": "text/plain" });
    ctx.res.write("partial");
    throw new Error("late failure with secret token ABC123");
  }

  @Get("/stream-ok")
  static async streamOk() {
    return Readable.from(["chunk-a", "chunk-b"]);
  }

  @Get("/stream-fail")
  static async streamFail() {
    return new FailingStream();
  }

  @Get("/stream-custom-type")
  static async streamCustomType(@Ctx() ctx: HttpCtx) {
    ctx.res.setHeader("Content-Type", "image/png");
    return Readable.from(["binary-data"]);
  }

  @Options("/custom-options")
  static async customOptions() {
    return new MessageResponse("custom options handled");
  }

  @Get("/em-1xx-status")
  static async em1xxStatus() {
    // 1xx - промежуточный информационный статус, не окончательный ответ
    throw new ErrorMessage("too early", 102);
  }

  @Get("/em-see-other")
  static async emSeeOther() {
    throw new SeeOtherResponse("see other");
  }

  @Get("/poison-log-error")
  static async poisonLogError() {
    // объект, у которого само форматирование (console.error -> util.inspect) бросает - причём
    // бросает себя же (self-reference), а не "чистую" ошибку, иначе повторный catch выше по цепочке
    // залогирует уже безобидный новый объект и подмена останется незамеченной
    const err: any = new Error("boom");
    err[Symbol.for("nodejs.util.inspect.custom")] = () => {
      throw err;
    };
    throw err;
  }
}

// отдельный контроллер и сервер - для проверки, что путь из settings.url по-прежнему
// приклеивается префиксом к запросу (старое поведение, которое нельзя менять без автора)
@Controller()
class PrefixApi {
  @Get("/api/users")
  static async users() {
    return new MessageResponse("prefixed users");
  }
}

describe("Server: HTTP-конвейер", () => {
  let server: Server;
  let base: string;
  let port: number;

  beforeAll(() => {
    const docs = new OpenApi({ title: "test", version: "1" });
    const router = new Router(TestApi, docs);
    // порт 0 - слушаем свободный порт, реальный узнаём из server.address() после старта
    const settings: AomServerSettings = { port: 0, url: "http://localhost" };
    server = new Server(settings, router);
    port = (server.server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.server.close();
  });

  it("параметр с валидатором: значение по шаблону попадает в params", async () => {
    const res = await fetch(`${base}/items/42`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: "42" });
  });

  it("параметр с валидатором: значение не по шаблону -> 404, а не маршрут без параметра", async () => {
    const res = await fetch(`${base}/items/abc`);
    expect(res.status).toBe(404);
  });

  it("cookie: значение с '=' целиком и декодировано, битое %-кодирование - как есть", async () => {
    const res = await fetch(`${base}/cookies`, {
      headers: { cookie: "token=a=b==; name=%D0%AF%20x; bad=%E0%A4%A" },
    });
    const body = await res.json();
    expect(body.data).toEqual({ token: "a=b==", name: "Я x", bad: "%E0%A4%A" });
  });

  it("точка в пути маршрута - обычный символ: /file.json совпадает", async () => {
    const res = await fetch(`${base}/file.json`);
    expect(res.status).toBe(200);
  });

  it("точка в пути маршрута не подменяет собой любой символ: /fileXjson -> 404", async () => {
    const res = await fetch(`${base}/fileXjson`);
    expect(res.status).toBe(404);
  });

  it("404: ответ приходит с Content-Type application/json", async () => {
    const res = await fetch(`${base}/no-such-route`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  describe("строка по умолчанию - text/plain, HTML только явно", () => {
    it("строковый результат обработчика уходит как text/plain; charset=utf-8, а не text/html", async () => {
      const res = await fetch(`${base}/hello`);
      expect(res.status).toBe(200);
      // именно этот заголовок не даёт браузеру исполнить строку как разметку
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("hello world");
    });

    it("обработчик, выставивший Content-Type сам, получает его - text/plain не перетирает", async () => {
      const res = await fetch(`${base}/hello-html`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe("<p>hello</p>");
    });

    it("кириллица в строковом результате приходит без искажений", async () => {
      const res = await fetch(`${base}/hello-ru`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("Привет, мир");
    });
  });

  describe("content-type с параметрами и битый JSON", () => {
    it("charset после `;` не мешает распознать application/json", async () => {
      const res = await fetch(`${base}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ a: 1 }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ a: 1 });
    });

    it("регистр content-type не значим", async () => {
      const res = await fetch(`${base}/echo`, {
        method: "POST",
        headers: { "content-type": "Application/JSON; charset=utf-8" },
        body: JSON.stringify({ b: 2 }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ b: 2 });
    });

    it("битый JSON -> 400 ERROR_WRONG_DATA, а не 500", async () => {
      const res = await fetch(`${base}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{не json",
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.message).toBe("AOM_API:ERROR_WRONG_DATA");
    });
  });

  describe("единый catch и потоки", () => {
    it("ErrorMessage-потомок уходит клиенту как есть", async () => {
      const res = await fetch(`${base}/error-message`);
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body).toMatchObject({ status: 409, message: "conflict happened" });
    });

    it("обычный Error -> 500 с кодом ошибки, а не пустым {}", async () => {
      const res = await fetch(`${base}/plain-error`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.message).toBe("AOM_API:SERVER_ERROR");
      expect(body.message).not.toBe("boom");
    });

    it("ошибка с числовым status 400-599 -> статус сохранён, текст исключения не уходит", async () => {
      const res = await fetch(`${base}/status-error`);
      const body = await res.json();
      expect(res.status).toBe(418);
      expect(body.status).toBe(418);
      expect(body.message).not.toBe("nope"); // текст чужого исключения клиенту не отдаётся
    });

    it("сторонняя ошибка с известным статусом -> код готового ответа пакета, без текста исключения", async () => {
      const res = await fetch(`${base}/foreign-conflict`);
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.message).toBe("AOM_API:ERROR_CONFLICT");
      expect(JSON.stringify(body)).not.toContain("secret internal detail");
    });

    it("status вне HTTP-диапазона (99999) -> 500, а не падение процесса", async () => {
      const res = await fetch(`${base}/invalid-status-error`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.message).toBe("AOM_API:SERVER_ERROR");
    });

    it("обработчик уже начал отвечать сам и бросил -> соединение закрыто, без повторного writeHead", async () => {
      // заголовки и часть тела уже ушли до броска - catch лишь обрывает соединение (res.destroy()),
      // а не пытается сменить статус повторным writeHead (это уронило бы процесс - ERR_HTTP_HEADERS_SENT)
      await expect(fetch(`${base}/headers-sent-then-throw`)).rejects.toThrow();
    });

    it("успешный поток отдаётся с типом application/octet-stream по умолчанию", async () => {
      const res = await fetch(`${base}/stream-ok`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(await res.text()).toBe("chunk-achunk-b");
    });

    it("поток с Content-Type, выставленным обработчиком - тип не затирается", async () => {
      const res = await fetch(`${base}/stream-custom-type`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("ошибка потока до отправки заголовков -> соединение закрыто, процесс не падает", async () => {
      // pipeline (в отличие от pipe) сам разрушает весь конвейер, включая res, уже к моменту вызова
      // колбэка - отдать корректный JSON после этого нельзя, но процесс не падает и клиент не зависает
      await expect(fetch(`${base}/stream-fail`)).rejects.toThrow();
    });

    it("ErrorMessage с невалидным собственным статусом (99999) -> 500, а не падение процесса", async () => {
      const res = await fetch(`${base}/em-invalid-status`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.message).toBe("AOM_API:SERVER_ERROR");
    });

    it("ErrorMessage с несериализуемыми data (BigInt) -> 500, а не падение процесса", async () => {
      const res = await fetch(`${base}/em-bigint-data`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.message).toBe("AOM_API:SERVER_ERROR");
    });
  });

  describe("Аудит безопасности: разбор адреса и защитная сетка (HIGH)", () => {
    it("GET с `..`-путём в адресе не роняет процесс и получает ответ, а не зависание", async () => {
      const out = await rawRequest(
        port,
        "GET /../.. HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      // /../.. нормализуется WHATWG URL до "/" - маршрута нет -> 404, а не таймаут и не обрыв
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it("OPTIONS с `..`-путём в адресе не роняет процесс и получает ответ", async () => {
      const out = await rawRequest(
        port,
        "OPTIONS /../.. HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      // маршрута на OPTIONS для "/" нет -> preflight-дефолт 204
      expect(out).toMatch(/^HTTP\/1\.1 204 /);
    });

    it("после `..`-запросов сервер по-прежнему жив и отвечает на обычные запросы", async () => {
      const res = await fetch(`${base}/hello`);
      expect(res.status).toBe(200);
    });
  });

  describe("Аудит безопасности: обрыв скачивания уничтожает источник (MEDIUM)", () => {
    it("клиент обрывает соединение -> исходный поток разрушается (pipeline), не течёт", async () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.write("GET /infinite-stream HTTP/1.1\r\nHost: x\r\n\r\n");
      await new Promise<void>((resolve) => socket.once("data", () => resolve()));
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(infiniteStream?.destroyed).toBe(true);
    });
  });

  describe("Аудит безопасности: многобайтовый UTF-8 на границе TCP-чанков", () => {
    it("символ, разрезанный между двумя write - тело разбирается без потери байт", async () => {
      const bodyStr = JSON.stringify({ text: "日本語" });
      const bodyBuf = Buffer.from(bodyStr, "utf-8");
      const charBuf = Buffer.from("日", "utf-8");
      const charIndex = bodyBuf.indexOf(charBuf);
      const splitAt = charIndex + 1; // режем ровно посередине многобайтовой последовательности
      const headerBuf = Buffer.from(
        `POST /echo HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${bodyBuf.length}\r\nConnection: close\r\n\r\n`,
        "latin1",
      );

      const socket = net.connect(port, "127.0.0.1");
      const chunks: Buffer[] = [];
      const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
      socket.on("data", (d) => chunks.push(d));
      socket.write(Buffer.concat([headerBuf, bodyBuf.subarray(0, splitAt)]));
      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.write(bodyBuf.subarray(splitAt));
      await closed;

      // ответ может уйти chunked-кодированием (Transfer-Encoding) - вместо разбора его framing
      // просто вырезаем JSON-объект между первой `{` и последней `}`
      const raw = Buffer.concat(chunks).toString("utf-8");
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      expect(json.data).toEqual({ text: "日本語" });
    });
  });

  describe("CORS-заголовки", () => {
    it("Access-Control-Allow-Headers отражает access-control-request-headers", async () => {
      const res = await fetch(`${base}/hello`, {
        method: "OPTIONS",
        headers: { "access-control-request-headers": "X-Custom-Header" },
      });
      expect(res.headers.get("access-control-allow-headers")).toBe("X-Custom-Header");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("без запрошенных заголовков остаётся прежний дефолт", async () => {
      const res = await fetch(`${base}/hello`, { method: "OPTIONS" });
      expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type,Authorization");
    });
  });

  describe("OPTIONS сначала ищет маршрут", () => {
    it("собственный @Options()-эндпоинт исполняется, а не получает 204", async () => {
      const res = await fetch(`${base}/custom-options`, { method: "OPTIONS" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.message).toBe("custom options handled");
    });

    it("без маршрута OPTIONS по-прежнему отвечает 204", async () => {
      const res = await fetch(`${base}/hello`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });
  });

  describe("Аудит безопасности: хост из запроса не должен участвовать в сопоставлении маршрута (MEDIUM)", () => {
    it("authority-form //evil.com/admin не даёт хосту подменить путь - 404", async () => {
      const out = await rawRequest(
        port,
        "GET //evil.com/admin HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it("абсолютная форма (GET http://evil.com/admin) не даёт хосту подменить путь - 404", async () => {
      const out = await rawRequest(
        port,
        "GET http://evil.com/admin HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it("абсолютная форма с портом и query (https://evil.com:8443/admin?x=1) - 404", async () => {
      const out = await rawRequest(
        port,
        "GET https://evil.com:8443/admin?x=1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it("путь из settings.url по-прежнему приклеивается префиксом к запросу (старое поведение)", async () => {
      const docs = new OpenApi({ title: "prefix-test", version: "1" });
      const router = new Router(PrefixApi, docs);
      const prefixed = new Server({ port: 0, url: "http://localhost/api" }, router);
      try {
        const { port: prefixedPort } = prefixed.server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${prefixedPort}/users`);
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.message).toBe("prefixed users");
      } finally {
        prefixed.server.close();
      }
    });

    it("/../.. по-прежнему не роняет процесс и получает 404", async () => {
      const out = await rawRequest(
        port,
        "GET /../.. HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it("многопараметрический query по-прежнему разбирается верно (/admin?x=1&y=2)", async () => {
      const res = await fetch(`${base}/query-echo?x=1&y=2`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ x: "1", y: "2" });
    });
  });

  describe('Аудит безопасности: обратный слэш (\\) WHATWG считает тем же "/" - хост всё равно не подменяется', () => {
    const backslashPaths = ["/\\evil.com/admin", "/\\/evil.com/admin", "//\\evil.com/admin"];

    it.each(backslashPaths)("GET %s -> 404, а не маршрут /admin", async (path) => {
      const out = await rawRequest(
        port,
        `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it.each(backslashPaths)("upgrade %s -> сокет-маршрут /admin не срабатывает", async (path) => {
      const out = await rawRequest(
        port,
        `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
      expect(out).not.toContain("MATCHED");
    });

    it("upgrade /admin (легитимный путь) по-прежнему срабатывает", async () => {
      const out = await rawRequest(
        port,
        "GET /admin HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      expect(out).toContain("MATCHED");
    });
  });

  describe("Фрагмент (#) отбрасывается до разбора пути, как раньше", () => {
    it("/admin#x -> маршрут /admin (фрагмент отброшен, а не закодирован в путь)", async () => {
      const out = await rawRequest(
        port,
        "GET /admin#x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 200 /);
    });

    it('/query-echo?x=1#y -> x = "1" (фрагмент отброшен, а не приклеен к query)', async () => {
      // fetch() сам обрезает фрагмент на клиенте - берём сырой сокет, чтобы реально отправить "#"
      const out = await rawRequest(
        port,
        "GET /query-echo?x=1#y HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      const body = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
      expect(out).toMatch(/^HTTP\/1\.1 200 /);
      expect(body.data).toEqual({ x: "1" });
    });

    it("percent-кодированный /%23 остаётся путём и не матчится ни одним маршрутом - 404", async () => {
      const out = await rawRequest(
        port,
        "GET /%23 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
      expect(out).toMatch(/^HTTP\/1\.1 404 /);
    });

    it('percent-кодированный ?a=%23 передаёт значение "#" как обычный символ query', async () => {
      const res = await fetch(`${base}/query-echo?a=%23`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ a: "#" });
    });
  });

  describe("Аудит безопасности: логирование ошибки само не должно ронять соединение (LOW)", () => {
    it("объект с бросающим util.inspect.custom -> соединение закрыто, сервер жив", async () => {
      await expect(fetch(`${base}/poison-log-error`)).rejects.toThrow();
      const res = await fetch(`${base}/hello`);
      expect(res.status).toBe(200);
    });
  });

  describe("Аудит безопасности: ErrorMessage со статусом 1xx - не финальный ответ (LOW)", () => {
    it("статус 1xx подменяется на 500, а не зависает как промежуточный ответ", async () => {
      const res = await fetch(`${base}/em-1xx-status`);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.message).toBe("AOM_API:SERVER_ERROR");
    });

    it("SeeOtherResponse (303) по-прежнему доходит до клиента как окончательный ответ", async () => {
      const res = await fetch(`${base}/em-see-other`, { redirect: "manual" });
      expect(res.status).toBe(303);
    });
  });
});

// тело запроса читается лениво. Отдельный сервер с маленьким глобальным лимитом -
// чтобы тесты не гоняли мегабайты ради превышения
let guardedBodyRead = false;
let interceptedStatus: number | undefined;
// см. docs/cookbook/lazy-body-and-limits.md#порядок-решает--важнейшая-оговорка: билдер тела, поставленный
// в @Before раньше проверки доступа, снова читает тело первым
let wrongOrderBodyRead = false;

@Controller()
class BodyLimitApi {
  // отказ в доступе до любого обращения к телу: если сервер читает тело раньше проверок,
  // запрос с заявленным, но не отправленным телом повиснет вместо 401
  @Middleware()
  static async Guard() {
    throw new AuthRequiredResponse("auth required");
  }

  // перехватчик приложения: ошибка чтения тела возникает ВНУТРИ цепочки маршрута, а не до неё,
  // поэтому её видит next() - и может залогировать/подменить, как любую другую ошибку цепочки
  @Middleware()
  static async Intercept(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
    try {
      return await next(BodyLimitApi.ReadBody);
    } catch (err: any) {
      interceptedStatus = err?.status;
      throw err;
    }
  }

  @Middleware()
  static async ReadBody(@Body() _body: any) {}

  @Post("/guarded")
  @Before(BodyLimitApi.Guard)
  static async guarded(@Body() body: any) {
    guardedBodyRead = true;
    return new DataResponse("guarded", body);
  }

  @Post("/echo")
  static async echo(@Body() body: any) {
    return new DataResponse("echo", body);
  }

  // маршрут, которому тело не нужно: поток не читается вообще
  @Post("/no-body")
  static async noBody() {
    return new MessageResponse("no body needed");
  }

  @Get("/ping")
  static async ping() {
    return new MessageResponse("pong");
  }

  @Post("/big-limit")
  @BodyOptions({ limit: 65536 })
  static async bigLimit(@Body() body: any) {
    return new DataResponse("big", body);
  }

  @Post("/small-limit")
  @BodyOptions({ limit: 64 })
  static async smallLimit(@Body() body: any) {
    return new DataResponse("small", body);
  }

  @Post("/intercepted")
  @Before(BodyLimitApi.Intercept)
  static async intercepted(@Body() body: any) {
    return new DataResponse("intercepted", body);
  }

  // антипример: билдер тела (своё @Body) стоит в @Before раньше проверки доступа
  @Middleware()
  static async ReadsBodyFirst(@Body() _body: any) {
    wrongOrderBodyRead = true;
  }

  @Post("/wrong-order")
  @Before(BodyLimitApi.ReadsBodyFirst, BodyLimitApi.Guard)
  static async wrongOrder(@Body() body: any) {
    return new DataResponse("wrong-order", body);
  }
}

describe("Server: ленивое чтение тела и лимит размера", () => {
  let server: Server;
  let base: string;
  let port: number;

  // тело на 4 КиБ - заведомо больше глобального лимита (1 КиБ) и заведомо меньше лимита,
  // заданного маркером на /big-limit (64 КиБ)
  const bigBody = JSON.stringify({ text: "x".repeat(4096) });
  // тело на ~200 байт - меньше глобального лимита, но больше маркерного лимита /small-limit (64)
  const smallBody = JSON.stringify({ text: "y".repeat(200) });

  const rawPost = (path: string, body: string, extra = "") =>
    `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n${extra}\r\n${body}`;

  beforeAll(() => {
    const docs = new OpenApi({ title: "test", version: "1" });
    const router = new Router(BodyLimitApi, docs);
    const settings: AomServerSettings = { port: 0, url: "http://localhost", bodyLimit: 1024 };
    server = new Server(settings, router);
    port = (server.server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.server.close();
  });

  it("отказ в доступе отвечает 401, не дожидаясь тела", async () => {
    // тело заявлено в Content-Length, но не отправлено вовсе: пока тело читалось до запуска
    // маршрута, такой запрос висел до таймаута - теперь 401 приходит сразу
    const out = await rawRequest(
      port,
      `POST /guarded HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 4096\r\nConnection: close\r\n\r\n`,
      1000,
    );
    expect(out).toMatch(/^HTTP\/1\.1 401 /);
    // до @Body исполнение не дошло - тело никто не просил и не читал
    expect(guardedBodyRead).toBe(false);
  });

  it("413 по заявленному Content-Length: поток не читался, keep-alive соединение живо", async () => {
    const responses = await keepAliveSession(port, [
      rawPost("/echo", bigBody),
      "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n",
    ]);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatch(/^HTTP\/1\.1 413 /);
    expect(responses[0]).toContain("AOM_API:ERROR_PAYLOAD_TOO_LARGE");
    // отказ случился до первого чтения потока - рантайм сам сольёт тело, закрывать нечего
    expect(responses[0]).not.toMatch(/\r\nConnection: close\r\n/i);
    expect(responses[1]).toMatch(/^HTTP\/1\.1 200 /);
  });

  it("413 по ходу чтения (длина не заявлена) несёт Connection: close", async () => {
    // chunked: Content-Length нет, превышение видно только по факту прочитанных байт. Остаток
    // тела остался непрочитанным, и на живом соединении был бы разобран как следующий запрос
    const chunk = "z".repeat(2048);
    const out = await rawRequest(
      port,
      `POST /echo HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
        `Transfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n`,
      1000,
    );
    expect(out).toMatch(/^HTTP\/1\.1 413 /);
    expect(out).toMatch(/\r\nConnection: close\r\n/i);
  });

  it("тело, которое маршрут не запрашивает, не ломает следующий запрос по тому же соединению", async () => {
    const responses = await keepAliveSession(port, [
      rawPost("/no-body", bigBody),
      "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n",
    ]);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatch(/^HTTP\/1\.1 200 /);
    expect(responses[1]).toMatch(/^HTTP\/1\.1 200 /);
  });

  it("@BodyOptions перекрывает глобальный лимит в большую сторону", async () => {
    const res = await fetch(`${base}/big-limit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bigBody,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(JSON.parse(bigBody));
  });

  it("@BodyOptions перекрывает глобальный лимит в меньшую сторону", async () => {
    const limited = await fetch(`${base}/small-limit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: smallBody,
    });
    expect(limited.status).toBe(413);
    expect((await limited.json()).message).toBe("AOM_API:ERROR_PAYLOAD_TOO_LARGE");

    // то же тело на маршруте без маркера проходит - значит дело именно в маркере, а не в размере
    const plain = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: smallBody,
    });
    expect(plain.status).toBe(200);
  });

  it("не-JSON content-type даёт {} и не упирается в лимит (на этом держится formidable)", async () => {
    const res = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: bigBody,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({});
  });

  it("битый JSON по-прежнему 400, а не 500", async () => {
    const res = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.message).toBe("AOM_API:ERROR_WRONG_DATA");
  });

  it("413 виден перехватчику приложения (@Run) и доходит до клиента", async () => {
    interceptedStatus = undefined;
    const res = await fetch(`${base}/intercepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bigBody,
    });
    expect(res.status).toBe(413);
    // ошибка чтения тела теперь возникает внутри цепочки маршрута - next() её видит
    expect(interceptedStatus).toBe(413);
  });

  it("битый JSON на маршруте, который не запрашивает тело, не даёт 400 - тело не читается", async () => {
    // /no-body не содержит @Body нигде в цепочке - разбор тела не запускается вообще,
    // поэтому даже невалидный JSON не всплывает ошибкой
    const res = await fetch(`${base}/no-body`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect(res.status).toBe(200);
  });

  it("антипример: билдер тела в @Before раньше проверки доступа - тело читается раньше отказа", async () => {
    wrongOrderBodyRead = false;
    const res = await fetch(`${base}/wrong-order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    // Guard всё равно отказывает - но ReadsBodyFirst стоит в @Before раньше него и уже
    // успел прочитать тело до отказа: выигрыш "неавторизованный не читает тело" здесь не работает
    expect(res.status).toBe(401);
    expect(wrongOrderBodyRead).toBe(true);
  });

  it("bodyLimit: 0 - глобальное ограничение снято, большое тело проходит", async () => {
    const docs = new OpenApi({ title: "unlimited", version: "1" });
    const router = new Router(BodyLimitApi, docs);
    const unlimited = new Server({ port: 0, url: "http://localhost", bodyLimit: 0 }, router);
    try {
      const { port: unlimitedPort } = unlimited.server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${unlimitedPort}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // bigBody (4 КиБ) больше глобального лимита соседнего сервера (1 КиБ) - на этом сервере
        // лимита нет вовсе
        body: bigBody,
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual(JSON.parse(bigBody));
    } finally {
      unlimited.server.close();
    }
  });
});

// уровень записи логгера зависит от класса статуса, а не от точного кода
@Controller()
class LoggerApi {
  @Get("/ok")
  @Before(Logger.Init)
  static async ok() {
    return new MessageResponse("ok");
  }

  @Get("/see-other")
  @Before(Logger.Init)
  static async seeOther() {
    throw new SeeOtherResponse("see other");
  }

  @Get("/conflict")
  @Before(Logger.Init)
  static async conflict() {
    throw new ConflictResponse("conflict");
  }

  @Get("/boom")
  @Before(Logger.Init)
  static async boom() {
    throw new Error("boom");
  }
}

describe("Logger: уровень записи по классу статуса", () => {
  let server: Server;
  let base: string;
  const records: Array<{ level: string; status?: number }> = [];
  const engine = Logger.ENGINE;

  // движок-перехватчик: запоминаем уровень и статус закрывающей записи, в консоль не пишем
  const record = (level: string) => (message: any, log?: any) => {
    records.push({ level, status: log?.status });
  };

  beforeAll(() => {
    Logger.ENGINE = {
      info: record("info"),
      log: record("log"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    };
    const docs = new OpenApi({ title: "logger", version: "1" });
    const router = new Router(LoggerApi, docs);
    server = new Server({ port: 0, url: "http://localhost" }, router);
    base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    Logger.ENGINE = engine;
    server.server.close();
  });

  // закрывающая запись - та, в которой уже проставлен status: открывающая ("Logger initiated")
  // пишется до ответа и статуса ещё не знает
  const closing = async (path: string) => {
    records.length = 0;
    await fetch(`${base}${path}`);
    // finish-обработчик вызывается после того, как ответ ушёл клиенту
    await new Promise((resolve) => setTimeout(resolve, 50));
    return records.filter((r) => r.status !== undefined).at(-1);
  };

  it("200 - info", async () => {
    expect(await closing("/ok")).toEqual({ level: "info", status: 200 });
  });

  it("303 - info, а не error: успешный, но не 200 ответ больше не считается ошибкой", async () => {
    expect(await closing("/see-other")).toEqual({ level: "info", status: 303 });
  });

  it("409 - warn: ошибка на стороне клиента, а не сервиса", async () => {
    expect(await closing("/conflict")).toEqual({ level: "warn", status: 409 });
  });

  it("500 - error", async () => {
    expect(await closing("/boom")).toEqual({ level: "error", status: 500 });
  });
});
