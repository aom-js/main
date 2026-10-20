import { describe, it, expect, vi } from "vitest";
import type { PassThrough } from "node:stream";
import { AomServerEvents, formatServerEvent, type HttpResponse } from "@aom-js/api";

class Unread {
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
