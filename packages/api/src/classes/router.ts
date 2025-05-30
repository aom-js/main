import { Constructor } from "@aom-js/core";
import { resolve, join } from "node:path";
import { AomRoute, AomApi, AomCursor } from "../common";
import { OpenApi } from "./openapi";

export class Router {
  routes: AomRoute[] = [];

  sockets: AomRoute[] = [];

  // private routesMap: Map<string, AomRoute>;

  constructor(root: Constructor, docs: OpenApi) {
    const rootInstance = AomApi.instance(root);
    // this.routesMap = new Map();
    this.build(rootInstance);
    this.routes.forEach((route) => docs.registerPath(route));
  }

  private build(root: AomApi, cursors: AomCursor[] = [], prefix: string = "/") {
    // на каждой итерации создается свой массив курсором, чтобы последующие действия не создавал перекрытий
    const routeCursors = [].concat(cursors);
    // объединим миддлвари
    routeCursors.push(...root.element.pre_middlewares.map(($) => new AomCursor($, root, prefix)));

    root.element.endpoints.forEach((endpoint) => {
      const route = new AomRoute(prefix, endpoint, [].concat(routeCursors));
      this.routes.push(route);
    });

    root.element.websockets.forEach((endpoint) => {
      const route = new AomRoute(prefix, endpoint, [].concat(routeCursors));
      this.sockets.push(route);
    });

    root.element.bridges.forEach((bridge) => {
      this.build(bridge.next, routeCursors, resolve(join(prefix, bridge.prefix)));
    });
  }

  // route(method: string, path: string): AomRoute | undefined {
  //   return this.routesMap.get(`${method.toLowerCase()}:${path}`);
  // }
}
