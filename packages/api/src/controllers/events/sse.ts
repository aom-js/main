import { PassThrough } from "node:stream";
import { OpenApi, type OpenApiEventsResponse } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";
//
import { type ClassConstructor, type HttpResponse } from "../../types";

/** Options of an `AomServerEvents` registry. */
export declare type AomServerEventsOptions = {
  /** Interval of the `: ping` comment frame in ms; `0` turns it off. Default — 25000. */
  heartbeat?: number;
  /** Reconnect delay in ms the client is told once, in the first frame (`retry:`). */
  retry?: number;
  /**
   * Check every value against its dictionary class (`Schemer.validate`: `plainToInstance` +
   * class-validator) before sending; a failed check throws at the sender. Default — on outside
   * production (`process.env.NODE_ENV !== "production"`).
   */
  validate?: boolean;
};

const schemer = new Schemer(OpenApi.refPointerPrefix);

const LINE_BREAK = /[\r\n]/;

/**
 * Event envelope of the dictionary `E`: `{ type: K, [K]: value }` for one key `K` of `E` — a union
 * over the keys. The client reads `type` and takes the value `envelope[envelope.type]`.
 */
export declare type EventEnvelope<E extends Record<string, ClassConstructor>> = {
  [K in keyof E & string]: { type: K } & { [P in K]: InstanceType<E[K]> };
}[keyof E & string];

/**
 * Renders one Server-Sent Events frame: optional `id:`, `data:` with the JSON of `data`, and the
 * blank line closing the frame. No `event:` line — the event type travels inside `data` (the
 * envelope), so the client listens to plain messages. `JSON.stringify` escapes line breaks, so
 * `data` is always one line.
 *
 * @throws {Error} when `eventId` contains a line break — it would split the frame
 */
export function formatServerEvent(data: unknown, eventId?: string): string {
  if (eventId !== undefined && LINE_BREAK.test(eventId)) {
    throw new Error(`Server event id has a line break: ${JSON.stringify(eventId)}`);
  }
  const id = eventId === undefined ? "" : `id: ${eventId}\n`;
  return `${id}data: ${JSON.stringify(data)}\n\n`;
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

  /** @throws {Error} when the dictionary has the key `type` — the envelope's type takes it */
  constructor(
    readonly schemas: E,
    readonly options: AomServerEventsOptions = {},
  ) {
    if (Object.hasOwn(schemas, "type")) throw new Error('Server events dictionary has the key "type"');
  }

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

  /** Writes the envelope `{ type, [type]: value }` to every stream registered under `id`; an unknown id is a no-op. */
  send<K extends keyof E & string>(
    id: string,
    type: K,
    value: InstanceType<E[K]>,
    eventId?: string,
  ): void {
    this.sendEnvelope(id, { type, [type]: value } as EventEnvelope<E>, eventId);
  }

  /** Writes the envelope `{ type, [type]: value }` to every stream of every id. */
  broadcast<K extends keyof E & string>(type: K, value: InstanceType<E[K]>, eventId?: string): void {
    this.broadcastEnvelope({ type, [type]: value } as EventEnvelope<E>, eventId);
  }

  /**
   * Writes a ready envelope (e.g. one that came over the bus) to every stream registered under `id`.
   *
   * @throws {Error} on a wrong envelope (see `frameOf`) — even when `id` has no streams
   */
  sendEnvelope(id: string, envelope: EventEnvelope<E>, eventId?: string): void {
    const frame = this.frameOf(envelope, eventId);
    // shortcut: a slow client's PassThrough buffers without limit (write() result is ignored), cap or drop the stream once a client is seen lagging (KI-API-22)
    this.connections.get(id)?.forEach((stream) => stream.write(frame));
  }

  /** Writes a ready envelope to every stream of every id; throws on a wrong envelope, as `sendEnvelope`. */
  broadcastEnvelope(envelope: EventEnvelope<E>, eventId?: string): void {
    const frame = this.frameOf(envelope, eventId);
    this.connections.forEach((streams) => streams.forEach((stream) => stream.write(frame)));
  }

  /**
   * Frame of a checked envelope.
   *
   * @throws {Error} when `type` is not in the dictionary, the value under `type` is `undefined`/`null`,
   * the envelope has keys besides `type` and its value, or (with `validate`) the value fails its class
   */
  private frameOf(envelope: EventEnvelope<E>, eventId?: string): string {
    const { type } = envelope;
    if (!Object.hasOwn(this.schemas, type)) {
      throw new Error(`Server event type is not in the dictionary: ${JSON.stringify(type)}`);
    }
    const value = (envelope as Record<string, unknown>)[type];
    if (value === undefined || value === null) throw new Error(`Server event "${type}" has no value`);
    const extra = Object.keys(envelope).filter((key) => key !== "type" && key !== type);
    if (extra.length) throw new Error(`Server event "${type}" has extra keys: ${extra.join(", ")}`);
    if (this.options.validate ?? process.env.NODE_ENV !== "production") {
      const { errors } = schemer.validate(this.schemas[type], value as object);
      if (errors.length) {
        throw new Error(`Server event "${type}" fails its schema: ${errors.map(String).join("; ")}`);
      }
    }
    return formatServerEvent(envelope, eventId);
  }
}
