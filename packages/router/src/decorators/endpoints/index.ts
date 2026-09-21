import * as constants from "../../constants";

import { HandlerFunction, HTTPMethods } from "../../common";

import { AomApi } from "../../common";

/**
 * Shared implementation behind `Get`/`Post`/`Put`/`Patch`/`Delete`/`Options`/`All`.
 * Without `handler`, returns the plain method-decorator form (`Endpoint(method, path)`).
 * With `handler`, returns the class-decorator form: `handler` must already be a
 * `\@Nextpoint()`-decorated method, and the class gets it registered as its own
 * endpoint at `path`/`method` — otherwise `COMMON_ENDPOINT_ERROR`.
 */
function defineEndpoint(
  method: HTTPMethods,
  path: string,
  handler?: HandlerFunction,
): ReturnType<typeof Endpoint> | ClassDecorator {
  if (!handler) {
    return Endpoint(method, path);
  }

  return AomApi.classDecorator(($) => {
    const handlerOrigin = AomApi.instance(handler);
    if (handlerOrigin.element.isNextpoint) {
      $.element.endpoints.push({ method, prefix: path, $: handlerOrigin });
    } else {
      throw new Error(constants.COMMON_ENDPOINT_ERROR);
    }
  });
}

// set the flag marking this as a nextPoint
/**
 * Marks a method as a nextpoint — a method that can be chained after another one via
 * `\@Next(...)` or attached as a class-level endpoint (`\@Get(path, handler)` form).
 * A nextpoint is not itself reachable directly; it only runs as the continuation
 * another method points at.
 *
 * @throws {Error} `NEXPOINT_DEFINE_ERROR` if the method is already `\@Middleware()`
 *
 * @example
 * ```ts
 * import { Controller, Get, Next, Nextpoint } from "@aom-js/router";
 *
 * \@Controller()
 * class Data {
 *   \@Nextpoint()
 *   static async page() {
 *     return { items: [] };
 *   }
 * }
 *
 * \@Controller()
 * class App {
 *   \@Get("/list")
 *   \@Next(Data.page)
 *   static async list() {}
 * }
 * ```
 */
export function Nextpoint(): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware) {
      throw new Error(constants.NEXPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isNextpoint = true;
    }
  });
}

// set the flag marking this as a websocket, and add it to the matching set of endpoints
// (which it indeed is) using the special "sockets" method
/**
 * Marks a method as a websocket endpoint. Registered into `Router.sockets` (built with
 * method `"sockets"`), kept separate from `Router.routes` and **not** included in the
 * OpenAPI document.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @throws {Error} `NEXPOINT_DEFINE_ERROR` if the method is already `\@Middleware()` or `\@Nextpoint()`
 *
 * @example
 * ```ts
 * import { Controller, WebSocketPoint } from "@aom-js/router";
 *
 * \@Controller()
 * class Live {
 *   \@WebSocketPoint("/updates")
 *   static async stream() {}
 * }
 * ```
 */
export function WebSocketPoint(path: string = "/"): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware || $.element.isNextpoint) {
      throw new Error(constants.NEXPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isWebsocket = true;
      $._.root.element.websockets.push({ method: "sockets", prefix: path, $ });
    }
  });
}

/**
 * Base endpoint decorator: registers a method as reachable at `method`/`path`. Every
 * `\@Get`/`\@Post`/`\@Put`/`\@Patch`/`\@Delete`/`\@Options`/`\@All(path?)` shorthand is a thin
 * wrapper around this. Prefer the HTTP-method shorthands in application code; use
 * `Endpoint` directly only for a method not covered by them (there is none right now
 * besides `"all"`, already covered by `\@All`).
 *
 * @param method - HTTP method the endpoint responds to
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` if the method is already `\@Middleware()` or `\@WebSocketPoint()`
 *
 * @example
 * ```ts
 * import { Controller, Endpoint } from "@aom-js/router";
 *
 * \@Controller()
 * class App {
 *   \@Endpoint("get", "/hello")
 *   static async hello() {
 *     return "hi";
 *   }
 * }
 * ```
 */
export function Endpoint(
  method: HTTPMethods,
  path: string = "/",
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware || $.element.isWebsocket) {
      throw new Error(constants.ENDPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isEndpoint = true;
      $._.root.element.endpoints.push({ method, prefix: path, $ });
    }
  });
}

// ************************************************ //
export function Get(path?: string): MethodDecorator;
export function Get(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * Registers a `GET` endpoint. Two forms:
 *
 * - **method decorator** `\@Get(path?)` — the common case, marks the decorated method
 *   itself as the endpoint (defaults `path` to `"/"`).
 * - **class decorator** `\@Get(path, handler)` — attaches someone else's
 *   `\@Nextpoint()`-decorated method as this class's endpoint at `path`, without
 *   writing a wrapper method. `handler` must already be `\@Nextpoint()`, or this throws
 *   `COMMON_ENDPOINT_ERROR`.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method to expose here
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` (method form, conflicting role) or `COMMON_ENDPOINT_ERROR` (class form, `handler` isn't a nextpoint)
 *
 * @example
 * ```ts
 * import { Controller, Get, Query } from "@aom-js/router";
 *
 * \@Controller()
 * class Orgs {
 *   \@Get("/") // GET /orgs (mounted under whatever prefix the controller sits at)
 *   static async index(\@Query("page") page: string) {
 *     return { page };
 *   }
 * }
 * ```
 */
export function Get(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "get";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Post(path?: string): MethodDecorator;
export function Post(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * Registers a `POST` endpoint. Same two forms as {@link Get}: method decorator marks
 * the method itself; `\@Post(path, handler)` on a class attaches an existing
 * `\@Nextpoint()` method as the endpoint.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, Post, Body } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Post("/items")
 *   static async create(\@Body() body: unknown) {
 *     return body;
 *   }
 * }
 * ```
 */
export function Post(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "post";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Patch(path?: string): MethodDecorator;
export function Patch(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * Registers a `PATCH` endpoint. Same two forms as {@link Get}.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, Patch, Params, Body } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Patch("/items/item_id")
 *   static async update(\@Params("item_id") id: string, \@Body() body: unknown) {
 *     return { id, ...Object(body) };
 *   }
 * }
 * ```
 */
export function Patch(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "patch";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Put(path?: string): MethodDecorator;
export function Put(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * Registers a `PUT` endpoint. Same two forms as {@link Get}.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, Put, Body } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Put("/items/item_id")
 *   static async replace(\@Body() body: unknown) {
 *     return body;
 *   }
 * }
 * ```
 */
export function Put(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "put";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Options(path?: string): MethodDecorator;
export function Options(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * Registers an `OPTIONS` endpoint. Same two forms as {@link Get}.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, Options } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Options("/items")
 *   static async preflight() {
 *     return "";
 *   }
 * }
 * ```
 */
export function Options(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "options";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Delete(path?: string): MethodDecorator;
export function Delete(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * Registers a `DELETE` endpoint. Same two forms as {@link Get}.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, Delete, Params } from "@aom-js/router";
 *
 * \@Controller()
 * class Items {
 *   \@Delete("/items/item_id")
 *   static async remove(\@Params("item_id") id: string) {
 *     return { removed: id };
 *   }
 * }
 * ```
 */
export function Delete(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "delete";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function All(path?: string): MethodDecorator;
export function All(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * Registers an endpoint that matches every HTTP method (`method: "all"`). Same two
 * forms as {@link Get}; matching against a specific verb is left to `@aom-js/api`'s
 * route matcher.
 *
 * @param path - mount path relative to the controller's prefix; defaults to `"/"`
 * @param handler - class-decorator form only: an existing `\@Nextpoint()` method
 * @throws {Error} `ENDPOINT_DEFINE_ERROR` / `COMMON_ENDPOINT_ERROR` — see {@link Get}
 *
 * @example
 * ```ts
 * import { Controller, All } from "@aom-js/router";
 *
 * \@Controller()
 * class Catchall {
 *   \@All("/any")
 *   static async handle() {
 *     return "matched regardless of method";
 *   }
 * }
 * ```
 */
export function All(
  path: string = "/",
  handler?: HandlerFunction,
): ReturnType<typeof defineEndpoint> {
  const method = "all";
  return defineEndpoint(method, path, handler);
}
