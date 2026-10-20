import { PassThrough } from "node:stream";
import { type OpenApiEventsResponse } from "@aom-js/router";
//
import { type ClassConstructor, type HttpResponse } from "../../types";

/** Options of an `AomServerEvents` registry. */
export declare type AomServerEventsOptions = {
  /** Interval of the `: ping` comment frame in ms; `0` turns it off. Default — 25000. */
  heartbeat?: number;
  /** Reconnect delay in ms the client is told once, in the first frame (`retry:`). */
  retry?: number;
};

const LINE_BREAK = /[\r\n]/;

/**
 * Renders one Server-Sent Events frame: `event:`, optional `id:`, `data:` with the JSON of
 * `data`, and the blank line closing the frame. `JSON.stringify` escapes line breaks, so `data`
 * is always one line.
 *
 * @throws {Error} when `event` or `eventId` contains a line break — it would split the frame
 */
export function formatServerEvent(event: string, data: unknown, eventId?: string): string {
  if (LINE_BREAK.test(event))
    throw new Error(`Server event name has a line break: ${JSON.stringify(event)}`);
  if (eventId !== undefined && LINE_BREAK.test(eventId)) {
    throw new Error(`Server event id has a line break: ${JSON.stringify(eventId)}`);
  }
  const id = eventId === undefined ? "" : `id: ${eventId}\n`;
  return `event: ${event}\n${id}data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Registry of Server-Sent Events streams, keyed by an application-defined connection id (e.g. an
 * employee id), typed by the dictionary `schemas` (event name → `\@ComponentSchema` class of its
 * `data`). The SSE route is a plain `\@Get` that returns `connect(id, res)`: `Server` pipes the
 * returned stream into the response. Streams live in the memory of the current process only:
 * `send`/`broadcast` reach this process's clients; other processes deliver through an isolator.
 */
export class AomServerEvents<E extends Record<string, ClassConstructor>> {
  connections: Map<string, PassThrough[]> = new Map();

  constructor(
    readonly schemas: E,
    readonly options: AomServerEventsOptions = {},
  ) {}

  /** OpenAPI response of the SSE route for `\@Responses(...)`: the stream with the events of `schemas`. */
  JSONSchema(description: string, status = 200): OpenApiEventsResponse {
    return { status, description, events: this.schemas };
  }

  /**
   * Sets the event-stream headers on `res`, opens a stream with the first frame (`retry:` or
   * `: connected` — headers leave at once, the client sees the connection open), registers it
   * under `id` with a heartbeat, and drops it from the registry when it closes.
   */
  connect(id: string, res: HttpResponse): PassThrough {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const { heartbeat = 25000, retry } = this.options;
    const stream = new PassThrough();
    stream.write(retry === undefined ? ": connected\n\n" : `retry: ${retry}\n\n`);
    this.connections.set(id, [...(this.connections.get(id) ?? []), stream]);

    const timer =
      heartbeat > 0 ? setInterval(() => stream.write(": ping\n\n"), heartbeat).unref() : undefined;
    stream.once("close", () => {
      clearInterval(timer);
      this.disconnect(id, stream);
    });
    return stream;
  }

  /** Removes `stream` from `id`'s streams; the last one removes the key. */
  disconnect(id: string, stream: PassThrough): this {
    const streams = (this.connections.get(id) ?? []).filter((item) => item !== stream);
    if (streams.length) this.connections.set(id, streams);
    else this.connections.delete(id);
    return this;
  }

  /** Writes event `event` with `data` to every stream registered under `id`; an unknown id is a no-op. */
  send<K extends keyof E & string>(
    id: string,
    event: K,
    data: InstanceType<E[K]>,
    eventId?: string,
  ): void {
    const frame = formatServerEvent(event, data, eventId);
    // shortcut: a slow client's PassThrough buffers without limit (write() result is ignored), cap or drop the stream once a client is seen lagging (KI-API-22)
    this.connections.get(id)?.forEach((stream) => stream.write(frame));
  }

  /** Writes event `event` with `data` to every stream of every id. */
  broadcast<K extends keyof E & string>(
    event: K,
    data: InstanceType<E[K]>,
    eventId?: string,
  ): void {
    this.connections.forEach((_streams, id) => this.send(id, event, data, eventId));
  }
}
