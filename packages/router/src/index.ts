import { Constructor } from "@aom/core";
import { resolve, join } from "path";
import { AomRoute, AomHttp, HTTPMethods, AomCursor } from "./common";
import { OpenApi } from "./decorators";

export * from "./decorators";
export * from "./specials";
export * from "./types";
export * from "./common/openapi";

export class Router {
  routes: AomRoute[] = [];

  private routesMap: Map<string, AomRoute>;

  constructor(root: Constructor, docs: OpenApi) {
    const rootInstance = AomHttp.instance(root);
    this.routesMap = new Map();
    this.build(rootInstance);
    this.routes.forEach((route) => docs.registerPath(route));
  }

  private build(root: AomHttp, cursors: AomCursor[] = [], path: string = "/") {
    // объединим миддлвари
    cursors.push(...root.route.middlewares.map(($) => new AomCursor($, path)));

    root.route.endpoints.forEach((endpoint) => {
      endpoint.path = resolve(join(path, endpoint.path));
      const route = new AomRoute(endpoint, cursors);
      this.routes.push(route);
      this.routesMap.set(`${endpoint.method}:${endpoint.path}`, route);
    });

    root.route.bridges.forEach((bridge) => {
      this.build(bridge.next, cursors, resolve(join(path, bridge.prefix)));
    });
  }

  route(method: string, path: string): AomRoute | undefined {
    return this.routesMap.get(`${method.toLowerCase()}:${path}`);
  }
}
