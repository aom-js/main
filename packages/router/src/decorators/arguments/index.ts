import { ClassConstructor, ExecutionPhase } from "@aom-js/core";
import * as constants from "../../constants";

import {
  AomCursor,
  ArgumentsDecoratorHandler,
  ArgumentsHandlerParameters,
  HandlerFunction,
} from "../../common";
import { FwdContainer, ThisRefContainer, RouteRefContainer } from "../../common";
import { AomApi } from "../../common";

/** Default `Args` handler: returns the whole `{context, cursor, route}` object unchanged. */
function defaultHandler(args: ArgumentsHandlerParameters | any) {
  return args;
}

/**
 * Base parameter decorator every other argument decorator in this file is built on.
 * Registers `handler` to compute the value of one method parameter at request time.
 *
 * All parameter handlers of a method are resolved **concurrently** (`Promise.all` in
 * `RxContext.run`), not in declaration order — don't rely on side-effect ordering
 * between two parameters of the same method.
 *
 * @param handler - called with `{context, cursor, route}`; may be async; defaults to
 *   returning that object as-is
 * @returns a parameter decorator
 * @throws {Error} `PARAMETER_HANDLER_ERROR` if `handler` isn't a function
 *
 * @example
 * ```ts
 * import { Controller, Get, Args } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/whoami")
 *   static async whoami(@Args(({ cursor }) => cursor.$._.target.name) className: string) {
 *     return className;
 *   }
 * }
 * ```
 */
export function Args(
  handler: ArgumentsDecoratorHandler = defaultHandler,
): ReturnType<typeof AomApi.parameterDecorator> {
  if (typeof handler !== "function") throw new Error(constants.PARAMETER_HANDLER_ERROR);
  return AomApi.parameterDecorator(($, parameterIndex) => {
    $.element.parameters.handlers[parameterIndex] = handler;
  }, ExecutionPhase.LAST);
}

// ---
/**
 * Injects a value from the request's `query` field.
 *
 * `query` may be a plain object or a `lazy(...)` wrapper (see `HttpContextValues`);
 * either way this decorator reads it through `context.value("query")`, which resolves
 * the lazy factory on first access and caches the result for the rest of the request.
 *
 * @param queryHandler - what to extract:
 *   - omitted — the whole `query` object;
 *   - a string — `query[key]`;
 *   - a function — called with `query`, returns whatever it computes;
 *   - `ThisRef(fn)` — `fn` is resolved against the current cursor's class first, then
 *     the resulting function is called with `query`;
 *   - `RouteRef(fn)` — same, resolved against the route's endpoint class instead
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Query } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/search")
 *   static async search(@Query("term") term: string, @Query() all: Record<string, string>) {
 *     return { term, all };
 *   }
 * }
 * ```
 */
export function Query(
  queryHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler,
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context, cursor } = args;
    let resultHandler = queryHandler;
    if (queryHandler instanceof ThisRefContainer) {
      resultHandler = queryHandler.exec(cursor.$._.target);
    } else if (queryHandler instanceof RouteRefContainer) {
      resultHandler = queryHandler.exec(cursor.endpoint!.$._.target);
    } else if ("string" === typeof queryHandler) {
      return Reflect.get(await context.value("query"), queryHandler);
    }

    return Reflect.apply(<Function>resultHandler, undefined, [await context.value("query")]);
  };
  return Args(handler);
}

// ---
/**
 * Injects a value from the request's `body` field. Same extraction forms as
 * {@link Query} (omitted / string key / function / `ThisRef` / `RouteRef`), read
 * through `context.value("body")` — if the adapter supplied `lazy(() => parseBody())`,
 * the factory runs on first access here and its result (or rejection) is shared by
 * every `@Body()` parameter and middleware in the request.
 *
 * @param bodyHandler - see {@link Query} for the accepted forms
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Post, Body } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Post("/items")
 *   static async create(@Body() body: unknown) {
 *     return body;
 *   }
 * }
 * ```
 */
export function Body(
  bodyHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler,
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context, cursor } = args;
    let resultHandler = bodyHandler;
    if (bodyHandler instanceof ThisRefContainer) {
      resultHandler = bodyHandler.exec(cursor.$._.target);
    } else if (bodyHandler instanceof RouteRefContainer) {
      resultHandler = bodyHandler.exec(cursor.endpoint!.$._.target);
    } else if ("string" === typeof bodyHandler) {
      return Reflect.get(await context.value("body"), bodyHandler);
    }
    return Reflect.apply(<Function>resultHandler, undefined, [await context.value("body")]);
  };
  return Args(handler);
}

// ---
/**
 * Injects a value from the request's `params` field (path parameters). Same
 * extraction forms as {@link Query}, read through `context.value("params")` (may be
 * a `lazy(...)` field).
 *
 * @param paramsHandler - see {@link Query} for the accepted forms
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Params } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/item/item_id")
 *   static async one(@Params("item_id") id: string) {
 *     return { id };
 *   }
 * }
 * ```
 */
export function Params(
  paramsHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler,
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context, cursor } = args;
    let resultHandler = paramsHandler;
    if (paramsHandler instanceof ThisRefContainer) {
      resultHandler = paramsHandler.exec(cursor.$._.target);
    } else if (paramsHandler instanceof RouteRefContainer) {
      resultHandler = paramsHandler.exec(cursor.endpoint!.$._.target);
    } else if ("string" === typeof paramsHandler) {
      return Reflect.get(await context.value("params"), paramsHandler);
    }
    return Reflect.apply(<Function>resultHandler, undefined, [await context.value("params")]);
  };
  return Args(handler);
}

// ---
/**
 * Injects a value from the request's `cookies` field. Same extraction forms as
 * {@link Query}, read through `context.value("cookies")` (may be a `lazy(...)` field).
 *
 * @param paramsHandler - see {@link Query} for the accepted forms
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Cookies } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/session-id")
 *   static async id(@Cookies("sid") sid: string) {
 *     return sid;
 *   }
 * }
 * ```
 */
export function Cookies(
  paramsHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler,
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context, cursor } = args;
    let resultHandler = paramsHandler;
    if (paramsHandler instanceof ThisRefContainer) {
      resultHandler = paramsHandler.exec(cursor.$._.target);
    } else if (paramsHandler instanceof RouteRefContainer) {
      resultHandler = paramsHandler.exec(cursor.endpoint!.$._.target);
    } else if ("string" === typeof paramsHandler) {
      return Reflect.get(await context.value("cookies"), paramsHandler);
    }
    return Reflect.apply(<Function>resultHandler, undefined, [await context.value("cookies")]);
  };
  return Args(handler);
}

// ---
/**
 * Injects the request's `session` field, or one key of it. Read through
 * `context.value("session")`, so a `lazy(...)` session field is resolved on first
 * access and cached for the rest of the request.
 *
 * @param sessionName - key to extract; omitted returns the whole session object
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Session } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/me")
 *   static async me(@Session("userId") userId: string) {
 *     return userId;
 *   }
 * }
 * ```
 */
export function Session(sessionName?: string): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context } = args;
    const session = await context.value("session");
    return sessionName ? Reflect.get(session, sessionName) : session;
  };
  return Args(handler);
}

// ---
/**
 * Injects the request's `files` field, or one key of it. Read through
 * `context.value("files")` — pairs well with `lazy(...)` when reading uploaded files
 * is expensive and shouldn't happen before access checks run.
 *
 * @param fileName - key to extract; omitted returns the whole files object
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Post, Files } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Post("/upload")
 *   static async upload(@Files("avatar") avatar: unknown) {
 *     return avatar;
 *   }
 * }
 * ```
 */
export function Files(fileName?: string): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context } = args;
    const files = await context.value("files");
    return fileName ? Reflect.get(files, fileName) : files;
  };
  return Args(handler);
}

// ---
/**
 * Injects a value from the request's `headers` field. Same extraction forms as
 * {@link Query}, read through `context.value("headers")` (may be a `lazy(...)` field).
 *
 * @param headerHandler - see {@link Query} for the accepted forms
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Headers } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/whoami")
 *   static async whoami(@Headers("authorization") token: string) {
 *     return token;
 *   }
 * }
 * ```
 */
export function Headers(
  headerHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler,
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = async function (args) {
    const { context, cursor } = args;
    let resultHandler = headerHandler;
    if (headerHandler instanceof ThisRefContainer) {
      resultHandler = headerHandler.exec(cursor.$._.target);
    } else if (headerHandler instanceof RouteRefContainer) {
      resultHandler = headerHandler.exec(cursor.endpoint!.$._.target);
    } else if ("string" === typeof headerHandler) {
      return Reflect.get(await context.value("headers"), headerHandler);
    }
    return Reflect.apply(<Function>resultHandler, cursor.constructor, [
      await context.value("headers"),
    ]);
  };
  return Args(handler);
}

// ---
/**
 * Injects a function that runs extra cursors (built from arbitrary
 * `@Middleware()`/`@Nextpoint()`/handler functions) inside the current request
 * context, as if they were part of the route's own chain.
 *
 * The new cursors inherit the calling cursor's ownership chain (`creating`) — so a
 * middleware raised this way from inside a class's own `@OnInstance` hook is treated
 * as that class's own code (see `@OnInstance`'s reentrancy rules), while `next()`
 * called from a route's own middleware behaves like any other cursor in the chain: a
 * non-`undefined` result short-circuits the whole request, not just the `next()` call.
 *
 * @returns a parameter decorator that injects `(...handlers) => Promise<any>`
 *
 * @example
 * ```ts
 * import { Controller, Middleware, OnInstance, Run, HandlerFunction } from "@aom-js/router";
 *
 * class Auth {
 *   @Middleware()
 *   static async Required() {}
 * }
 *
 * @Controller()
 * class Optional {
 *   @Middleware()
 *   static async check(@Run() next: (...handlers: HandlerFunction[]) => Promise<unknown>) {
 *     try {
 *       await next(Auth.Required);
 *     } catch {
 *       // guest — carry on
 *     }
 *   }
 * }
 * ```
 */
export function Run(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ context, cursor }) {
    // return (...handlers: HandlerFunction[]) => nextSequences(handlers, args);
    return (...handlers: HandlerFunction[]) => {
      // rebuild cursors from the handlers, with the same endpoint
      const { prefix, endpoint } = cursor;
      const cursors = handlers.map((handler, index) => {
        const $ = AomApi.instance(handler);
        const nextCursor = new AomCursor($, cursor.$, prefix, endpoint);
        nextCursor.index = index;
        // next() doesn't create anything, so the ownership chain is carried forward as-is
        // (copied, not extended): a hook that called next(OwnClass.middleware) would
        // otherwise end up waiting on its own creation and hang
        nextCursor.creating = cursor.creating;
        return nextCursor;
      });
      // recursively invoke the same context, passing it the new list of cursors
      // that may have been given inside next()
      return context.run(cursors);
    };
  };
  return Args(handler);
}

// ---
/**
 * Injects `context.values.ctx` — the adapter-defined request context object (for
 * example a framework's own request/response wrapper).
 *
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Ctx } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/raw")
 *   static async raw(@Ctx() ctx: unknown) {
 *     return typeof ctx;
 *   }
 * }
 * ```
 */
export function Ctx() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.ctx;
  };
  return Args(handler);
}

// ---
/**
 * Injects a factory that builds an `Error` of the given class, with `status` and
 * `data` attached. `status` falls back, in order, to the argument, then
 * `error.status` (an instance field set by the error's own constructor), then a
 * static `status` field on `ErrorConstructor` itself.
 *
 * @param ErrorConstructor - `Error` or a subclass of it; defaults to `Error`
 * @returns a parameter decorator that injects `(message, status?, data?) => Error`
 * @throws {Error} `ERROR_CONSTRUCTOR_ERROR` if `ErrorConstructor` isn't `Error` or a subclass
 *
 * @example
 * ```ts
 * import { Controller, Get, Err } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/fail")
 *   static async fail(@Err() err: (message: string, status?: number) => Error) {
 *     return err("boom", 418); // returning an Error rejects the request with it
 *   }
 * }
 * ```
 */
export function Err(ErrorConstructor: ClassConstructor = Error): ReturnType<typeof Args> {
  if (!(ErrorConstructor === Error || ErrorConstructor.prototype instanceof Error))
    throw new Error(constants.ERROR_CONSTRUCTOR_ERROR);
  const handler = function () {
    return function (message: string, status?: number, data?: any) {
      const error = new ErrorConstructor(message);
      status = status || Reflect.get(error, "status") || Reflect.get(ErrorConstructor, "status");
      data = data || Reflect.get(error, "data");
      return Object.assign(error, { status, data });
    };
  };
  return Args(handler);
}

// ---
/**
 * Injects `context.values.req` — the adapter-defined raw request object.
 *
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Req } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/raw")
 *   static async raw(@Req() req: unknown) {
 *     return typeof req;
 *   }
 * }
 * ```
 */
export function Req() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.req;
  };
  return Args(handler);
}

// ---
/**
 * Injects `context.values.res` — the adapter-defined raw response object.
 *
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Res } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/raw")
 *   static async raw(@Res() res: unknown) {
 *     return typeof res;
 *   }
 * }
 * ```
 */
export function Res() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.res;
  };
  return Args(handler);
}

// ---
/**
 * Injects the `AomCursor` currently executing — useful for build/request tooling that
 * needs to know which class and method is running (`cursor.$._.target`), or its
 * position in the chain (`cursor.index`).
 *
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Cursor, AomCursor } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/whereami")
 *   static async whereami(@Cursor() cursor: AomCursor) {
 *     return cursor.$._.target.name;
 *   }
 * }
 * ```
 */
export function Cursor(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ cursor }) {
    return cursor;
  };
  return Args(handler);
}

// ---
/**
 * Injects the `AomRoute` currently being served — the whole matched route, including
 * `route.markers` and `route.cursors`.
 *
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Route, AomRoute } from "@aom-js/router";
 *
 * @Controller()
 * class App {
 *   @Get("/route-info")
 *   static async info(@Route() route: AomRoute) {
 *     return { method: route.method, path: route.path };
 *   }
 * }
 * ```
 */
export function Route(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ route }) {
    return route;
  };
  return Args(handler);
}

// ---
/**
 * Injects an already-validated instance from `state`, or the whole `state` map.
 * Unlike `@This`, this **never creates** an instance and never waits — if `constructor`
 * hasn't finished its `@OnInstance` hooks yet (or hasn't even started), you get
 * `undefined` from `state.get(constructor)`, not the object being built.
 *
 * This makes `@State` safe to use for "peek without triggering creation" checks, but
 * also means its result can be `undefined` even for a class that *will* be created
 * later in the same request — order matters. `@This(constructor)` is what you want
 * when you need the instance to exist.
 *
 * @param constructor - class to look up; omitted returns the whole `state` map
 * @returns a parameter decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, This, State } from "@aom-js/router";
 *
 * class Slow {}
 *
 * @Controller()
 * class App {
 *   @Get("/state")
 *   static async state(@This(Slow) created: Slow, @State(Slow) fromState: Slow | undefined) {
 *     // fromState is undefined here: both parameters resolve concurrently, and
 *     // @This(Slow)'s creation (async even with no @OnInstance hooks) hasn't reached
 *     // its state.set(Slow, ...) yet by the time @State's synchronous lookup runs
 *     return { created, fromState };
 *   }
 * }
 * ```
 */
export function State(constructor?: ClassConstructor): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = ({ context }) => {
    // if `FwdRef` is used, the target value is the function's result
    // if (constructor instanceof FwdContainer) {
    //   constructor = constructor.exec();
    // }
    return constructor ? context.state.get(constructor) : context.state;
  };
  return Args(handler);
}

// ---
/**
 * Injects an instance of a class, creating it if this is the first request for it and
 * waiting for its validation if someone else is already creating it. This is the
 * router's DI mechanism — every dependency between controllers goes through `@This`.
 *
 * **Target resolution**, in order: `FwdRef(fn)` → `fn()`; `RouteRef(fn)` →
 * `fn(route.endpoint's class)`; a class → used as-is; omitted → the class of the
 * current cursor (so `@This()` inside a class's own method/hook means "this class").
 *
 * **Visibility follows the two-stage instance lifecycle** (see `@OnInstance`):
 *
 * - From **inside the target class's own code** (its own `@OnInstance` hook, or its
 *   own middleware raised through `@Run()`-`next()` from that hook) — the instance is
 *   returned immediately, even if its hooks are still running and it hasn't been
 *   validated yet. There's nothing to wait for: this code *is* the validation.
 * - From **anywhere else** — a constructor, a middleware, another class's hook, a
 *   different execution branch — `@This` waits for the target's hooks to finish and
 *   returns the validated instance, or rejects with whatever error the target's
 *   construction or hooks produced.
 * - A **cycle** in this waiting graph (two classes mutually depending on each other
 *   through `@This`, a class referencing itself from inside its own constructor before
 *   it exists, two branches waiting on each other) never hangs — it throws
 *   `CIRCULAR_INSTANCE_ERROR` naming every class in the chain, joined by `->`.
 *
 * Two `@This(X)` parameters of the same method, or a class needed both directly and
 * through another class's constructor, share one instance and run `X`'s hooks exactly
 * once — concurrent requests for the same class within a request are deduplicated.
 * A failed construction or hook is remembered for the rest of the request: a second
 * `@This(X)` later in the same request gets the same rejection, not a retry.
 *
 * @param constructor - class to get an instance of, a `FwdRef`/`RouteRef` wrapping a
 *   class resolver, or omitted for the current cursor's own class
 * @returns a parameter decorator
 * @throws {Error} `CONSTRUCTOR_TYPE_ERROR` if `constructor` is provided but isn't a
 *   function, `FwdRef`, or `RouteRef`
 * @throws {Error} `CIRCULAR_INSTANCE_ERROR` at request time — see above
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
 *     await checkToken();
 *     self.verified = true; // own hook: sees the unvalidated object, fine
 *   }
 * }
 *
 * @Controller()
 * class Dependent {
 *   // waits for Auth's hooks, gets the validated instance (or the same rejection)
 *   constructor(@This(Auth) public auth: Auth) {}
 * }
 * ```
 */
export function This(
  constructor?: ClassConstructor | FwdContainer | RouteRefContainer,
): ReturnType<typeof Args> {
  if (
    constructor &&
    !(
      constructor instanceof Function ||
      constructor instanceof FwdContainer ||
      constructor instanceof RouteRefContainer
    )
  ) {
    throw new Error(constants.CONSTRUCTOR_TYPE_ERROR);
  }
  // const handler = ({ ctx, cursor, route }: ArgumentsHandlerParameters) => {
  const handler: ArgumentsDecoratorHandler = async (args) => {
    const { context, cursor } = args;
    let target: ClassConstructor;
    if (constructor instanceof FwdContainer) {
      // if `FwdRef` is used, the target value is the function's result
      target = constructor.exec();
    } else if (constructor instanceof RouteRefContainer) {
      // if RouteRef is used, it returns the constructor for the current route
      target = constructor.exec(cursor.endpoint!.$._.target);
    } else if (constructor) {
      target = constructor;
    } else {
      target = cursor.$._.target;
    }

    // ready instance, unvalidated for the own branch, or waiting on someone else's creation —
    // instanceWithHooks decides all of that; there must be no separate state read here
    return AomApi.instanceWithHooks(target, args);
  };
  return Args(handler);
}
