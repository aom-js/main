import { IncomingMessage, ServerResponse } from "node:http";
import Stream from "node:stream";

/** Alias for `node:http`'s `IncomingMessage`. */
export type HttpRequest = IncomingMessage;
/** Alias for `node:http`'s `ServerResponse<HttpRequest>`. */
export type HttpResponse = ServerResponse<HttpRequest>;
/** Alias for `node:stream`'s `Duplex`, the raw socket handed to a WebSocket route's `\@Ctx().res`. */
export type HttpSocket = Stream.Duplex;

/** Shape of `\@Ctx()` for a regular HTTP route, as set up by `Server`. */
export type HttpCtx = { req: HttpRequest; res: HttpResponse };
/** Shape of `\@Ctx()` for a WebSocket/`upgrade` route, as set up by `Server`. */
export type SocketCtx = { req: HttpRequest; res: HttpSocket };
