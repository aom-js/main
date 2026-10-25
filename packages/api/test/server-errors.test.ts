import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { Controller, Get, Router, OpenApi } from "@aom-js/router";
import { Server, I18nizer, Logger, NotFoundResponse, type AomLoggerEngine } from "@aom-js/api";

describe("Server: локализация 404 и журнал ошибок", () => {
  @Controller()
  class ErrorsApi {
    @Get("/missing")
    static async missing() {
      throw new NotFoundResponse("APP:MISSING");
    }

    @Get("/third-party-4xx")
    static async thirdParty4xx() {
      throw Object.assign(new Error("bad input"), { status: 400 });
    }

    @Get("/boom")
    static async boom() {
      throw new Error("boom");
    }
  }

  let server: Server;
  let base: string;
  const engine = Logger.ENGINE;
  // a journal engine as the docs show it: it expects a Logger record and reads its route
  const record = vi.fn((_message: string, log: Logger) => log.route.path);
  const recordEngine = { info: record, log: record, warn: record, error: record, debug: record };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeAll(() => {
    Logger.ENGINE = recordEngine satisfies AomLoggerEngine;
    const router = new Router(ErrorsApi, new OpenApi({ title: "errors", version: "1" }));
    const i18nizer = new I18nizer("en", "x-locale", "locale");
    server = new Server({ port: 0, url: "http://localhost" }, router, i18nizer);
    base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    Logger.ENGINE = engine;
    consoleError.mockRestore();
    server.server.close();
  });

  beforeEach(() => {
    record.mockClear();
    consoleError.mockClear();
  });

  it("адрес без маршрута отвечает переведённым сообщением", async () => {
    const ru = await fetch(`${base}/nowhere?locale=ru`);
    expect(ru.status).toBe(404);
    expect((await ru.json()).message).toBe("Адрес не найден");

    const en = await fetch(`${base}/nowhere`);
    expect((await en.json()).message).toBe("Path not found");
  });

  it("брошенный ответ 4xx сервер не пишет: это ожидаемый ответ, его записывает Logger", async () => {
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(consoleError).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("стороннее исключение со статусом 4xx - тоже без записи", async () => {
    const response = await fetch(`${base}/third-party-4xx`);
    expect(response.status).toBe(400);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("неожиданное исключение - console.error вместе с самим исключением, движок журнала не получает чужое", async () => {
    const response = await fetch(`${base}/boom`);
    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
    expect((consoleError.mock.calls[0][1] as Error).message).toBe("boom");
    expect(record).not.toHaveBeenCalled();
  });
});
