import {
  FwdContainer,
  FwdFunction,
  RefFunction,
  RouteRefContainer,
  ThisRefContainer,
} from "../common";

/**
 * Wraps a function that resolves without any class context, evaluated lazily on first
 * use. Use it to break circular imports: reference `Self.Method` inside a factory
 * instead of importing the class directly, or pass a class/method to `\@Before`,
 * `\@After`, `\@Next`, `\@UseMarker`, `\@This` or `\@DelayRefStack` before it exists yet.
 *
 * @param fn - called with no arguments when the reference is realized
 * @returns a `FwdContainer` accepted wherever these decorators take a reference
 *
 * @example
 * ```ts
 * import { Controller, Middleware, Before, FwdRef } from "@aom-js/router";
 *
 * \@Controller()
 * \@Before(FwdRef(() => Guard.check)) // Guard may be declared further down the file
 * class App {}
 *
 * class Guard {
 *   \@Middleware()
 *   static async check() {}
 * }
 * ```
 */
export function FwdRef(fn: FwdFunction): FwdContainer {
  return new FwdContainer(fn);
}

/**
 * Wraps a function resolved against the class of the current cursor — the class that
 * declared the decorator using this reference, corrected for inheritance so a subclass
 * gets its own curried copy rather than the base class's. This is what builder base
 * classes use to read a static value a concrete subclass provides.
 *
 * @param fn - called with the resolved class; defaults to identity (returns the class itself)
 * @returns a `ThisRefContainer` accepted by `\@This`, `\@Before`/`\@After`, `\@UseMarker`,
 *   `\@Next`, `\@DelayRefStack`, and schema fields (`\@Responses`, `\@RequestBody`, ...)
 *
 * @example
 * ```ts
 * import { Controller, Middleware, DelayRefStack, QueryParameters, ThisRef } from "@aom-js/router";
 *
 * \@Controller()
 * class BuilderBase {
 *   static readonly marker: string;
 *
 *   \@Middleware()
 *   \@DelayRefStack(
 *     ThisRef(({ marker }: typeof BuilderBase) => [
 *       QueryParameters({ name: marker, schema: { type: "string" } }),
 *     ]),
 *   )
 *   static async Query() {}
 * }
 *
 * // a subclass that sets `marker` gets its own value substituted at cursor creation time
 * class ChildQuery extends BuilderBase {
 *   static readonly marker = "child-param";
 * }
 * ```
 */
export function ThisRef(fn?: RefFunction): ThisRefContainer {
  return new ThisRefContainer(fn);
}

/**
 * Wraps a function resolved against the class of the route's endpoint, not the class
 * that declared the decorator — makes a step endpoint-specific.
 *
 * - In **arguments** (`\@This(RouteRef(...))`, `\@Query(RouteRef(...))`, ...) it is
 *   resolved on every call, so a step shared by several routes gets its own route's class.
 * - In **`\@DelayRefStack`** it is allowed only on an endpoint method: the stack is realized
 *   once per meta-instance, and on a shared step the first route's result would silently
 *   apply to the others. Anywhere else building the `Router` throws `ROUTE_REF_DELAY_ERROR`.
 *
 * @param fn - called with the endpoint's class; defaults to identity
 * @returns a `RouteRefContainer` accepted by the same decorators as {@link ThisRef}
 *
 * @example
 * ```ts
 * import { Controller, Middleware, Before, Get, This, RouteRef } from "@aom-js/router";
 *
 * // shared step: the injected instance is the class of the endpoint the request hit
 * class Guard {
 *   \@Middleware()
 *   static async check(\@This(RouteRef()) endpoint: object) {}
 * }
 *
 * \@Controller()
 * \@Before(Guard.check)
 * class App {
 *   \@Get("/a")
 *   static async a() {}
 * }
 * ```
 */
export function RouteRef(fn?: RefFunction): RouteRefContainer {
  return new RouteRefContainer(fn);
}
