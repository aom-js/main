import { join } from "path";
import { Constructor } from "../common";
import { AomRoute, AomHttp } from "./common";

export * from "./decorators";
export * from "./specials";
export * from "./common/openapi";

export class AomRouter {
  routes: AomRoute[] = [];

  constructor(root: Constructor, prefix: string = "/") {
    const rootInstance = AomHttp.instance(root);
    this.build(prefix, rootInstance);
  }

  private build(path: string, root: AomHttp, middlewares: AomHttp[] = []) {
    // объединим миддлвари
    middlewares.push(...root.route.middlewares);

    root.route.endpoints.forEach((endpoint) => {
      const route = new AomRoute(endpoint, middlewares);
      this.routes.push(route);
    });

    root.route.bridges.forEach((bridge) => {
      this.build(join(path, bridge.prefix), bridge.next, middlewares);
    });
  }
}
