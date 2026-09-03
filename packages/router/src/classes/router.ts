import { ClassType } from "@aom-js/core";
import { resolve, join } from "node:path";
import { AomRoute, AomApi, AomCursor } from "../common";
import { OpenApi } from "./openapi";

export class Router {
  routes: AomRoute[] = [];

  sockets: AomRoute[] = [];

  // класс, от которого собрано дерево: маршрут знает свой роутер, но не его корень,
  // а инструментам обхода (визуализация, кодогенерация) нужна точка входа
  readonly root: ClassType;

  // private routesMap: Map<string, AomRoute>;

  constructor(root: ClassType, docs: OpenApi) {
    this.root = root;
    const rootInstance = AomApi.instance(root);
    // this.routesMap = new Map();
    this.build(rootInstance);
    this.routes.forEach((route) => docs.registerPath(route));
  }

  private build(root: AomApi, cursors: AomCursor[] = [], prefix: string = "/") {
    // на каждой итерации создается свой массив курсором, чтобы последующие действия не создавал перекрытий
    const preCursors = [...cursors];

    // объединим предварительные миддлвари, которые пойдут в другие бриджи
    preCursors.push(...root.element.pre_middlewares.map(($) => new AomCursor($, root, prefix)));

    root.element.bridges.forEach((bridge) => {
      this.build(bridge.next, preCursors, resolve(join(prefix, bridge.prefix)));
    });

    // создадим пост-миддлвари, которые не проталкиваются в другие бриджи, но используются для методов и сокетов
    const postCursors = root.element.post_middlewares.map(($) => new AomCursor($, root, prefix));

    root.element.endpoints.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.routes.push(route);
    });

    root.element.websockets.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.sockets.push(route);
    });
  }

  // route(method: string, path: string): AomRoute | undefined {
  //   return this.routesMap.get(`${method.toLowerCase()}:${path}`);
  // }
}
