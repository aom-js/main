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
  const fake = {
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } satisfies AomLoggerEngine;

  beforeAll(() => {
    Logger.ENGINE = fake;
    const router = new Router(ErrorsApi, new OpenApi({ title: "errors", version: "1" }));
    const i18nizer = new I18nizer("en", "x-locale", "locale");
    server = new Server({ port: 0, url: "http://localhost" }, router, i18nizer);
    base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    Logger.ENGINE = engine;
    server.server.close();
  });

  beforeEach(() => {
    Object.values(fake).forEach((fn) => fn.mockClear());
  });

  it("адрес без маршрута отвечает переведённым сообщением", async () => {
    const ru = await fetch(`${base}/nowhere?locale=ru`);
    expect(ru.status).toBe(404);
    expect((await ru.json()).message).toBe("Адрес не найден");

    const en = await fetch(`${base}/nowhere`);
    expect((await en.json()).message).toBe("Path not found");
  });

  it("брошенный ответ 4xx - warn через движок логгера, без стека и без error", async () => {
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(fake.error).not.toHaveBeenCalled();
    expect(fake.warn).toHaveBeenCalledTimes(1);
    const args = fake.warn.mock.calls[0];
    expect(args.some((arg) => arg instanceof Error)).toBe(false);
    expect(JSON.stringify(args)).toContain("APP:MISSING");
    expect(JSON.stringify(args)).not.toContain("at ");
  });

  it("стороннее исключение со статусом 4xx - тоже warn", async () => {
    const response = await fetch(`${base}/third-party-4xx`);
    expect(response.status).toBe(400);
    expect(fake.error).not.toHaveBeenCalled();
    expect(fake.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fake.warn.mock.calls[0])).toContain("bad input");
  });

  it("неожиданное исключение - error через движок логгера вместе с самим исключением", async () => {
    const response = await fetch(`${base}/boom`);
    expect(response.status).toBe(500);
    expect(fake.warn).not.toHaveBeenCalled();
    expect(fake.error).toHaveBeenCalledTimes(1);
    expect(fake.error.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(fake.error.mock.calls[0][1].message).toBe("boom");
  });
});
