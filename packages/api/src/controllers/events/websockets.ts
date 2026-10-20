import _ from "es-toolkit/compat";
import WebSocket, { WebSocketServer } from "ws";
import { Args, Controller, Ctx, AomRoute, Middleware } from "@aom-js/router";
import { This, Body, Route } from "@aom-js/router";
//
import { type ClassConstructor } from "../../types";
import { type HttpRequest, type HttpSocket, type SocketCtx } from "../../types";
import { messages } from "../../constants";

export { WebSocket };

/** Active WebSocket connections, keyed by connection identifier (see `AomWebSockets.connect`). */
export declare type WebSocketConnections = Map<string, WebSocket[]>;

/** A controller class carrying WebSocket state: connection registry plus an optional id-source parameter. */
export declare type WithWebSockets<T extends {}> = T & {
  sockets: AomWebSockets;
  socketsParam?: string | Function;
};

export declare type CtxWS = () => WebSocket;

/** Callback invoked for every message received on a connection. */
export declare type OnMessageFunction = (id: string, socket: WebSocket, data: any) => unknown;

/**
 * Registry and helpers for a controller's WebSocket connections, keyed by an application-defined
 * connection id (e.g. a user id). Exported from the package's public entry point. Connections live
 * in the memory of the current process only: `send`/`broadcast` reach this process's sockets.
 */
export class AomWebSockets {
  connections: WebSocketConnections;

  onMessage?: OnMessageFunction;

  // listener: Function;

  constructor(onMessage?: OnMessageFunction) {
    this.onMessage = onMessage;
    this.connections = new Map();
  }

  // server() {
  //   this.listener();
  //   return this;
  // }

  /** Sends `data` to every socket currently registered under connection id `_id`. */
  send(_id: any, data: any): void {
    const sockets = this.connections.get(_id) || [];
    // console.log("socket send data", _id, data, sockets.length);
    sockets.forEach((socket: WebSocket) => {
      socket.send(data);
    });
  }

  /** Sends `data` to every socket across every connection id. */
  broadcast(data: any): void {
    this.connections.forEach((sockets, _id) => this.send(_id, data));
    // [...this.connections.keys()].forEach((_id) => this.send(_id, data));
  }

  /** Registers `socket` under connection id `_id`; a single id may have several sockets. */
  connect(_id: string, socket: WebSocket): AomWebSockets {
    const sockets = this.connections.get(_id) || [];
    this.connections.set(_id, sockets.concat([socket]));
    // console.log("socket connected", _id, sockets.length);
    return this;
  }

  /** Removes `socket` from connection id `_id`'s registered sockets. */
  disconnect(_id: string, socket: WebSocket): AomWebSockets {
    const sockets = this.connections.get(_id) || [];
    // console.log("socket disconnect", _id, sockets);
    this.connections.set(
      _id,
      sockets.filter((_socket) => _socket !== socket),
    );
    return this;
  }
}

/** Parameter decorator: injects the current request's `WebSocket` instance from the route context. */
export function Ws(): ParameterDecorator {
  const handler = ({ context }: any) => {
    return context.ws;
  };
  return Args(handler);
}

const wss = new WebSocketServer({ noServer: true });

/** Per-route registry of `WebSocketWrapper`s, keyed by the matched `AomRoute`. */
export declare type SocketServerConnections = Map<AomRoute, WebSocketWrapper>;

class WebSocketWrapper {
  target: WithWebSockets<ClassConstructor>;

  constructor(target: WithWebSockets<ClassConstructor>) {
    this.target = target;
  }

  async handle(
    context: { req: HttpRequest; socket: HttpSocket; head: Buffer },
    id: string,
  ): Promise<void> {
    //
    const { req, socket, head } = context;
    const { target } = this;
    wss.handleUpgrade(req, socket, head, (socket) => {
      target.sockets.connect(id, socket);
      socket.onerror = (...args) => {
        console.error("socket error", args);
      };

      socket.onopen = (ev: WebSocket.Event) => {
        console.log("socket opened", ev);
      };

      if (target.sockets.onMessage) {
        // a throwing (or rejecting) application handler must not become an unhandled rejection
        // that takes the whole process down: it's logged, the connection stays open
        socket.onmessage = async (ev: WebSocket.MessageEvent) => {
          try {
            await Reflect.apply(target.sockets.onMessage!, null, [id, socket, ev.data]);
          } catch (err) {
            console.error("socket message error", err);
          }
        };
      }

      socket.onclose = (ev: WebSocket.CloseEvent) => {
        console.log("socket closed", id);
        target.sockets.disconnect(id, socket);
      };
    });
  }
}

/**
 * Middleware controller that performs the WebSocket handshake for a socket route: attaches a
 * `WebSocketWrapper` to the route (`Define`) and hands the upgrade request off to `ws` for that
 * connection id (`Connect`). Exported from the package's public entry point; an application
 * middleware between `Define` and `Connect` sets `id`.
 */
@Controller()
export class WebSocketsController {
  static wssMap: SocketServerConnections = new Map();

  //
  /** Connection id for this request; set by an application middleware before `Connect` runs. */
  id!: string | null;

  /**
   * Middleware: verifies the route's target controller has a `sockets: AomWebSockets` field and
   * lazily registers a `WebSocketWrapper` for the route in `wssMap`.
   *
   * @throws {Error} when the target controller doesn't declare `sockets` as an `AomWebSockets` instance
   */
  @Middleware()
  static async Define(@Route() route: AomRoute) {
    //
    const target = route.endpoint.$._.target as WithWebSockets<ClassConstructor>;
    if (!target.sockets || !(target.sockets instanceof AomWebSockets)) {
      throw new Error(messages.CONTROLLERS_WEBSOCKETS_WRONG_TARGET);
    }

    const existsWss = this.wssMap.get(route);
    if (!existsWss) {
      const wsWrap = new WebSocketWrapper(target);
      this.wssMap.set(route, wsWrap);
    }
  }

  /**
   * Middleware: completes the WebSocket upgrade for `id` using the wrapper registered by
   * `Define`; destroys the socket if the route wasn't defined or `id` wasn't set.
   */
  @Middleware()
  static async Connect(
    @Ctx() ctx: SocketCtx,
    @Body() head: Buffer,
    @This() self: WebSocketsController,
    @Route() route: AomRoute,
  ) {
    const wsWrap = this.wssMap.get(route);
    if (wsWrap && self.id) {
      const context = { req: ctx.req, socket: ctx.res, head };
      await wsWrap.handle(context, self.id);
    } else {
      ctx.res.destroy();
    }
  }

  /*
  id initialization is done directly in the controller that attaches the socket to itself,
  i.e. it's an external concern, not an internal one

  @Middleware()
  @Before(WebSocketsController.Define)
  @After(WebSocketsController.Setup)
  static async Init(@Ctx() ctx: SocketCtx, @This() self: WebSocketsController) {
    // this should be the session the user operates within
    self.id = `${ctx.req.socket.remoteAddress}`;
  }

  @Middleware()
  @Before(WebSockets.Define)
  @After(WebSockets.Setup)
  static async AuthorizedInit(@This(Auth) { user }: Auth, @This() self: WebSockets) {
    self.id = user ? String(user.id) : null;
  }

  @Middleware()
  @Before(WebSockets.Define)
  @After(WebSockets.Setup)
  static async Param(@Params() params: {}, @Route() route: AomRoute, @This() self: WebSockets) {
    const { target } = this.wssMap.get(route)!;

    const paramName = _.isString(target.socketsParam)
      ? target.socketsParam
      : Reflect.apply(target.socketsParam!, null, []);
    self.id = Reflect.get(params, paramName);
  }
  */
}

/** Default shared `AomWebSockets` instance; `export *` doesn't re-export it, so it isn't reachable from the package entry point. */
export default new AomWebSockets();
