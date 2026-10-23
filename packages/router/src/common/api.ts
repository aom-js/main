import { AomCore } from "@aom-js/core";
import type { ClassConstructor, InstanceTarget } from "@aom-js/core";

import type { HTTPMethods } from "./types";

import type {
  OpenApiParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
} from "./openapi";

import type { FwdContainer, RouteRefContainer, ThisRefContainer } from "./references";
import type { AomCursorKind, AomParameterKind, AomValuesSource } from "./kinds";
import { circularInstanceError, type RxContext } from "./context";
import { AomCursor } from "./cursor";
import type { AomRoute } from "./route";

/**
 * How `OpenApi.registerPath` merges OpenAPI tags collected while walking a route's
 * cursors. The active rule changes only on a cursor that carries `\@UseTag`; it stays
 * in effect for every cursor after that until changed again.
 *
 * - `REPLACE` (default) — the new tag replaces the last one collected.
 * - `MERGE` — the new tag is appended, producing a joined string like `"A > B"`.
 * - `IGNORE` — the tag on this cursor is dropped entirely.
 *
 * Set with `\@ReplaceNextTags()` / `\@MergeNextTags()` / `\@IgnoreNextTags()`.
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

/**
 * What one parameter injects, written by `Args(handler, descriptor)` next to the handler.
 * Readable without running the handler — the cursor projection resolves `ref` with the
 * same `resolveTarget` the handler calls on every request.
 */
export declare type AomParameterDescriptor = {
  kind: AomParameterKind;
  /** For `Values`: the request field read. */
  source?: AomValuesSource;
  /** The decorator's target argument: a class, `FwdRef`/`ThisRef`/`RouteRef`, a key or a handler function. */
  ref?: unknown;
  /** For `Other`: the custom decorator's name. */
  name?: string;
};

/** One `\@Bridge(prefix, next)` registration: `next` is mounted under `prefix` relative to the declaring class. */
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

/** Tag state accumulated on one `AomApi.openApi.tag` — the class set by `\@UseTag` and the active `TagsRules`. */
class AomHttpOpenApiTags {
  $!: AomApi;
  rule!: TagsRules;
}

/**
 * OpenAPI declarations accumulated on one `AomApi` by the `\@Title`/`\@Responses`/
 * `\@RequestBody`/`\@PathParameters`/`\@Parameters`/`\@Security`/`\@UseTag`/tag-rule
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
 * `\@Args(handler)` (and everything built on it — `\@Query`, `\@Body`, `\@This`, ...)
 * writes into `handlers[i]`; `apply()` runs every handler concurrently and returns
 * the array of results (still promises — the caller in `RxContext.run` awaits them
 * with `Promise.all`). Not exported — accessed through `AomApi.element.parameters`.
 */
class AomHttpParameters {
  handlers: ArgumentsDecoratorHandler[] = [];

  /** `descriptors[i]` describes `handlers[i]` — see {@link AomParameterDescriptor}. */
  descriptors: AomParameterDescriptor[] = [];

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
 * middleware, nextpoint, websocket, `\@OnInstance` hook, marker) and what it's
 * connected to (bridges, other endpoints, pre/post middlewares, nextpoint, markers,
 * instance hooks). Structural decorators (`\@Get`, `\@Middleware`, `\@Before`, `\@Bridge`,
 * `\@OnInstance`, `\@Marker`, ...) are thin wrappers that set these fields; conflicting
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

  /** Kind declared with `\@CursorKind` on the step's definition; derivable kinds are inferred by the application. */
  cursorKind?: AomCursorKind;

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
 * Application code rarely touches `AomApi` directly except through `\@Cursor().$`
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
  static toString(handler: InstanceTarget): string | undefined {
    return this.checkExists(handler)?.toString();
  }

  /** `"ClassName"` for a class-level instance, `"ClassName.method"` for a method-level one. */
  toString() {
    const { name } = this._.target;
    const property = this._.property;
    return [name, property].filter(Boolean).map(String).join(".");
  }

  /**
   * Returns the instance of `target` for the current request, creating and validating
   * it if needed. This is the single place that implements the two-stage instance
   * lifecycle described in `https://aom-js.github.io/docs/packages/router/#инстансы-state-и-oninstance-aomapiinstancewithhooks`:
   *
   * 1. **Already validated** — `context.state` has it: return immediately.
   * 2. **Being created by this same branch** (`target` is in `cursor.creating`):
   *    - if the calling code belongs to `target` itself (its own `\@OnInstance` hook,
   *      or its own middleware raised through `\@Run()`-`next()`), return the
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
   *    `\@OnInstance` hook of `target` in parallel, and only on success publish the
   *    instance into `context.state` — this is the moment it becomes visible to
   *    `\@This`/`\@State` calls from other classes and other branches. A rejected
   *    hook or constructor leaves nothing in `state`; the rejection itself stays in
   *    `context.pending` for the rest of the request, so a second attempt to use the
   *    same class gets the same error instead of retrying construction.
   *
   * `RxContext.run` calls this unconditionally for the owner class of every cursor,
   * even when `\@This()` is never used on it; `\@This` itself has no separate `state`
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
   * \@Controller()
   * class Auth {
   *   verified = false;
   *
   *   \@OnInstance()
   *   static async verify(\@This() self: Auth) {
   *     // self is unvalidated here — this hook's own code, allowed by rule 2
   *     await checkToken();
   *     self.verified = true;
   *   }
   * }
   *
   * \@Controller()
   * class Dependent {
   *   // waits for Auth's hooks to finish; sees the validated object (rule 3/4)
   *   constructor(\@This(Auth) public auth: Auth) {}
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
      context.created?.push({ target, by: cursor.$, via: cursor.creating.at(-1) });
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
