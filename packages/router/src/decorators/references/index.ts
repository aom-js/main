import { AomApi, FwdContainer, RouteRefContainer, ThisRefContainer } from "../../common";

/**
 * Defers applying a list of decorators until a cursor is built from this method —
 * that is, in the context of whichever concrete subclass the cursor actually belongs
 * to. `handler`'s function must return an array of decorators; they're applied via
 * `Reflect.decorate` exactly once per meta-instance (`AomCursor.realizeDelay`).
 *
 * This is what builder base classes use: a base class declares the delayed stack
 * once, and each concrete subclass gets its own decorators applied with its own
 * static values substituted in, without repeating the decorator call in every
 * subclass.
 *
 * @param handler - `FwdRef`, `ThisRef`, or `RouteRef` wrapping a function that returns
 *   an array of decorators
 * @returns a method decorator
 * @throws {Error} `ROUTE_REF_DELAY_ERROR` at cursor-creation time if `handler` is a
 *   `RouteRef` and the cursor has no endpoint yet (class-level middleware collected by
 *   `Router.build`, before `AomRoute` assigns one)
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
 * class ChildQuery extends BuilderBase {
 *   static readonly marker = "child-param"; // substituted in when ChildQuery's cursor is built
 * }
 * ```
 */
export function DelayRefStack(
  handler: FwdContainer | ThisRefContainer | RouteRefContainer,
): MethodDecorator {
  return AomApi.methodDecorator(($) => {
    $.delayStack.push(handler);
  });
}
