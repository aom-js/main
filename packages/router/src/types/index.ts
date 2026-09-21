import { HandlerFunction } from "../common/types";
import { Lazy } from "../common/lazy";

/** Type of the function `\@Run()` injects — runs extra cursors and returns whatever the chain resolves to. */
export declare type RunFunction = (...middlewares: HandlerFunction[]) => Promise<any>;

/**
 * Contract for `AomRoute.apply(values)` — everything an HTTP (or other transport)
 * adapter must supply for one request. This is the boundary between the router and
 * whatever server framework calls it (`@aom-js/api`'s `Server`, or a custom adapter).
 *
 * `query`, `params`, `cookies`, `headers`, `session` accept either the parsed value
 * directly, or a {@link LazyValue} produced by `lazy(...)` for fields expensive enough
 * that the adapter would rather defer computing them until a decorator actually reads
 * them (see `RxContext.value`). `body` and `files` stay typed `any` but follow the
 * same contract — an adapter may put `lazy(() => parseBody())` there too.
 *
 * @example
 * ```ts
 * import { HttpContextValues, lazy } from "@aom-js/router";
 *
 * const values: HttpContextValues = {
 *   ctx, req, res,
 *   body: lazy(() => parseBody(req)), // parsed only if a decorator reads it
 *   files: {},
 *   query: { page: "1" }, // already parsed — plain value works too
 *   params: {}, cookies: {}, headers: {}, session: {},
 * };
 * ```
 */
export declare interface HttpContextValues {
  ctx: any;
  req: any;
  res: any;
  // body and files are already any: the adapter puts either a ready value or lazy(...) here
  body: any;
  files: any;
  query: Lazy<Record<string, string | string[]>>;
  params: Lazy<Record<string, string>>;
  cookies: Lazy<Record<string, string>>;
  headers: Lazy<Record<string, string | string[]>>;
  session: Lazy<Record<string, any>>;
}
