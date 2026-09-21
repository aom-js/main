import { ClassType } from "@aom-js/core";
import { resolve, join } from "node:path";
import { AomRoute, AomApi, AomCursor } from "../common";
import { OpenApi } from "./openapi";

/**
 * Builds the flat route table for a controller tree and registers every route with an
 * `OpenApi` document. This is the package's main entry point for the "build" half of
 * the router's job (the "execute" half is `AomRoute.apply`) — create one `Router` per
 * application module, once, and pass its `routes`/`sockets` to `@aom-js/api`'s
 * `Server` (which matches an incoming request's path/method to a route and calls
 * `route.apply(...)`).
 *
 * @example
 * ```ts
 * import { Controller, Bridge, Router, OpenApi } from "@aom-js/router";
 *
 * \@Controller()
 * \@Bridge("/api", ApiRoutes)
 * class Index {}
 *
 * const docs = new OpenApi({ openapi: "3.1.0", info: { title: "app", version: "1" } });
 * const router = new Router(Index, docs);
 * // router.routes / router.sockets is what a server adapter matches requests against
 * ```
 */
export class Router {
  /** Flat list of every HTTP route built from the controller tree, in traversal order. */
  routes: AomRoute[] = [];

  /** Flat list of every `\@WebSocketPoint` route — kept separate from `routes` and not registered in the OpenAPI document. */
  sockets: AomRoute[] = [];

  // the class the tree was built from: a route knows its router but not the root,
  // while traversal tooling (visualization, codegen) needs an entry point
  /** Root controller class the tree was built from — a route knows its `router` but not the root, and traversal tooling (visualization, codegen) needs an entry point. */
  readonly root: ClassType;

  // private routesMap: Map<string, AomRoute>;

  /**
   * Walks the controller tree rooted at `root`, builds every route and socket, and
   * registers each route with `docs` (`docs.registerPath(route)`) so the OpenAPI
   * document reflects exactly what was built.
   *
   * @param root - root controller class, decorated with `\@Controller()`
   * @param docs - `OpenApi` instance to accumulate the generated document into
   */
  constructor(root: ClassType, docs: OpenApi) {
    this.root = root;
    const rootInstance = AomApi.instance(root);
    // this.routesMap = new Map();
    this.build(rootInstance);
    this.routes.forEach((route) => docs.registerPath(route));
  }

  /**
   * Recursively assembles routes for one controller level and its bridges.
   *
   * On each level: copies the inherited cursor list, appends cursors for this class's
   * `\@Before` middlewares, and passes **that combined list** down into every
   * `\@Bridge` — so class-level `\@Before` propagates into child controllers. Only after
   * recursing into bridges does it build this level's `\@After` cursors (which do
   * *not* propagate) and create one `AomRoute` per `\@Get`/`\@Post`/... endpoint and one
   * per `\@WebSocketPoint`, combining pre- and post-middlewares with the endpoint.
   *
   * @param root - meta-instance of the controller class at this level
   * @param cursors - cursors inherited from parent levels (class-level `\@Before` only)
   * @param prefix - path prefix accumulated so far
   */
  private build(root: AomApi, cursors: AomCursor[] = [], prefix: string = "/") {
    // a fresh array of cursors is created on each iteration so later mutations don't overlap
    const preCursors = [...cursors];

    // combine the pre-middlewares that will also be pushed down into other bridges
    preCursors.push(...root.element.pre_middlewares.map(($) => new AomCursor($, root, prefix)));

    root.element.bridges.forEach((bridge) => {
      this.build(bridge.next, preCursors, resolve(join(prefix, bridge.prefix)));
    });

    // build the post-middlewares, which are not pushed into other bridges but are used for this level's own methods and sockets
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
