// Lazy value for the request context: the factory is called no earlier than the first
// access to it (see RxContext.value in classes.ts). The request body is the first
// consumer of this (the server must not read the body of an unauthorized
// request before access checks run); query, cookies and files are meant to become lazy
// the same way later — adapters for third-party HTTP frameworks just put lazy(...) into
// the matching field of HttpContextValues instead of a ready value.
/**
 * Wrapper that defers reading an expensive `HttpContextValues` field (typically `body`)
 * until something actually asks for it.
 *
 * Do not construct this directly — use {@link lazy}. The constructor is public only
 * because `HttpContextValues` fields need a concrete type to type-check against.
 * `RxContext.value(key)` recognizes an instance of this class and calls `factory()`
 * at most once per request, caching both the resolved value and the rejection.
 */
export class LazyValue<T = any> {
  constructor(readonly factory: () => T | Promise<T>) {}
}

/**
 * Wraps a factory so a `HttpContextValues` field is computed on first access instead
 * of eagerly, on every request. Use this in an HTTP adapter when a field is expensive
 * to produce (parsing a request body stream, decoding cookies) and the route might
 * reject the request before ever reading it — for example, an access check that runs
 * before `\@Body()` in the cursor chain.
 *
 * The factory runs once per request no matter how many `\@Body`/`\@Query`/... parameters
 * or middlewares read the same field; concurrent reads share one promise. A field that
 * doesn't need this stays a plain value — `Lazy<T>` accepts both.
 *
 * @param factory - produces the value (or a promise of it); may throw or reject, either
 *   way every reader of the field gets the same rejection
 * @returns a `LazyValue<T>` to assign to a field of `HttpContextValues`
 *
 * @example
 * ```ts
 * import { lazy, HttpContextValues } from "@aom-js/router";
 *
 * // adapter code: body parsing is deferred until a decorator actually reads it
 * const values: HttpContextValues = {
 *   ctx, req, res,
 *   body: lazy(() => parseRequestBody(req)), // not read at all if access check rejects first
 *   files: {},
 *   query: {}, params: {}, cookies: {}, headers: {}, session: {},
 * };
 * ```
 */
export function lazy<T>(factory: () => T | Promise<T>): LazyValue<T> {
  return new LazyValue(factory);
}

/**
 * Type of a `HttpContextValues` field: either the value itself (an adapter that already
 * parsed everything) or a {@link LazyValue} produced by {@link lazy} (an adapter that
 * wants parsing deferred to first use).
 */
export type Lazy<T> = T | LazyValue<T>;
