import { ClassType } from "@aom-js/core";

/**
 * HTTP methods recognized by endpoint decorators, plus `"sockets"` used internally
 * for the method of routes built from `\@WebSocketPoint`.
 */
export declare type HTTPMethods =
  "get" | "post" | "put" | "patch" | "delete" | "options" | "all" | "sockets";

/**
 * Signature of any statically decorated method the router can call as a cursor:
 * endpoint, nextpoint, middleware or `\@OnInstance` hook. Arguments are resolved by
 * parameter decorators, not by this type.
 */
export declare type HandlerFunction = (...args: any[]) => any;

/** Alias of {@link HandlerFunction} used where a method is expected to be `\@Middleware()`. */
export declare type MiddlewareHandler = HandlerFunction;

/** Function stored inside `FwdRef(...)` — takes no arguments, called lazily on first use. */
export declare type FwdFunction = () => HandlerFunction | ClassType;

/**
 * Function stored inside `ThisRef(...)`/`RouteRef(...)` — called with the resolved class
 * (current cursor's class or the route's endpoint class) once that class is known.
 */
export declare type RefFunction = (constructor: ClassType) => any;

/** Union of the two possible functions a reference container can wrap. */
export declare type ContainerFunction = FwdFunction | RefFunction;
