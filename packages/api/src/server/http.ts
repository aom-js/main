import http from "node:http";
import Stream, { Readable } from "node:stream";
import { Router, AomRoute, compilePath, lazy, type HTTPMethods } from "@aom-js/router";

//
import {
  ErrorMessage,
  NotFoundResponse,
  ServerErrorResponse,
  WrongDataResponse,
} from "../responses";
import { messages, locales } from "../constants";
import { BODY_OPTIONS_MARKER } from "../decorators/body-options";
import { type AomServerSettings } from "./types";
import { I18nizer } from "./i18nizer";
import { protocolHeaders } from "./protocol-headers";
import { parseJsonBody, BODY_UNREAD, DEFAULT_BODY_LIMIT, type BodyParseOptions } from "./body";
import { Logger } from "../controllers/logger";

declare type StringStructures = Record<string, string | string[]>;

// Error code for a third-party exception based on its status: if the package has a ready-made
// response for that status, use its code; otherwise the generic error code; the exception's own
// text/stack is never sent to the client.
const STATUS_ERROR_MESSAGES: Record<number, string> = {
  400: messages.ERROR_WRONG_DATA,
  401: messages.ERROR_AUTH_REQUIRED,
  402: messages.PAYMENT_REQUIRED,
  403: messages.ERROR_ACCESS_DENY,
  404: messages.ERROR_NOT_FOUND,
  409: messages.ERROR_CONFLICT,
  413: messages.ERROR_PAYLOAD_TOO_LARGE,
  423: messages.ERROR_DATA_LOCKED,
  424: messages.ERROR_WRONG_DEPENDENCY,
  500: messages.SERVER_ERROR,
};

// The response for an exception thrown in the route chain. The exception's text/stack is never sent
// to the client on any branch: what goes out is either a ready-made ErrorMessage, or the error code
// matching the status, or the generic error code
function toErrorResponse(err: any): ErrorMessage {
  let errorResponse: ErrorMessage;
  if (err instanceof ErrorMessage) {
    errorResponse = err;
  } else if (Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599) {
    errorResponse = new ErrorMessage(
      STATUS_ERROR_MESSAGES[err.status] ?? messages.ERROR_MESSAGE,
      err.status,
    );
  } else {
    // This also covers a status outside the HTTP range (e.g. 99999) - calling writeHead
    // with it would crash the process
    errorResponse = new ServerErrorResponse(messages.SERVER_ERROR);
  }
  // A valid status for the final response is an integer 200..999: 1xx are intermediate
  // informational responses, not final ones (the client would never get a completion and
  // would hang until it times out); non-standard 6xx-9xx are still not rejected, same as
  // before; an ErrorMessage with an invalid status of its own (e.g. from a third-party
  // middleware) is also replaced with a safe one
  if (
    !Number.isInteger(errorResponse.status) ||
    errorResponse.status < 200 ||
    errorResponse.status > 999
  ) {
    errorResponse = new ServerErrorResponse(messages.SERVER_ERROR);
  }
  return errorResponse;
}

// The level follows the status class, as in Logger: an expected answer below 500 (4xx is the
// client's mistake) is logged without the exception and its stack; 5xx and anything unexpected -
// as an error together with the exception itself
function logFailure(label: string, err: any, status: number) {
  if (status >= 500) {
    Logger.ENGINE.error(label, err);
  } else {
    Logger.ENGINE[status >= 400 ? "warn" : "info"]("Request rejected:", {
      status,
      message: err?.message,
    });
  }
}

//
class RouteMatcher {
  private routes: Map<string, AomRoute[]> = new Map();
  // per path template: the anchored pattern and the parameter names in capture-group order. Both
  // are derived from the template alone, so they are compiled once at registration instead of on
  // every request; several methods sharing one path share one entry. The grammar is the router's
  // (`compilePath`): the probe runner of `@aom-js/router/testing` checks addresses by the same rules.
  private compiled: Map<string, { pattern: RegExp; paramNames: string[] }> = new Map();

  addRoute(route: AomRoute) {
    if (!route.method) return;

    const method = route.method.toLowerCase();
    if (!this.routes.has(method)) {
      this.routes.set(method, []);
    }

    if (!this.compiled.has(route.path)) {
      this.compiled.set(route.path, compilePath(route.path));
    }
    this.routes.get(method)!.push(route);
  }

  match(
    method: HTTPMethods,
    path: string,
  ): { route: AomRoute; params: Record<string, string> } | null {
    const routes = this.routes.get(method.toLowerCase());
    if (!routes) return null;

    for (const route of routes) {
      const { pattern, paramNames } = this.compiled.get(route.path)!;
      const match = path.match(pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
      });

      return { route, params };
    }

    return null;
  }
}

/**
 * HTTP server that wires a `@aom-js/router` `Router` to `node:http`: matches the incoming
 * request path/method to a route, assembles the values a route needs (`body`, `query`, `params`,
 * `cookies`, `headers`), runs `route.apply(...)`, and turns the returned value into an HTTP
 * response. Starts listening as soon as it's constructed — there is no separate `listen()` call.
 *
 * Request handling behaviour worth knowing:
 * - **Body is lazy.** The `body` value passed into the route is not a parsed object but a
 *   `lazy(...)` wrapper around {@link parseJsonBody}; the actual parse runs at most once per
 *   request, the first time something in the route chain reads `\@Body`. A route that never reads
 *   the body never touches the request stream at all — so an access check earlier in the chain
 *   can reject a request without waiting for (or reading) a body the client claimed but never
 *   needs to fully send. The effective size limit is resolved per request, in this priority
 *   order: the route's `\@BodyOptions` marker, then `AomServerSettings.bodyLimit`, then the
 *   package default `DEFAULT_BODY_LIMIT` (1 MiB). See {@link parseJsonBody} and `BODY_UNREAD`
 *   for what happens on a size/parse failure and why the connection sometimes has to close.
 * - **String results are `text/plain`, not `text/html`.** A handler that returns a plain string
 *   gets `Content-Type: text/plain; charset=utf-8` by default — returned strings often embed
 *   request/database values, and serving them as `text/html` would let the browser execute that
 *   data as markup (reflected XSS). A handler that genuinely needs to serve HTML must set
 *   `Content-Type` itself via `ctx.res.setHeader(...)` before `return`; the server only applies
 *   its default when no `Content-Type` header is already set, so the explicit value wins.
 * - **`Readable` results are streamed** via `Stream.pipeline` (not `.pipe`), which destroys the
 *   source on error or on the client aborting the connection; default `Content-Type` is
 *   `application/octet-stream` unless the handler already set one.
 * - **Errors never leak text or a stack trace to the client.** Anything thrown in the route chain
 *   is caught once, turned into a message code from a fixed status → code table (or a generic
 *   `SERVER_ERROR`), and returned as JSON with the corresponding status.
 * - **CORS/OPTIONS**: every response gets permissive CORS headers; a bare `204` is returned for
 *   `OPTIONS` only when the application has no route of its own for that path and method.
 *
 * @example
 * ```ts
 * import { Server, type AomServerSettings } from "@aom-js/api";
 * import { Router } from "@aom-js/router";
 *
 * const router = new Router();
 * router.addBridge("/api", ApiRootController); // application controllers/routes
 *
 * const settings: AomServerSettings = { port: 3000, url: "http://localhost:3000" };
 * const server = new Server(settings, router);
 * // graceful stop on shutdown: `await server.stop()`, or `await Server.stopAll()` for every server
 * ```
 */
export class Server {
  /** Running total of routes registered across every `Server` instance created in the process. */
  static routesAmount: number = 0;

  // servers of this process that are still listening or finishing; `stopAll` stops them
  private static running = new Set<Server>();

  // responses in progress and upgraded (WebSocket) sockets: `stop` closes the long-lived ones
  private responses = new Set<http.ServerResponse>();
  private upgraded = new Set<Stream.Duplex>();
  private stopping?: Promise<void>;

  private routeMatcher: RouteMatcher;

  /** The underlying `node:http.Server` instance, already listening. */
  readonly server: http.Server;

  /**
   * @param settings - port, URL prefix and body-size defaults (see {@link AomServerSettings})
   * @param router - the `@aom-js/router` `Router` whose `routes` and `sockets` are registered
   * @param i18nizer - optional localizer; when given, the package's own built-in dictionaries
   * (error message translations) are merged into it before any request is served
   */
  constructor(
    settings: AomServerSettings,
    router: Router,
    private i18nizer?: I18nizer,
  ) {
    this.routeMatcher = new RouteMatcher();

    if (i18nizer) {
      i18nizer.addLocalesStruct(locales);
    }

    router.routes.forEach((route: AomRoute) => {
      this.routeMatcher.addRoute(route);
      Server.routesAmount++;
    });

    router.sockets.forEach((route: AomRoute) => {
      this.routeMatcher.addRoute(route);
    });

    // req.url is always the request path, never a full address: the absolute form
    // (`GET http://sample.com/admin`) or the authority form (`//sample.com/admin`,
    // `/\sample.com/admin` - WHATWG treats "\" as the same as "/" for http(s)) must not let a host
    // supplied by the request take part in route matching - otherwise a proxy/WAF that filters by
    // path can be bypassed with the very same request.
    // The prefix from settings.url (if any) is still glued on the front, same as before.
    const parseRequestUrl = (rawUrl: string | undefined): URL => {
      const requestPath = rawUrl && rawUrl.startsWith("/") ? rawUrl : `/${rawUrl || ""}`;
      const prefixPath = new URL(settings.url).pathname.replace(/\/$/, "");
      const joinedPath = prefixPath + requestPath;
      // The fragment (after "#") never reaches the server per the HTTP spec - we strip it ourselves
      // before the pathname/search setters run: otherwise they don't treat "#" as a separate
      // delimiter and just percent-encode it as an ordinary path/query character
      const hashIndex = joinedPath.indexOf("#");
      const combinedPath = hashIndex === -1 ? joinedPath : joinedPath.slice(0, hashIndex);
      // The host is fixed by the constructor and changed only via the pathname/search setters: they
      // parse the string in "path state"/"query state", separately from the host, rather than
      // through the general relative-reference resolution algorithm (the one `new URL(path, base)`
      // uses) - so a leading "//" or "\" can't be mistaken for a network-path reference and hijack
      // the host
      const queryIndex = combinedPath.indexOf("?");
      const url = new URL("http://localhost");
      url.pathname = queryIndex === -1 ? combinedPath : combinedPath.slice(0, queryIndex);
      url.search = queryIndex === -1 ? "" : combinedPath.slice(queryIndex);
      return url;
    };

    this.server = http.createServer(async (req, res) => {
      this.responses.add(res);
      res.once("close", () => this.responses.delete(res));
      // during the stop a keep-alive connection must not take the next request
      if (this.stopping) res.setHeader("Connection", "close");
      try {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        // Reflect the headers the browser requested; if the preflight didn't send any, fall back
        // to the previous default
        const requestedHeaders = req.headers["access-control-request-headers"];
        res.setHeader(
          "Access-Control-Allow-Headers",
          requestedHeaders ? String(requestedHeaders) : "Content-Type,Authorization",
        );

        const url = parseRequestUrl(req.url);
        const match = this.routeMatcher.match(<HTTPMethods>req.method, url.pathname || "/");

        // Only send the preflight response when there's no route of its own for OPTIONS
        if (req.method === "OPTIONS" && !match) {
          res.writeHead(204);
          res.end();
          return;
        }

        const query = this.structurizeSearchParams(url.searchParams);
        const headers = this.definedHeadersValues(req.headers);

        // determine the current locale
        let locale: string | undefined;
        if (this.i18nizer) {
          locale = this.i18nizer.defineLocale(headers, query);
        }

        const localize = (text: string): string => {
          if (text && locale && this.i18nizer) {
            return this.i18nizer.localize(text, locale);
          } else {
            return text;
          }
        };

        if (!match) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(localize(JSON.stringify(new NotFoundResponse(messages.PATH_NOT_FOUND))));
          return;
        }

        try {
          const result = await match.route.apply({
            req,
            res,
            ctx: { req, res },
            // The body is read no earlier than the first @Body in the route chain:
            // before access checks run, the stream isn't touched at all, and a route that doesn't
            // need the body never reads it. Limit resolution order: route marker (@BodyOptions) ->
            // server setting -> package default
            body: lazy(async () => {
              const markerOptions: BodyParseOptions | undefined =
                match.route.markers[BODY_OPTIONS_MARKER];
              const limit = markerOptions?.limit ?? settings.bodyLimit ?? DEFAULT_BODY_LIMIT;
              try {
                return await parseJsonBody(req, { limit });
              } catch (err: any) {
                // The stream started being read and was aborted halfway through: on a keep-alive
                // connection, the unread remainder of the body would be parsed as the start of the
                // next request - the connection must close along with the response. A rejection
                // before the first read (by Content-Length or by a foreign content-type) doesn't
                // need this - the runtime drains the body on its own
                if (err?.[BODY_UNREAD] && !res.headersSent) {
                  res.setHeader("Connection", "close");
                }
                throw err;
              }
            }),
            headers,
            query,
            params: match.params,
            cookies: this.parseCookies(req),
            session: {},
            files: {},
          });

          if (typeof result === "string") {
            // The default type is text/plain, not text/html: a string returned by a
            // handler often carries user input, and text/html would make the browser execute it as
            // markup (reflected XSS). Explicit HTML works the same way as for streams below: the
            // handler sets Content-Type itself via res.setHeader before return, and then we don't
            // overwrite it here (writeHead with a key in the headers object takes priority over an
            // already-set setHeader)
            if (!res.getHeader("Content-Type")) {
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
            }
            res.writeHead(200);
            res.end(localize(result));
          } else if (result instanceof Readable) {
            // Specifically Readable (not any Stream): pipeline() expects a Readable as its source,
            // and every real stream response in the package is a readable source (files,
            // Readable.from, custom ones). The default type for a stream applies only if the
            // handler didn't set its own; setHeader doesn't send headers immediately, unlike
            // writeHead
            if (!res.getHeader("Content-Type")) {
              res.setHeader("Content-Type", "application/octet-stream");
            }
            // pipeline (unlike pipe) destroys the source itself on error or when the client aborts
            // the connection - otherwise an interrupted download would leave the source (file,
            // socket) hanging open
            Stream.pipeline(result, res, (streamErr) => {
              if (!streamErr) return;
              // the client closed the connection itself (an SSE client leaving, an aborted
              // download): pipeline has already destroyed both ends, it's not a server error
              const { code } = streamErr as NodeJS.ErrnoException;
              if (code === "ERR_STREAM_PREMATURE_CLOSE" && res.destroyed) return;
              Logger.ENGINE.error("Stream error:", streamErr);
              // pipeline may have already destroyed the whole pipeline, including res - then
              // there's nothing left to send
              if (res.destroyed) return;
              if (res.headersSent) {
                // Part of the response already went to the client - the status can't be changed
                // anymore, so we abort the rest
                res.destroy();
              } else {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(localize(JSON.stringify(new ServerErrorResponse(messages.SERVER_ERROR))));
              }
            });
          } else {
            let status = 200;
            if (result instanceof ErrorMessage) {
              status = result.status;
            } else if (result instanceof Error) {
              status = 500;
            }
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(localize(JSON.stringify(result)));
          }
        } catch (err: any) {
          const errorResponse = toErrorResponse(err);
          try {
            // Logging itself can throw (for example, the thrown object has a broken
            // util.inspect.custom) - in that case it's better to abort the connection than to
            // hang without a response
            logFailure("Request error:", err, errorResponse.status);
          } catch {
            res.destroy();
            return;
          }
          // The handler already started responding itself (writeHead/write) and then threw - the
          // status can't be changed anymore, calling writeHead again would crash the process
          // (ERR_HTTP_HEADERS_SENT)
          if (res.headersSent) {
            res.destroy();
            return;
          }
          try {
            // Serialization/localization happens before writeHead: otherwise, by the time it fails
            // on non-serializable data (BigInt, cycles), the headers would already be sent and
            // falling back to 500 wouldn't be possible anymore
            const payload = localize(JSON.stringify(errorResponse));
            res.writeHead(errorResponse.status, { "Content-Type": "application/json" });
            res.end(payload);
          } catch (writeErr) {
            // Non-serializable data (BigInt, cycles) or a race on headersSent - fall back to a
            // safe response
            Logger.ENGINE.error("Response write error:", writeErr);
            if (res.headersSent) {
              res.destroy();
            } else {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(localize(JSON.stringify(new ServerErrorResponse(messages.SERVER_ERROR))));
            }
          }
        }
      } catch (err: any) {
        // A safety net for errors outside the normal request logic (e.g. URL parsing) - without it,
        // an async throw here becomes an unhandled promise rejection and crashes the process
        try {
          Logger.ENGINE.error("Request setup error:", err);
        } catch {
          res.destroy();
          return;
        }
        if (res.headersSent) {
          res.destroy();
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(new WrongDataResponse(messages.ERROR_WRONG_DATA)));
        }
      }
    });

    this.server.on("upgrade", async (req: http.IncomingMessage, socket, head) => {
      this.upgraded.add(socket);
      socket.once("close", () => this.upgraded.delete(socket));
      try {
        // The same safe URL-parsing scheme as in the main handler - see the comment above
        const url = parseRequestUrl(req.url);
        const match = this.routeMatcher.match("sockets", url.pathname || "/");

        const query = this.structurizeSearchParams(url.searchParams);
        // a browser WebSocket can't set handshake headers: they come unfolded from the
        // subprotocol, real headers win
        const headers = {
          ...protocolHeaders(req.headers["sec-websocket-protocol"], settings.protocolHeaders),
          ...this.definedHeadersValues(req.headers),
        };

        if (!match) {
          socket.destroy();
          return;
        }

        await match.route.apply({
          req,
          res: socket,
          ctx: { req, res: socket },
          body: head,
          query,
          headers,
          params: match.params,
          cookies: this.parseCookies(req),
          session: {},
          files: {},
        });
      } catch (err: any) {
        // The same risk as in the main handler: logging itself can throw
        try {
          logFailure("Request error:", err, toErrorResponse(err).status);
        } catch {
          // no-op - destroy() happens below regardless
        }
        socket.destroy();
      }
    });

    console.info("Server started:", settings);
    Server.running.add(this);
    this.server.once("close", () => Server.running.delete(this));
    this.server.listen(settings.port);
  }

  /**
   * Graceful stop: stops accepting connections, closes idle keep-alive connections (busy ones
   * close after their current response) and the long-lived ones that never end by themselves —
   * `text/event-stream` responses and upgraded (WebSocket) sockets — then waits for the
   * requests in progress to finish their responses.
   * Has no time limit of its own: the application sets the overall shutdown timeout. Never
   * rejects; repeated calls return the same `Promise`.
   *
   * @returns Resolves when the underlying `http.Server` has closed.
   */
  stop(): Promise<void> {
    this.stopping ??= new Promise((resolve) => {
      // close() also drops idle keep-alive connections (Node 19+, Bun); the callback fires with
      // an error when the server is already closed — done either way
      this.server.close(() => resolve());
      this.upgraded.forEach((socket) => socket.destroy());
      this.responses.forEach((res) => {
        if (String(res.getHeader("Content-Type")).startsWith("text/event-stream")) res.end();
        // the connection closes after this response instead of waiting for the next request
        else if (!res.headersSent) res.setHeader("Connection", "close");
        else res.once("finish", () => res.socket?.end());
      });
    });
    return this.stopping;
  }

  /** Stops every `Server` of the process that is still running (see `stop`). */
  static async stopAll(): Promise<void> {
    await Promise.all([...Server.running].map((server) => server.stop()));
  }

  // node returns headers (IncomingHttpHeaders) and query (ParsedUrlQuery) with values typed
  // `string | string[] | undefined`, while the router's contract expects only populated values.
  // We drop the empty keys here rather than smearing the check across every handler.
  private definedHeadersValues(
    source: Record<string, string | string[] | undefined>,
  ): StringStructures {
    const result: StringStructures = {};
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  private structurizeSearchParams(source: URLSearchParams): StringStructures {
    const result: StringStructures = {};
    for (const [key, value] of source) {
      if (key in result) {
        const current = result[key];
        result[key] = Array.isArray(current) ? [...current, value] : [current!, value];
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const cookies: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;

    if (cookieHeader) {
      cookieHeader.split(";").forEach((cookie) => {
        // the value may itself contain '=' (base64 tokens): split on the first one only
        const at = cookie.indexOf("=");
        const name = cookie.slice(0, at).trim();
        const value = cookie.slice(at + 1).trim();
        if (at <= 0 || !name || !value) return;
        try {
          cookies[name] = decodeURIComponent(value);
        } catch {
          // malformed %-encoding is kept as sent rather than failing the request
          cookies[name] = value;
        }
      });
    }

    return cookies;
  }
}
