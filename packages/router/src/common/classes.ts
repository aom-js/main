import { ClassInstanceMap, AomCore, ClassConstructor } from "@aom-js/core";
import { resolve, join } from "node:path";
import { from, throwError } from "rxjs";
import { concatMap, catchError, takeWhile } from "rxjs/operators";

import { HTTPMethods } from "./types";

import {
  OpenApiParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
} from "./openapi";

import * as constants from "../constants";
import { HttpContextValues } from "../types";
import { FwdContainer, RouteRefContainer, ThisRefContainer } from "./references";
import { Router } from "../classes";
import { LazyValue } from "./lazy";

/**
 * How `OpenApi.registerPath` merges OpenAPI tags collected while walking a route's
 * cursors. The active rule changes only on a cursor that carries `@UseTag`; it stays
 * in effect for every cursor after that until changed again.
 *
 * - `REPLACE` (default) — the new tag replaces the last one collected.
 * - `MERGE` — the new tag is appended, producing a joined string like `"A > B"`.
 * - `IGNORE` — the tag on this cursor is dropped entirely.
 *
 * Set with `@ReplaceNextTags()` / `@MergeNextTags()` / `@IgnoreNextTags()`.
 */
export enum TagsRules {
  IGNORE = "ignore",
  MERGE = "merge",
  REPLACE = "replace",
}

/** Arguments passed to an `Args(...)` handler and to `AomApi.instanceWithHooks`. */
export declare type ArgumentsHandlerParameters = {
  context: RxContext;
  cursor: AomCursor;
  route: AomRoute;
};

/** Function stored by `Args(...)` (and every parameter decorator built on top of it) for one parameter. */
export declare type ArgumentsDecoratorHandler = (args: ArgumentsHandlerParameters) => any;

// class names in the message are mandatory: without the chain, a cycle error explains nothing
/**
 * Builds the `Error` thrown for a `CIRCULAR_INSTANCE_ERROR`. `chain` is the ownership
 * path that closed the loop (see `AomCursor.creating` and `RxContext.waits`); the
 * message lists class names joined by `->` so the cycle is readable without a debugger.
 */
function circularInstanceError(chain: ClassConstructor[]) {
  return new Error(
    `${constants.CIRCULAR_INSTANCE_ERROR}: ${chain.map(({ name }) => name).join(" -> ")}`,
  );
}

/** Shape of `AomRoute.markers` — one entry per marker name, value set by the marker's handler. */
export declare type MarkerType = Record<string, any>;

/** Signature of a method decorated with `@Marker()`, invoked once per cursor by `AomRoute`'s constructor. */
export declare type MarkerHandler = (route: AomRoute, cursor: AomCursor) => void | unknown;

/** One `@Bridge(prefix, next)` registration: `next` is mounted under `prefix` relative to the declaring class. */
export declare interface AomBridge {
  prefix: string;
  next: AomApi;
  $: AomApi;
}

// export declare interface AomMarker {
//   marker: AomApi;
//   $: AomApi;
// }

/** One endpoint or websocket registration: `$` is the meta-instance of the decorated method, mounted at `prefix` via `method`. */
export declare interface AomEndpoint {
  prefix: string;
  method: HTTPMethods;
  $: AomApi;
}

/** Tag state accumulated on one `AomApi.openApi.tag` — the class set by `@UseTag` and the active `TagsRules`. */
class AomHttpOpenApiTags {
  $!: AomApi;
  rule!: TagsRules;
}

/**
 * OpenAPI declarations accumulated on one `AomApi` by the `@Title`/`@Responses`/
 * `@RequestBody`/`@PathParameters`/`@Parameters`/`@Security`/`@UseTag`/tag-rule
 * decorators. `OpenApi.registerPath` reads these fields off every cursor of a route
 * to build one operation. Not exported — accessed through `AomApi.openApi`.
 */
class AomHttpOpenApi {
  tag: AomHttpOpenApiTags = new AomHttpOpenApiTags();

  path: OpenApiPathParameters[] = [];

  responses: OpenApiResponse[] = [];

  requestBody?: OpenApiRequestBody;

  parameters: OpenApiParameterObject[] = [];

  security?: OpenApiSecuritySchema;

  // delayStack: Array<FwdContainer | RouteRefContainer | ThisRefContainer> = [];

  private http!: AomApi;

  constructor(http: AomApi) {
    this.http = http;
  }
}

/**
 * Per-parameter argument handlers of one method, indexed by parameter position.
 * `@Args(handler)` (and everything built on it — `@Query`, `@Body`, `@This`, ...)
 * writes into `handlers[i]`; `apply()` runs every handler concurrently and returns
 * the array of results (still promises — the caller in `RxContext.run` awaits them
 * with `Promise.all`). Not exported — accessed through `AomApi.element.parameters`.
 */
class AomHttpParameters {
  handlers: ArgumentsDecoratorHandler[] = [];

  private api: AomApi;

  constructor(api: AomApi) {
    this.api = api;
  }

  apply(args: ArgumentsHandlerParameters) {
    return this.handlers.map((parameterHandler) =>
      Reflect.apply(parameterHandler, this.api._.target, [args]),
    );
  }
}

/**
 * Structural role of one method (or class) in the route tree: what it is (endpoint,
 * middleware, nextpoint, websocket, `@OnInstance` hook, marker) and what it's
 * connected to (bridges, other endpoints, pre/post middlewares, nextpoint, markers,
 * instance hooks). Structural decorators (`@Get`, `@Middleware`, `@Before`, `@Bridge`,
 * `@OnInstance`, `@Marker`, ...) are thin wrappers that set these fields; conflicting
 * roles on the same method throw the `*_DEFINE_ERROR` codes at decoration time. Not
 * exported — accessed through `AomApi.element`.
 */
class AomApiElement {
  descriptor!: PropertyDescriptor;

  isController?: boolean;

  isMarker?: boolean;

  isNextpoint?: boolean;

  isMiddleware?: boolean;

  isInstance?: boolean;

  isEndpoint?: boolean;

  isWebsocket?: boolean;

  bridges: AomBridge[] = [];

  markers: AomApi[] = [];

  instanceHooks: AomApi[] = [];

  endpoints: AomEndpoint[] = [];

  websockets: AomEndpoint[] = [];

  parameters: AomHttpParameters;

  pre_middlewares: AomApi[] = [];

  post_middlewares: AomApi[] = [];

  nextpoint?: AomApi;

  private api: AomApi;

  constructor(api: AomApi) {
    this.api = api;
    this.parameters = new AomHttpParameters(api);
  }

  addPreMiddlewares(...middlewares: AomApi[]) {
    this.pre_middlewares.push(...middlewares);
  }

  addPostMiddlewares(...middlewares: AomApi[]) {
    this.post_middlewares.push(...middlewares);
  }

  addNextpoint(nextpoint: AomApi) {
    this.nextpoint = nextpoint;
  }
}

/**
 * Router's meta-class: every decorated class and every decorated method of the router
 * gets one `AomApi` instance (a naming-map entry from `@aom-js/core`'s `AomCore`
 * registry). Decorators don't hold state themselves — they all resolve `AomApi.instance(target, property?)`
 * and write into its `element` (structural role and connections) and `openApi`
 * (accumulated OpenAPI declarations) fields.
 *
 * Application code rarely touches `AomApi` directly except through `@Cursor().$`
 * or when building tooling (markers, custom OpenAPI post-processing); everyday
 * routing is done with decorators.
 */
export class AomApi extends AomCore {
  openApi = new AomHttpOpenApi(this);

  element = new AomApiElement(this);

  delayStack: Array<FwdContainer | RouteRefContainer | ThisRefContainer> = [];

  // flag for one-time realization of delayStack (see AomCursor.realizeDelay)
  delayRealized = false;

  title?: string;

  description?: string;

  /** `"ClassName"` for a class-level instance, `"ClassName.method"` for a method-level one. */
  toString() {
    const { name } = this._.target;
    const property = this._.property;
    return [name, property].filter(Boolean).map(String).join(".");
  }

  /**
   * Returns the instance of `target` for the current request, creating and validating
   * it if needed. This is the single place that implements the two-stage instance
   * lifecycle described in the package readme (§"Instances, `state` and `@OnInstance`"):
   *
   * 1. **Already validated** — `context.state` has it: return immediately.
   * 2. **Being created by this same branch** (`target` is in `cursor.creating`):
   *    - if the calling code belongs to `target` itself (its own `@OnInstance` hook,
   *      or its own middleware raised through `@Run()`-`next()`), return the
   *      unvalidated object from `context.inflight` — this branch *is* the creation,
   *      there's nothing to wait for. If `inflight` has nothing yet, this is a
   *      genuine cycle (`target`'s own constructor referencing itself) —
   *      `CIRCULAR_INSTANCE_ERROR`.
   *    - if the calling code belongs to a different class, an unvalidated instance
   *      must never leak to it — `CIRCULAR_INSTANCE_ERROR` as well.
   * 3. **Being created by another branch** (`context.pending` has a promise for
   *    `target`): join that creation through `context.waitCreation` — returns the
   *    validated instance, or rethrows the same rejection every other waiter gets.
   *    A branch that would have to wait on itself (through a chain of waits) gets
   *    `CIRCULAR_INSTANCE_ERROR` instead of hanging forever.
   * 4. **Not started**: construct `target` (its constructor's own arguments are
   *    resolved from a cursor that carries the same ownership chain), publish it to
   *    `context.inflight` for its own code to use immediately, run every
   *    `@OnInstance` hook of `target` in parallel, and only on success publish the
   *    instance into `context.state` — this is the moment it becomes visible to
   *    `@This`/`@State` calls from other classes and other branches. A rejected
   *    hook or constructor leaves nothing in `state`; the rejection itself stays in
   *    `context.pending` for the rest of the request, so a second attempt to use the
   *    same class gets the same error instead of retrying construction.
   *
   * `RxContext.run` calls this unconditionally for the owner class of every cursor,
   * even when `@This()` is never used on it; `@This` itself has no separate `state`
   * read path — it always goes through here.
   *
   * @param target - class to get (or create) an instance of
   * @param args - `{context, cursor, route}` of the call site; `cursor.creating` is
   *   read to tell "my own creation" from "someone else's"
   * @returns the validated instance, or (when called from the creating branch's own
   *   code, before hooks finish) the unvalidated one — see rule 2 above
   * @throws {Error} `CIRCULAR_INSTANCE_ERROR` when creating `target` would require
   *   waiting on a branch that is itself waiting (directly or transitively) on the
   *   caller, or when foreign code tries to reach into `target`'s own creation
   *
   * @example
   * ```ts
   * import { Controller, OnInstance, This } from "@aom-js/router";
   *
   * @Controller()
   * class Auth {
   *   verified = false;
   *
   *   @OnInstance()
   *   static async verify(@This() self: Auth) {
   *     // self is unvalidated here — this hook's own code, allowed by rule 2
   *     await checkToken();
   *     self.verified = true;
   *   }
   * }
   *
   * @Controller()
   * class Dependent {
   *   // waits for Auth's hooks to finish; sees the validated object (rule 3/4)
   *   constructor(@This(Auth) public auth: Auth) {}
   * }
   * ```
   */
  static instanceWithHooks(target: ClassConstructor, args: ArgumentsHandlerParameters) {
    const { context, cursor } = args;

    // validated instance: only what has passed all of its own hooks ends up in state
    const ready = context.state.get(target);
    if (ready) return ready;

    if (cursor.creating.includes(target)) {
      // this same execution branch is holding target's creation. The class's own code
      // (its hook via @This(), or its own middleware via next()) gets the unvalidated
      // instance right away: there's nothing for it to wait for, it *is* the creation
      // that would otherwise have to be waited on
      if (cursor.$._.target === target) {
        const instance = context.inflight.get(target);
        // no instance yet — we're inside the class's own constructor: a genuine cycle
        if (!instance) throw circularInstanceError([...cursor.creating, target]);
        return instance;
      }
      // foreign code inside target's creation: it cannot wait (target's creation is
      // itself waiting for this very branch to finish), and we don't hand out the
      // unvalidated instance either — that's exactly the cycle
      throw circularInstanceError([...cursor.creating, target]);
    }

    // this class's creation is already in progress or has failed for this request —
    // return that instead of starting a second instance (method arguments are resolved
    // concurrently via Promise.all); run and @This will wait for the validated one or
    // get the same error
    const pending = context.pending.get(target);
    if (pending) return context.waitCreation(target, pending, cursor.creating.at(-1));

    const $target = AomApi.instance(target);
    // ownership chain: this branch creates target, and with it everything target pulls in
    const creating = [...cursor.creating, target];
    const creation = (async () => {
      // the first await — before parsing the constructor arguments — lets context.pending
      // (below) get recorded before @This from the constructor comes back here. Without it,
      // mutual constructor references fall into synchronous recursion and blow the stack
      // instead of producing a clear error
      await Promise.resolve();

      // constructor arguments are resolved from this branch's own cursor: a clone via the
      // prototype carries the ownership chain but doesn't re-run delayStack, and it keeps
      // $, index and the endpoint intact
      const ownCursor: AomCursor = Object.assign(Object.create(cursor), { creating });
      const instanceArgs = await Promise.all(
        $target.element.parameters.apply({ ...args, cursor: ownCursor }),
      );
      const instance = Reflect.construct(target, instanceArgs);

      // the instance is constructed but not yet validated: until its hooks finish it's
      // only visible to its own branch through inflight, it doesn't enter the request's
      // shared map (state)
      context.inflight.set(target, instance);

      // reuse the same mechanics as run(), just using instanceHooks as the source of cursors
      const { prefix, endpoint } = cursor;

      // run every hook concurrently (their relative order is not meant to matter)
      await Promise.all(
        $target.element.instanceHooks.map(($) => {
          const nextCursor = new AomCursor($, cursor.$, prefix, endpoint);
          nextCursor.creating = creating;
          return context.run([nextCursor]);
        }),
      );

      // hooks passed — only now does the instance become shared: @State, @This and cursors
      // from other branches can see it. If a hook rejected, nothing goes into state
      context.state.set(target, instance);
      return instance;
    })().finally(() => context.inflight.delete(target));

    // record the in-progress creation synchronously, before the first await. On success the
    // entry is removed — the instance is already in state. On failure (constructor or hook)
    // the rejected creation stays until the end of the request: further attempts to use the
    // class get the same error instead of creating it again — otherwise a sibling hook that
    // reaches the class after the failure would keep retrying creation and validation in a loop
    context.pending.set(target, creation);
    creation.then(
      () => context.pending.delete(target),
      // whoever awaits creation gets the error; this only keeps it from becoming unhandled
      () => undefined,
    );
    return creation;
  }
}

/**
 * One step of a route's execution chain: a middleware, an endpoint, a nextpoint, or an
 * `@OnInstance` hook, bound to the class (`$`) that owns it. `Router.build` and
 * `AomRoute`'s constructor create cursors while assembling a route; `RxContext.run`
 * executes them one by one.
 *
 * Creating a cursor has a side effect: it re-binds `$` to the correct subclass
 * (`AomApi.resolveFor`, needed when a decorator captured a parent class's static
 * reference before `@Controller()` ran on the child) and realizes the method's
 * `delayStack` — see `realizeDelay`.
 */
export class AomCursor {
  // the endpoint being applied
  /** Endpoint of the route this cursor belongs to; `undefined` for class-level middleware cursors collected by `Router.build` before `AomRoute` assigns one (see `realizeDelay` and `ROUTE_REF_DELAY_ERROR`). */
  endpoint?: AomEndpoint;

  // place where the cursor is attached
  /** The `AomApi` this cursor was attached from (the class that declared `@Before`/`@Bridge`/etc.), used to resolve `Self.Method`-style references against the right subclass. */
  origin: AomApi;

  // path prefix
  /** Path prefix in effect at the point this cursor was collected. */
  prefix: string;

  // sequence number
  /** Position of this cursor within `AomRoute.cursors`, assigned after the route is fully laid out. */
  index!: number;

  // the cursor's own api instance
  /** Meta-instance of the method (or class) this cursor executes — already re-bound to the correct subclass. */
  $: AomApi;

  // ownership chain: classes whose creation this execution branch is holding. Lives on the
  // cursor, not on the context: the context is one per request, while several branches run
  // concurrently (Promise.all over hooks, over arguments), and a shared list would mix them up
  /**
   * Ownership chain: classes whose creation this execution branch is currently holding.
   * Lives on the cursor rather than on `RxContext` because several branches run
   * concurrently within one request (`Promise.all` over hooks, over constructor
   * arguments) and a single shared list would mix them up. Read by
   * `AomApi.instanceWithHooks` to tell "my own creation" from "someone else's" and to
   * build the class-name chain in `CIRCULAR_INSTANCE_ERROR`.
   */
  creating: ClassConstructor[] = [];

  constructor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint) {
    // if $ refers to the parent class's static side relative to the attachment point —
    // rebind to the descendant's instance before realizing the delay stack, otherwise
    // ThisRef gets a class without inherited values (e.g. without a builder's schema)
    this.$ = AomApi.resolveFor($, origin._.target);
    this.origin = origin;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.index = 0;

    this.realizeDelay();
  }

  /**
   * Runs the method's `@DelayRefStack` handlers once, applying the decorators they
   * return via `Reflect.decorate` in the context of the correct subclass. Guarded by
   * `$.delayRealized` so a meta-instance shared by several cursors (class-level
   * middleware reused across routes) only realizes its stack the first time.
   *
   * @throws {Error} `ROUTE_REF_DELAY_ERROR` when the stack contains a `RouteRef` but
   *   this cursor has no `endpoint` yet (class-level middleware collected by
   *   `Router.build`, before `AomRoute` gives it one) — a controlled error instead of
   *   a raw `TypeError` from dereferencing `undefined`.
   *
   * If a handler throws, `delayRealized` is left `false` and the stack is not
   * consumed: the same binding problem reproduces on every subsequent attempt to
   * build a cursor from this meta-instance, instead of silently degrading.
   */
  private realizeDelay() {
    const { $ } = this;

    const { target, property } = $._;
    // the delay stack is realized on the instance exactly once; on error the flag isn't set
    // and the stack isn't consumed — the binding problem reproduces on every subsequent
    // build instead of silently going away
    if (!$.delayRealized && $.delayStack.length) {
      for (const handler of $.delayStack) {
        // run the delayed actions
        if (handler instanceof FwdContainer) {
          Reflect.decorate([...handler.exec()], target, property!);
        } else if (handler instanceof ThisRefContainer) {
          Reflect.decorate([...handler.exec(target)], target, property!);
        } else if (handler instanceof RouteRefContainer) {
          // RouteRef is realized from the route's endpoint; class-level middleware cursors
          // from Router.build have no endpoint yet — this is a definition error, not a TypeError
          if (!this.endpoint) throw new Error(constants.ROUTE_REF_DELAY_ERROR);
          Reflect.decorate([...handler.exec(this.endpoint.$._.target)], target, property!);
        }
      }
      $.delayRealized = true;
      // apply any pending delayed calls
      $._.apply();
    }
  }
}

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
   * Values written by this route's `@Marker()`-decorated cursors, keyed by whatever
   * the marker handler chooses to set — build-time only, not touched during request
   * execution. See `@Marker`/`@UseMarker`.
   */
  markers: MarkerType = {};

  /** Flat, ordered list of cursors this route runs: `classBefore → classAfter → methodBefore → endpoint → methodAfter → @Next chain`. */
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
   * nextpoint (processed the same way, so a chain of `@Next` calls unrolls fully).
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

/**
 * Per-request execution context: request values, the map of validated instances, and
 * the bookkeeping that makes `@This`/`@State`/`lazy(...)` safe under concurrency. One
 * `RxContext` is created per `AomRoute.apply()` call and discarded at the end of the
 * request — nothing here is shared across requests.
 *
 * Not exported from the package; application code reaches it only through
 * `ArgumentsHandlerParameters.context` inside an `Args(...)` handler (`@Cursor()`,
 * `@Run()`, custom argument decorators).
 */
class RxContext {
  /** Request values passed to `AomRoute.apply()`; read `value(key)` instead of this directly to resolve `lazy(...)` fields. */
  values: HttpContextValues;

  /** Instances that finished all their `@OnInstance` hooks — the only ones `@This`/`@State` from other classes/branches can see. */
  state: ClassInstanceMap;

  // creations currently in flight or rejected (a rejection is remembered until the end of
  // the request, see AomApi.instanceWithHooks); only hook-validated ones end up in state
  /** Creations currently in flight or rejected, keyed by class. A rejection stays here for the rest of the request — see `AomApi.instanceWithHooks`. */
  pending = new Map<ClassConstructor, Promise<any>>();

  // instances that are constructed but not yet validated by hooks: visible only to the
  // branch that is creating them (its own code), removed as soon as their hooks finish
  /** Constructed-but-unvalidated instances, visible only to the branch creating each one — removed as soon as its hooks finish (success or failure). */
  inflight = new Map<ClassConstructor, any>();

  // who is waiting on whom: the edge lives as long as a branch is waiting on someone else's
  // creation. Needed so that two branches waiting on each other become a clear error instead
  // of the request silently hanging. One edge per waiter is enough in the common case: a
  // branch's own cursors run one at a time (concatMap in run()), so it normally waits on a
  // single target at a time. Known limitation: if the same branch ends up waiting on two
  // different pending creations concurrently (e.g. two @This(...) constructor arguments
  // resolved together via Promise.all, both already pending elsewhere), only the most recent
  // edge is kept — a cycle that closes through the overwritten earlier edge could in theory
  // hang instead of throwing CIRCULAR_INSTANCE_ERROR. Not reproduced by the package's tests.
  /** `waiter → target` edges: which class-creating branch is waiting on which other creation, used to turn mutual waiting into `CIRCULAR_INSTANCE_ERROR` instead of a hang. */
  waits = new Map<ClassConstructor, ClassConstructor>();

  // started computations of lazy context values (see common/lazy.ts): the rejection or the
  // result is remembered until the end of the request — a second access to the same field
  // (concurrent or not) gets the same promise instead of re-running the factory (for the
  // request body this is effectively a second pass over the stream)
  private resolved = new Map<keyof HttpContextValues, Promise<any>>();

  route: AomRoute;
  //
  constructor(context: HttpContextValues, route: AomRoute) {
    this.values = context;

    this.route = route;

    this.state = new ClassInstanceMap();
  }

  // waiting on someone else's creation: before joining the queue, check whether target
  // (directly or through a chain) is itself waiting on the waiter's creation — otherwise
  // both branches would hang forever
  /**
   * Joins an in-progress creation of `target` instead of starting a second one.
   * Before waiting, walks the `waits` chain starting from `target` to check whether it
   * (directly or transitively) is already waiting on `waiter` — if so, waiting now
   * would deadlock both branches, so this throws `CIRCULAR_INSTANCE_ERROR` instead.
   * Otherwise records the `waiter → target` edge and removes it once `creation`
   * settles, either way.
   *
   * @param target - class whose creation is being waited on
   * @param creation - the in-progress promise from `context.pending`
   * @param waiter - class the calling branch is itself creating, if any; branches that
   *   aren't creating anything (`waiter` undefined) have nothing to deadlock, so they
   *   just await `creation`
   * @returns the same `creation` promise, so callers can `await` the result directly
   * @throws {Error} `CIRCULAR_INSTANCE_ERROR` when waiting would close a cycle
   */
  waitCreation(target: ClassConstructor, creation: Promise<any>, waiter?: ClassConstructor): any {
    // the branch isn't creating anything — there's nothing to close a cycle with, no edge needed
    if (!waiter) return creation;

    const chain: ClassConstructor[] = [waiter];
    for (let next = target; next; next = this.waits.get(next)!) {
      chain.push(next);
      if (next === waiter) throw circularInstanceError(chain);
    }

    this.waits.set(waiter, target);
    const release = () => {
      if (this.waits.get(waiter) === target) this.waits.delete(waiter);
    };
    // the creation error goes to whoever awaits creation; here we only remove the edge in
    // both cases and keep the rejection from becoming unhandled
    creation.then(release, release);

    return creation;
  }

  // resolving a lazy context field: a ready value is returned as-is (today's behavior is
  // unchanged), a lazy one runs its factory no earlier than the first access and only once
  // per request
  /**
   * Resolves one field of `values` (`context.values`), transparently unwrapping a
   * `lazy(...)` field on first use. This is what `@Body`, `@Query`, `@Params`,
   * `@Cookies`, `@Headers`, `@Session`, `@Files` call instead of reading `values[key]`
   * directly — so the "compute at most once, share the same result/rejection with
   * every reader" rule applies uniformly to every context field.
   *
   * @param key - field of `HttpContextValues` to resolve
   * @returns the plain value as-is if it isn't a `LazyValue`; otherwise a promise that
   *   resolves (or rejects) with the factory's result, shared by every caller for this
   *   request regardless of how many times `value(key)` is called
   */
  value<K extends keyof HttpContextValues>(key: K): any {
    // any: with a generic K, the indexed type HttpContextValues[K] is a union, not an object
    // type, and TS won't let instanceof be applied to it
    const source: any = this.values[key];
    if (!(source instanceof LazyValue)) return source;

    const cached = this.resolved.get(key);
    if (cached) return cached;

    // Promise.resolve().then(...) routes both the factory's synchronous throw and its own
    // rejection into the same path: callers of value() don't need to tell the two apart
    const promise = Promise.resolve().then(() => source.factory());
    // the promise must be stored into resolved synchronously, before any await — otherwise
    // two concurrent accesses to the same field (e.g. two @Body reads inside one Promise.all)
    // wouldn't see each other's entry and both would run the factory; value() has no await
    // before this point, so synchronous execution order guarantees it
    this.resolved.set(key, promise);
    // the rejection goes to whoever calls value(); here we only keep it from becoming
    // unhandled — the same trick as with pending above
    promise.catch(() => undefined);
    return promise;
  }

  /**
   * Runs `cursors` strictly one after another (`concatMap` — no cursor starts before
   * the previous one settles). For each cursor: ensures its owner class has a
   * validated instance (`AomApi.instanceWithHooks`, called unconditionally even if the
   * method never uses `@This`), resolves its parameters concurrently
   * (`Promise.all`), then invokes the method with `this` bound to the class itself
   * (every handler is static).
   *
   * The chain stops at the first cursor whose result is not `undefined` — that value
   * becomes the resolved result. If every cursor returns `undefined`, the promise
   * resolves to `undefined`. A thrown error, or a returned `Error` instance, rejects
   * the promise instead of resolving it.
   *
   * This is also what `@Run()`'s returned function calls to execute extra cursors
   * built from arbitrary handlers, inside the same context.
   *
   * @param cursors - cursors to execute, in order
   * @returns a promise for the first non-`undefined` cursor result, or `undefined`
   * @throws {Error} whatever a cursor threw or returned as an `Error`
   */
  run(cursors: AomCursor[]): any {
    const { route } = this;
    return new Promise((resolve, reject) => {
      from(cursors)
        .pipe(
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              // get an instance of its class at the level of every cursor (works even with a
              // decorated constructor): the "ready / own branch / someone else's creation /
              // create" rule lives entirely in instanceWithHooks, we don't duplicate it here
              const { target } = $._;
              await AomApi.instanceWithHooks(target, { context: this, cursor, route });
              const args = await Promise.all(
                $.element.parameters.apply({ context: this, cursor, route }),
              );

              const result = await Reflect.apply(
                $.element.descriptor?.value || new Function(),
                target,
                args,
              );

              // if the result is an Error, throw it
              if (result instanceof Error) {
                throw result;
              }

              return result;
            } catch (error) {
              throw error;
            }
          }),
          takeWhile((result) => result === undefined, true),
          catchError((error) => throwError(() => error)),
        )
        .subscribe({
          next: (result) => {
            // if the result is not undefined, stop execution and return the result
            if (result !== undefined) {
              resolve(result);
            }
          },
          error: (error) => reject(error),
          complete: () => resolve(undefined),
        });
    });
    //
  }
}
