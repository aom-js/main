import { CombinedDecorator, ClassType, ExecutionPhase, InheritPlacement } from "@aom-js/core";

import * as constants from "../../constants";
import {
  FwdContainer,
  FwdFunction,
  HandlerFunction,
  MarkerHandler,
  MiddlewareHandler,
} from "../../common";

import { AomApi } from "../../common";

// a reference that isn't @Middleware() is a definition error, not a silently shortened chain
/** Rejects a reference that doesn't point at a `\@Middleware()` method — otherwise `\@Before`/`\@After` would silently drop it instead of running it. */
function checkMiddleware($: AomApi): AomApi {
  if (!$.element.isMiddleware) throw new Error(constants.USE_MIDDLEWARE_DEFINE_ERROR);
  return $;
}

/**
 * Links the references of `\@Before`/`\@After`/`\@Next`/`\@UseMarker` to the meta-instance `$`.
 * A direct reference is resolved and checked right away — a wrong one is still a definition
 * error at declaration. A `FwdRef` is resolved only when the link is realized (first read of
 * the element's links: `Router.build`, route layout, projections), because its target may not
 * exist yet when `\@Controller()` runs the LAST phase — a circular import or a class declared
 * further down. The link itself is always deferred, so the order of links is kept.
 */
function link<T extends HandlerFunction>(
  $: AomApi,
  refs: Array<T | FwdContainer>,
  check: (one: AomApi) => AomApi,
  add: (resolved: AomApi[]) => void,
) {
  // the reference might have captured the parent's static side (Self.Method before
  // @Controller() ran); re-resolve it in the context of the class declaring the decorator
  const resolve = (ref: ReturnType<FwdFunction>) =>
    check(AomApi.resolveFor(AomApi.instance(ref), $._.target));
  const direct = refs.map((ref) => (ref instanceof FwdContainer ? ref : resolve(ref)));
  $.element.defer(() =>
    add(direct.map((one) => (one instanceof FwdContainer ? resolve(one.exec()) : one))),
  );
}

// ************************************************ //
// ...
/**
 * Adds middleware(s) that run **before** the decorated class's endpoints (class form)
 * or before the decorated method (method form). Every argument must resolve to a
 * `\@Middleware()`-decorated method.
 *
 * On a class, `\@Before` cursors are pushed down into every `\@Bridge`d child
 * controller — a class-level `\@Before` on a parent runs for all of its children's
 * routes too (class-level `\@After` does not propagate this way, see `\@After`).
 *
 * Inheritance: when a subclass and its parent both declare class-level `\@Before`, the
 * parent's middlewares run **first** (`InheritPlacement.PREPEND` — the opposite of the
 * default append behavior used everywhere else, including `\@After`).
 *
 * @param middlewares - `\@Middleware()`-decorated methods, or `FwdRef(...)` wrapping one
 *   (useful to reference a class not yet declared — further down the file or in a circular
 *   import — or `Self.Method` before `\@Controller()` has resolved the current subclass)
 * @returns a decorator usable on both a class and a method
 * @throws {Error} `USE_MIDDLEWARE_DEFINE_ERROR` if an argument isn't `\@Middleware()` (for a `FwdRef` — when routes are built, see `FwdRef`)
 *
 * @example
 * ```ts
 * import { Controller, Middleware, Before, Get } from "@aom-js/router";
 *
 * class Guard {
 *   \@Middleware()
 *   static async check() {}
 * }
 *
 * \@Controller()
 * \@Before(Guard.check) // runs before every endpoint of App, and of any \@Bridge child
 * class App {
 *   \@Get("/hello")
 *   static async hello() {
 *     return "hi";
 *   }
 * }
 * ```
 */
export function Before(...middlewares: Array<MiddlewareHandler | FwdContainer>): CombinedDecorator {
  // PREPEND: on inheritance, the parent's Before middlewares go before the descendant's own
  return AomApi.combinedDecorator(
    ($) => {
      link($, middlewares, checkMiddleware, (resolved) =>
        $.element.addPreMiddlewares(...resolved),
      );
    },
    ExecutionPhase.LAST,
    InheritPlacement.PREPEND,
  );
}

// export const UseBefore = Use;

// ...
/**
 * Adds middleware(s) that run **after** the decorated class's own middlewares/endpoint
 * (class form) or after the decorated method (method form), but note: on a class,
 * these cursors are placed **before the endpoint itself** in the final chain — the
 * order is `classBefore → classAfter → methodBefore → endpoint → methodAfter →
 * \@Next chain`. This is a documented quirk of how `Router.build` assembles routes, not
 * a bug (see the package readme's section on cursor layout and execution order).
 *
 * Unlike `\@Before`, a class-level `\@After` does **not** propagate into `\@Bridge`d
 * child controllers. On inheritance, the parent's `\@After` middlewares run **after**
 * the subclass's own (`InheritPlacement.APPEND`, the default).
 *
 * @param middlewares - `\@Middleware()`-decorated methods, or `FwdRef(...)` wrapping one
 * @returns a decorator usable on both a class and a method
 * @throws {Error} `USE_MIDDLEWARE_DEFINE_ERROR` if an argument isn't `\@Middleware()` (for a `FwdRef` — when routes are built, see `FwdRef`)
 *
 * @example
 * ```ts
 * import { Controller, Middleware, After, Get } from "@aom-js/router";
 *
 * class Logger {
 *   \@Middleware()
 *   static async record() {}
 * }
 *
 * \@Controller()
 * \@After(Logger.record)
 * class App {
 *   \@Get("/hello")
 *   static async hello() {
 *     return "hi";
 *   }
 * }
 * ```
 */
export function After(...middlewares: Array<MiddlewareHandler | FwdContainer>): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    link($, middlewares, checkMiddleware, (resolved) => $.element.addPostMiddlewares(...resolved));
  }, ExecutionPhase.LAST);
}

// ************************************************ //
// ...
/**
 * Marks a method as middleware — a cursor that runs as part of a route's chain but is
 * not directly reachable as an endpoint. Referenced by `\@Before`/`\@After`/`\@Bridge`
 * (as the pre-middleware pushed in front of the bridged controller).
 *
 * A middleware that returns `undefined` lets the chain continue to the next cursor;
 * any other returned value (including `null`, `false`, `0`, `""`) becomes the
 * response and stops the chain. A returned `Error` instance, or a thrown error,
 * rejects the request instead.
 *
 * @throws {Error} `MIDDLEWARE_DEFINE_ERROR` if the method already has a conflicting
 *   role (`\@Nextpoint`, endpoint, `\@WebSocketPoint`, `\@OnInstance`)
 *
 * @example
 * ```ts
 * import { Controller, Middleware, Before, Get } from "@aom-js/router";
 *
 * class Guard {
 *   \@Middleware()
 *   static async check() {
 *     // returning nothing continues the chain
 *   }
 * }
 *
 * \@Controller()
 * \@Before(Guard.check)
 * class App {
 *   \@Get("/secure")
 *   static async secure() {
 *     return "ok";
 *   }
 * }
 * ```
 */
export function Middleware(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    if (
      $.element.isNextpoint ||
      $.element.isEndpoint ||
      $.element.isWebsocket ||
      $.element.isInstance
    ) {
      throw new Error(constants.MIDDLEWARE_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isMiddleware = true;
    }
  });
}
// ************************************************ //
// ...
/**
 * Mounts a child controller under `prefix`, relative to the decorated class's own
 * prefix. `Router.build` recurses into every bridge, so a bridge tree of controllers
 * produces one flat route table; class-level `\@Before` on the bridging class
 * propagates into the mounted child (class-level `\@After` does not).
 *
 * On a **method** instead of a class: the method becomes the bridge itself and is
 * additionally inserted as the very first pre-middleware of `nextRoute` — useful when
 * the bridge needs to run some setup (e.g. resolving an id segment) before anything
 * else in the child controller.
 *
 * @param prefix - path segment the child controller is mounted under
 * @param nextRoute - child controller class (must itself be `\@Controller()`)
 * @returns a decorator usable on both a class and a method
 *
 * @example
 * ```ts
 * import { Controller, Bridge, Get } from "@aom-js/router";
 *
 * \@Controller()
 * class Leaf {
 *   \@Get("/item")
 *   static async item() {}
 * }
 *
 * \@Controller()
 * \@Bridge("/leaf", Leaf) // mounts Leaf's routes at "/leaf/..."
 * class Root {
 *   \@Get()
 *   static async home() {}
 * }
 * ```
 */
export function Bridge(prefix: string, nextRoute: ClassType): CombinedDecorator {
  return AomApi.combinedDecorator(($, descriptor) => {
    const next = AomApi.instance(nextRoute);
    // if this is a bridge wrapping a preceding middleware, add it as the very first call
    // of the next route
    if (descriptor) {
      $.element.descriptor = descriptor;
      next.element.prependPreMiddleware($);
    }
    $._.root.element.bridges.push({ prefix, next, $ });
  });
}
// ************************************************ //
// ...
/**
 * Marks a static method as a build-time marker: `(route: AomRoute, cursor: AomCursor) => void`.
 * Markers never run during request handling — `AomRoute`'s constructor calls every
 * marker attached (via `\@UseMarker`) to each of its cursors exactly once, with `this`
 * bound to the marker's own class, while the route is being assembled.
 *
 * Used to compute build-time metadata about a route from information only available
 * once the route is fully laid out — `@aom-js/api`'s access map (`route.markers`) is
 * built this way.
 *
 * @example
 * ```ts
 * import { Marker, UseMarker, Middleware, AomRoute, AomCursor } from "@aom-js/router";
 *
 * class Access {
 *   \@Marker()
 *   static setPublic(route: AomRoute, cursor: AomCursor): void {
 *     route.markers.public = true;
 *   }
 * }
 *
 * class Guard {
 *   \@Middleware()
 *   \@UseMarker(Access.setPublic)
 *   static async check() {}
 * }
 * ```
 */
export function Marker(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    $.element.isMarker = true;
    $.element.descriptor = descriptor;
  }, ExecutionPhase.FIRST);
}

// ************************************************ //
// ...
/**
 * Attaches a `\@Marker()`-decorated handler to the decorated method. Every marker
 * attached this way runs once per cursor built from the method, when `AomRoute` lays
 * out the route — see `\@Marker`.
 *
 * @param handler - a `\@Marker()`-decorated static method, or `FwdRef(...)` wrapping one
 * @returns a method decorator
 * @throws {Error} `USE_MARKER_DEFINE_ERROR` if `handler` isn't `\@Marker()` (for a `FwdRef` — when routes are built, see `FwdRef`)
 *
 * @example
 * ```ts
 * import { Marker, UseMarker, Middleware, AomRoute, AomCursor } from "@aom-js/router";
 *
 * class Access {
 *   \@Marker()
 *   static setPublic(route: AomRoute, cursor: AomCursor): void {
 *     route.markers.public = true;
 *   }
 * }
 *
 * class Guard {
 *   \@Middleware()
 *   \@UseMarker(Access.setPublic)
 *   static async check() {}
 * }
 * ```
 */
export function UseMarker(handler: MarkerHandler | FwdContainer): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    const checkMarker = (marker: AomApi) => {
      if (!marker.element.isMarker) throw new Error(constants.USE_MARKER_DEFINE_ERROR);
      return marker;
    };
    link($, [handler], checkMarker, ([marker]) => {
      $.element.descriptor = descriptor;
      $.element.addMarker(marker);
    });
  }, ExecutionPhase.LAST);
}

// ************************************************ //
/**
 * Chains a `\@Nextpoint()`-decorated method as the continuation of the decorated
 * method. When the route is laid out, the nextpoint is unrolled recursively right
 * after its middlewares — so a chain of `\@Next` calls turns into a flat sequence of
 * cursors: `A → A's \@Next target → that target's own \@Next target → ...`.
 *
 * @param handler - a `\@Nextpoint()`-decorated static method, or `FwdRef(...)` wrapping one
 * @returns a method decorator
 * @throws {Error} `USE_NEXT_DEFINE_ERROR` if `handler` isn't `\@Nextpoint()` (for a `FwdRef` — when routes are built, see `FwdRef`)
 *
 * @example
 * ```ts
 * import { Controller, Get, Next, Nextpoint } from "@aom-js/router";
 *
 * class Pager {
 *   \@Nextpoint()
 *   static async page() {
 *     return { items: [] };
 *   }
 * }
 *
 * \@Controller()
 * class App {
 *   \@Get("/list")
 *   \@Next(Pager.page)
 *   static async list() {}
 * }
 * ```
 */
export function Next(handler: HandlerFunction | FwdContainer): MethodDecorator {
  return AomApi.methodDecorator(($) => {
    const checkNextpoint = (nextpoint: AomApi) => {
      if (!nextpoint.element.isNextpoint) throw new Error(constants.USE_NEXT_DEFINE_ERROR);
      return nextpoint;
    };
    link($, [handler], checkNextpoint, ([nextpoint]) => $.element.addNextpoint(nextpoint));
  }, ExecutionPhase.LAST);
}

// ************************************************ //
// ...
/**
 * Registers a method as an instance hook of its class: runs once per request, right
 * after the class's constructor, before the instance becomes visible to anyone else.
 *
 * **Two-stage lifecycle.** An instance goes through two stages every request:
 *
 * 1. *Created* — the constructor ran, but the instance sits in an internal `inflight`
 *    map, visible only to code belonging to the same class (its own hooks, its own
 *    middleware raised through `\@Run()`-`next()`).
 * 2. *Validated* — every `\@OnInstance` hook of the class resolved successfully. Only
 *    now does the instance move into the shared `state` map, becoming visible to
 *    `\@This`/`\@State` calls from other classes and other execution branches. If a hook
 *    throws, the instance never reaches `state` at all — every caller waiting on this
 *    class, in this request, gets that same rejection.
 *
 * All hooks of one class run **in parallel** (`Promise.all`), so don't rely on their
 * relative order, and a failing hook doesn't cancel its siblings — their side effects
 * still complete even though the class as a whole is rejected.
 *
 * **Reentrancy and your responsibility.** Inside a class's own hook, `\@This()` /
 * `\@This(OwnClass)` returns the instance immediately, unvalidated — there's nothing to
 * wait for, since this hook *is* the validation. That instance must not leak outside
 * the class: don't stash it on `ctx`, a module-level variable, or pass it into another
 * class's code (including through `\@Run()`-`next()` — a foreign middleware raised that
 * way now gets `CIRCULAR_INSTANCE_ERROR` instead of the unvalidated object). If a
 * helper needs it, pass it as a plain function argument, not through the framework.
 *
 * @throws {Error} `ON_INSTANCE_DEFINE_ERROR` if the method already has a conflicting
 *   role (`\@Nextpoint`, endpoint, `\@WebSocketPoint`, `\@Middleware`)
 *
 * @example
 * ```ts
 * import { Controller, OnInstance, This, Headers } from "@aom-js/router";
 *
 * \@Controller()
 * class Auth {
 *   verified = false;
 *
 *   \@OnInstance()
 *   static async verify(\@This() self: Auth, \@Headers("authorization") token: string) {
 *     // self is unvalidated here — fine, this is the class's own hook
 *     if (token !== "ok") throw new Error("401");
 *     self.verified = true;
 *   }
 * }
 *
 * \@Controller()
 * class Dependent {
 *   // waits for Auth's hooks; sees the validated object, or the same "401" rejection
 *   constructor(\@This(Auth) public auth: Auth) {}
 * }
 * ```
 */
export function OnInstance(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    if (
      $.element.isNextpoint ||
      $.element.isEndpoint ||
      $.element.isWebsocket ||
      $.element.isMiddleware
    ) {
      throw new Error(constants.ON_INSTANCE_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isInstance = true;
      $._.root.element.instanceHooks.push($);
    }
  });
}
