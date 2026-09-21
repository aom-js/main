// All codes below are messages of `Error`s thrown synchronously at decoration time
// (except CIRCULAR_INSTANCE_ERROR — that one is thrown during request execution).
// `error.message` equals the code itself, there's no separate text; the codes aren't
// exported from the package (used only as string constants inside decorators/*).

/** `\@This(x)` where `x` isn't a class, `FwdRef(...)`, or `RouteRef(...)`. */
export const CONSTRUCTOR_TYPE_ERROR = "CONSTRUCTOR_TYPE_ERROR";
/** `\@Err(C)` where `C` isn't `Error` or a subclass of it. */
export const ERROR_CONSTRUCTOR_ERROR = "ERROR_CONSTRUCTOR_ERROR";
/** `Args(h)` where `h` isn't a function. */
export const PARAMETER_HANDLER_ERROR = "PARAMETER_HANDLER_ERROR";
/** Reserved, not thrown anywhere in the current code. */
export const CONSTRUCTOR_PROPERTY_TYPE_ERROR = "CONSTRUCTOR_PROPERTY_TYPE_ERROR";
/** Class-level `\@Get(path, handler)` (and other HTTP-method shorthands) where `handler` isn't `\@Nextpoint()`. */
export const COMMON_ENDPOINT_ERROR = "COMMON_ENDPOINT_ERROR";

/** An endpoint decorator (`\@Get`/`\@Endpoint`/...) on a method already marked `\@Middleware()` or `\@WebSocketPoint()`. */
export const ENDPOINT_DEFINE_ERROR = "ENDPOINT_DEFINE_ERROR";
/** `\@Nextpoint()` on a method already marked `\@Middleware()`, or `\@WebSocketPoint()` on a method already marked `\@Middleware()`/`\@Nextpoint()`. */
export const NEXPOINT_DEFINE_ERROR = "NEXPOINT_DEFINE_ERROR";
/** Reserved, not thrown anywhere in the current code. */
export const WEBSOCKET_DEFINE_ERROR = "WEBSOCKET_DEFINE_ERROR";
/** `\@Middleware()` on a method already marked as nextpoint, endpoint, websocket, or `\@OnInstance`. */
export const MIDDLEWARE_DEFINE_ERROR = "MIDDLEWARE_DEFINE_ERROR";
/** `\@OnInstance()` on a method already marked as nextpoint, endpoint, websocket, or `\@Middleware()`. */
export const ON_INSTANCE_DEFINE_ERROR = "ON_INSTANCE_DEFINE_ERROR";

/** `\@Next(h)` where `h` isn't `\@Nextpoint()`. */
export const USE_NEXT_DEFINE_ERROR = "USE_NEXT_DEFINE_ERROR";
/** `\@UseMarker(h)` where `h` isn't `\@Marker()`. */
export const USE_MARKER_DEFINE_ERROR = "USE_MARKER_DEFINE_ERROR";
/** `\@Before`/`\@After` referencing a method that isn't `\@Middleware()`. */
export const USE_MIDDLEWARE_DEFINE_ERROR = "USE_MIDDLEWARE_DEFINE_ERROR";

/** `\@DelayRefStack(RouteRef(...))` realized on a cursor with no `endpoint` — class-level middleware collected by `Router.build`, before `AomRoute` assigns one. */
export const ROUTE_REF_DELAY_ERROR = "ROUTE_REF_DELAY_ERROR";

/**
 * Thrown at request time (not at decoration time, unlike every other code here) by
 * `AomApi.instanceWithHooks`/`RxContext.waitCreation` when creating/waiting for a class
 * instance would require the current branch to wait on itself, directly or through a
 * chain of other branches — mutual `\@This`/`\@OnInstance` dependencies between classes,
 * a class referencing itself before its constructor returns, or two branches waiting
 * on each other. The message lists every class in the cycle, joined by `->`.
 */
export const CIRCULAR_INSTANCE_ERROR = "CIRCULAR_INSTANCE_ERROR";
