import _ from "es-toolkit/compat";
import WebSocket, { WebSocketServer } from "ws";
import { Args, Controller, Ctx, AomRoute, Middleware } from "@aom-js/router";
import { Params, This, Before, Body, After, Route } from "@aom-js/router";
import { type ClassConstructor } from "@aom-js/core";
//
import { type HttpRequest, type HttpSocket, type SocketCtx } from "../../types";
import { messages } from "../../constants";

// import { Auth } from "../auth";

export declare type WebSocketConnections = Map<string, WebSocket[]>;

export declare type WithWebSockets<T extends {}> = T & {
  sockets: AomWebSockets;
  socketsParam?: string | Function;
};

export declare type CtxWS = () => WebSocket;

export declare type OnMessageFunction = (id: string, socket: WebSocket, data: any) => unknown;

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

  send(_id: any, data: any): void {
    const sockets = this.connections.get(_id) || [];
    // console.log("socket send data", _id, data, sockets.length);
    sockets.forEach((socket: WebSocket) => {
      socket.send(data);
    });
  }

  broadcast(data: any): void {
    this.connections.forEach((sockets, _id) => this.send(_id, data));
    // [...this.connections.keys()].forEach((_id) => this.send(_id, data));
  }

  connect(_id: string, socket: WebSocket): AomWebSockets {
    const sockets = this.connections.get(_id) || [];
    this.connections.set(_id, sockets.concat([socket]));
    // console.log("socket connected", _id, sockets.length);
    return this;
  }

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

export function Ws(): ParameterDecorator {
  const handler = ({ context }: any) => {
    return context.ws;
  };
  return Args(handler);
}

const wss = new WebSocketServer({ noServer: true });

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
        socket.onmessage = (ev: WebSocket.MessageEvent) => {
          // console.log("socket message is", id, ev.data);
          Reflect.apply(target.sockets.onMessage!, null, [id, socket, ev.data]);
        };
      }

      socket.onclose = (ev: WebSocket.CloseEvent) => {
        console.log("socket closed", id);
        target.sockets.disconnect(id, socket);
      };
    });
  }
}

@Controller()
export class WebSocketsController {
  static wssMap: SocketServerConnections = new Map();

  //
  id!: string | null;

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

  @Middleware()
  static async Setup(
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

  @Middleware()
  @Before(WebSocketsController.Define)
  @After(WebSocketsController.Setup)
  static async Init(@Ctx() ctx: SocketCtx, @This() self: WebSocketsController) {
    // тут должна быть сессия, в рамках которой действует пользователь
    self.id = `${ctx.req.socket.remoteAddress}`;
  }

  /*
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

export default new AomWebSockets();
