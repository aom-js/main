import { ClassType } from "@aom-js/core";
import { resolve, join } from "node:path";
import * as constants from "../constants";
import { AomRoute, AomApi, AomCursor, AomViaKind, type AomRouteJSON } from "../common";
import { OpenApi } from "./openapi";

/** Projection of a whole router — `JSON.stringify(router)`, the dump format. */
export declare interface AomRouterJSON {
  version: 1;
  /** Sorted by `method path`. */
  routes: AomRouteJSON[];
}

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
    preCursors.push(
      ...root.element.pre_middlewares.map(($) =>
        Object.assign(new AomCursor($, root, prefix), { via: AomViaKind.ClassBefore }),
      ),
    );

    root.element.bridges.forEach((bridge) => {
      this.build(bridge.next, preCursors, resolve(join(prefix, bridge.prefix)));
    });

    // build the post-middlewares, which are not pushed into other bridges but are used for this level's own methods and sockets
    const postCursors = root.element.post_middlewares.map(($) =>
      Object.assign(new AomCursor($, root, prefix), { via: AomViaKind.ClassAfter }),
    );

    root.element.endpoints.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.routes.push(route);
    });

    root.element.websockets.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.sockets.push(route);
    });
  }

  /**
   * Finds the route served by `endpoint` — by reference to the endpoint method, not by a
   * method+path pair. For an inherited handler pass the method through the class from the
   * router's tree (`Child.Create`, not `Base.Create`): the subclass owns its own copy.
   * Looks the meta-instance up with `AomApi.checkExists`, so the search registers nothing.
   *
   * @param endpoint - the endpoint method (`Orgs.Index`)
   * @returns the only route whose handler is `endpoint`
   * @throws {Error} `ROUTE_OF_NOT_FOUND_ERROR` when no route has it as its handler
   * @throws {Error} `ROUTE_OF_AMBIGUOUS_ERROR` when several do (`\@Get \@Post` on one method,
   *   a controller under two `\@Bridge`s) — every `method path` is listed in the message
   *
   * @example
   * ```ts
   * import { Controller, Get, Router, OpenApi } from "@aom-js/router";
   *
   * \@Controller()
   * class App {
   *   \@Get("/hello")
   *   static async hello() {}
   * }
   *
   * const router = new Router(App, new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } }));
   * router.routeOf(App.hello).path; // "/hello"
   * ```
   */
  routeOf(endpoint: Function): AomRoute {
    // a typo in the method name passes `undefined`; checkExists would throw a TypeError on it
    const $ = typeof endpoint === "function" ? AomApi.checkExists(endpoint) : undefined;
    const found = $ ? this.routes.filter((route) => route.endpoint.$ === $) : [];
    if (!found.length) {
      throw new Error(`${constants.ROUTE_OF_NOT_FOUND_ERROR}: ${String(endpoint?.name ?? endpoint)}`);
    }
    if (found.length > 1) {
      const places = found.map(({ method, path }) => `${method} ${path}`).join(", ");
      throw new Error(`${constants.ROUTE_OF_AMBIGUOUS_ERROR}: ${places}`);
    }
    return found[0];
  }

  /**
   * Projection of every route (`JSON.stringify(router)`), sorted by `method path` so the
   * output is deterministic and diffable. Computed on demand, executes nothing.
   */
  toJSON(): AomRouterJSON {
    const key = ({ method, path }: AomRoute) => `${method} ${path}`;
    const routes = [...this.routes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return { version: 1, routes: routes.map((route) => route.toJSON()) };
  }
}
