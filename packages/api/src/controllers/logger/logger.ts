import crypto from "node:crypto";
import {
  Controller,
  Ctx,
  Cursor,
  AomCursor,
  AomRoute,
  Middleware,
  OnInstance,
} from "@aom-js/router";
import { Route, AomApi, This } from "@aom-js/router";
//
import { type HttpCtx, type HttpRequest } from "../../types";
import { AomLoggerEngine } from "./types";
//
class LoggerAttachments {
  result: any;

  constructor(constructor: any) {
    this.result = () => AomApi.instance(constructor);
  }

  toJSON() {
    return Reflect.apply(this.result, null, []);
  }
}

/**
 * Per-request logger: tracks timing and status, and logs through a pluggable engine
 * (`static ENGINE`, defaults to `console`; swap it for `pino`/`winston`/etc by assigning a
 * compatible `{ info, log, warn, error, debug }` object before the server starts handling
 * requests).
 *
 * @example
 * ```ts
 * import { Logger } from "@aom-js/api";
 * import pino from "pino";
 *
 * Logger.ENGINE = pino({ timestamp: true });
 *
 * // in a controller:
 * // \@Before(Logger.Init)
 * // static async handler(\@This(Logger) log: Logger) { ... }
 * ```
 */
@Controller()
export class Logger {
  /** Logging backend; defaults to `console`. Assign a `pino`/`winston`-compatible object to replace it. */
  static ENGINE: AomLoggerEngine = console;

  // request!: HttpRequest; // request data

  /** Unique key for this request, made of a timestamp and random bytes. */
  idempotenceKey: string; // unique request key

  /** Timestamp of the most recent log record written for this request. */
  currentDate!: Date; // record date

  /** When this `Logger` instance was created (start of the request). */
  startDate: Date; // request start time

  /** When the response finished or errored; set by `Init`'s `finish`/`error` listener. */
  finishDate!: Date; // request completion time

  /** The route being executed, set by `Init`. */
  route!: AomRoute; // route being executed

  /** Final HTTP status code, set from `ctx.res.statusCode` when the response finishes. */
  status!: number; // final status

  /** Milliseconds since `startDate`, refreshed on each `Watch` call and at request completion. */
  lifetime!: number; // request lifetime

  /** Milliseconds between `startDate` and `finishDate`, set at request completion. */
  duration!: number; // request execution duration

  /** Reserved for the request's error, if any; not currently populated anywhere in this class (see the `// !! todo` note in `Init`). */
  error!: Error; // error in the request

  /** Middlewares/endpoints attached via `Attach`, keyed by their constructor name. */
  attachments: Record<string, {}> = {}; // attachments

  constructor() {
    this.idempotenceKey = `${Date.now()}:${crypto.randomBytes(24).toString("base64")}`;
    this.startDate = new Date();
    this.lifetime = 0;
    this.duration = 0;
  }

  /**
   * Middleware: attaches `finish`/`error` listeners to the response that record `status`,
   * `lifetime`, and `duration`, then log the outcome through `ENGINE`, and stores `self` on
   * `ctx.log` so downstream code can reach the logger through the context.
   */
  @Middleware()
  static async Init(@Route() route: AomRoute, @This() self: Logger, @Ctx() ctx: HttpCtx) {
    // in general, onerror always runs last, which lets us record the request's completion time
    // and final status, and, in case of an error, the error itself
    const finishHandler = () => {
      self.currentDate = new Date();
      self.finishDate = new Date();
      self.status = ctx.res.statusCode;
      self.lifetime = +self.currentDate - +self.startDate; // request lifetime
      self.duration = +self.finishDate - +self.startDate; // request duration

      if (self.status !== 200) {
        // log.error = ctx.res.body as Error; !! todo figure out how to do this!
        this.ENGINE.error("Request error:", self);
      } else {
        this.ENGINE.info("Request success:", self);
      }
    };

    ctx.res.on("finish", finishHandler);
    ctx.res.on("error", finishHandler);

    self.currentDate = new Date();

    // self.request = ctx.req;

    self.route = route;

    Object.assign(ctx, { log: self });
    this.ENGINE.info("Logger initiated:", self);
  }

  /**
   * Middleware: records the current cursor's origin (a middleware/endpoint class) in
   * `attachments`, keyed by its constructor name, so it shows up in later log entries.
   */
  @Middleware()
  static async Attach(@Cursor() cursor: AomCursor, @This() self: Logger) {
    const { origin } = cursor;
    // add the given middleware/endpoint to the logging attachments
    // extracts the origin attached to the cursor, and creates an entity that, at the moment the
    // log entry is built, pulls the value from stateMap
    // /*
    self.attachments[origin._.target.name] = new LoggerAttachments(origin._.target);
  }

  /**
   * Middleware: refreshes `currentDate`/`lifetime` and writes a debug-level log line through
   * `ENGINE`, including the cursor currently executing. Useful for tracing progress through a
   * long middleware chain.
   */
  @Middleware()
  static async Watch(@This() self: Logger, @Cursor() cursor: AomCursor) {
    self.currentDate = new Date();
    self.lifetime = +self.currentDate - +self.startDate;
    const { origin } = cursor;
    const fragment = {
      prefix: cursor.prefix,
      constructor: origin._.target.name,
      property: origin._.property,
    };
    this.ENGINE.debug("Request fragment:", { ...self, fragment });
  }
}
