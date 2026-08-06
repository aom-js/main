import { IncomingMessage, ServerResponse } from "node:http";
import Stream from "node:stream";

export type HttpRequest = IncomingMessage;
export type HttpResponse = ServerResponse<HttpRequest>;
export type HttpSocket = Stream.Duplex;

export type HttpCtx = { req: HttpRequest; res: HttpResponse };
export type SocketCtx = { req: HttpRequest; res: HttpSocket };
