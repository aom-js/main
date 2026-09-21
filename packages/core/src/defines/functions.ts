import { InstanceTarget } from "./types";

/**
 * Checks whether `value` was declared with `class` syntax, as opposed to a
 * plain function or arrow function. Used internally by `AomCore` to decide
 * whether a decorated `target` can own static/instance properties in the
 * registry, or should just be used as-is as the registry key.
 *
 * Detection is done by pattern-matching `Function.prototype.toString()`
 * output (`/^class[\s{]/`), not `instanceof` or a prototype check, since any
 * function can be used as a legacy decorator target.
 *
 * @example
 * ```ts
 * import { isClass } from "@aom-js/core";
 *
 * class Foo {}
 * function bar() {}
 *
 * isClass(Foo); // true
 * isClass(bar); // false
 * ```
 */
export function isClass(value: InstanceTarget) {
  return (
    typeof value === "function" && /^class[\s\{]/.test(Function.prototype.toString.call(value))
  );
}
