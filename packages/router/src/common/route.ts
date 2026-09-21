import { resolve, join } from "node:path";

import type { HTTPMethods } from "./types";

import type { HttpContextValues } from "../types";
import type { Router } from "../classes";
import { AomCursor } from "./cursor";
import type { AomEndpoint } from "./api";
import { RxContext } from "./context";

/** Shape of `AomRoute.markers` — one entry per marker name, value set by the marker's handler. */
export declare type MarkerType = Record<string, any>;

/** Signature of a method decorated with `\@Marker()`, invoked once per cursor by `AomRoute`'s constructor. */
export declare type MarkerHandler = (route: AomRoute, cursor: AomCursor) => void | unknown;

/**
 * One built route: a path, an HTTP method, and the flat, ordered list of cursors that
 * `apply()` runs to serve a request. Created by `Router.build` for every endpoint and
 * websocket in the controller tree — application code doesn't construct `AomRoute`
 * directly, it gets instances from `Router.routes` / `Router.sockets`.
 *
 * The constructor re-creates the class-level cursors it receives (they're shared
 * across every route of the same controller level) rather than mutating them, so each
 * route ends up with its own `endpoint` on every cursor and its own `RouteRef`
 * resolution — see the package readme's note on `KI-ROUTER-03`.
 */
export class AomRoute {
  router: Router;

  endpoint: AomEndpoint;

  path: string;

  method: HTTPMethods;

  /**
   * Values written by this route's `\@Marker()`-decorated cursors, keyed by whatever
   * the marker handler chooses to set — build-time only, not touched during request
   * execution. See `\@Marker`/`\@UseMarker`.
   */
  markers: MarkerType = {};

  /** Flat, ordered list of cursors this route runs: `classBefore → classAfter → methodBefore → endpoint → methodAfter → \@Next chain`. */
  cursors: AomCursor[] = [];

  constructor(router: Router, prefix: string, endpoint: AomEndpoint, cursors: AomCursor[]) {
    //
    this.router = router;

    this.path = resolve(join(prefix, endpoint.prefix));

    this.method = endpoint.method;

    this.endpoint = endpoint;

    this.plain([
      // cursors from Router.build are shared across every route of the level — don't mutate
      // them, create our own with the current route's endpoint (index below is assigned per-route too)
      ...cursors.map((cursor) => new AomCursor(cursor.$, cursor.origin, cursor.prefix, endpoint)),
      new AomCursor(endpoint.$, endpoint.$, this.path, endpoint), // the endpoint itself is also a cursor
    ]);

    // assign indexes to the cursors
    this.cursors.forEach((cursor, index) => {
      // apply markers in the context of the class where they were declared
      cursor.$.element.markers.forEach((marker) => {
        Reflect.apply(marker.element.descriptor.value, marker._.target, [this, cursor]);
      });

      cursor.index = index;
    });
  }

  /**
   * Recursively flattens cursors into `this.cursors`, interleaving each cursor's own
   * pre-middlewares, the cursor itself, its post-middlewares, and — if it has one — its
   * nextpoint (processed the same way, so a chain of `\@Next` calls unrolls fully).
   */
  private plain(cursors: AomCursor[]) {
    cursors.forEach((cursor) => {
      // rebinding the context to the descendant is done in AomCursor's constructor (resolveFor)

      // first place the current cursor's own pre-middlewares
      this.plain(
        cursor.$.element.pre_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // then place the cursor itself, which can be either a middleware or an endpoint
      this.cursors.push(cursor);

      this.plain(
        cursor.$.element.post_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // if the current cursor has a nextpoint, process it recursively too, including its own middlewares and nextpoints
      if (cursor.$.element.nextpoint) {
        this.plain([
          new AomCursor(cursor.$.element.nextpoint, cursor.$, cursor.prefix, cursor.endpoint),
        ]);
      }
    });
  }

  /**
   * Executes this route for one request: creates a fresh `RxContext` (empty `state`,
   * `pending`, `inflight`) and runs `this.cursors` through it. This is what `Server`
   * from `@aom-js/api` calls after matching a request to a route.
   *
   * @param context - request-scoped values (`ctx`/`req`/`res`/`body`/`query`/...);
   *   fields may be plain values or `lazy(...)` wrappers, see {@link lazy}
   * @returns whatever the first cursor that returns a non-`undefined` value produced;
   *   `undefined` if every cursor returned `undefined`
   * @throws {Error} whatever a cursor threw or returned as an `Error` instance
   *
   * @example
   * ```ts
   * import { Router, OpenApi } from "@aom-js/router";
   *
   * const router = new Router(RootController, new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } }));
   * const route = router.routes.find((r) => r.method === "get" && r.path === "/hello")!;
   * const result = await route.apply({
   *   ctx: {}, req: {}, res: {}, body: {}, files: {},
   *   query: {}, params: {}, cookies: {}, headers: {}, session: {},
   * });
   * ```
   */
  apply(context: HttpContextValues): any {
    return new RxContext(context, this).run(this.cursors);
  }
}
