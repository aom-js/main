import { ClassConstructor, ClassType } from "./types";

/**
 * Typed wrapper around a `WeakMap<constructor, instance>`. Unlike a plain
 * `WeakMap<ClassType, object>`, `get()`/`set()` tie the value type to the
 * constructor passed as the key, so callers don't have to cast.
 *
 * Not used inside `@aom-js/core` itself — it exists for consumers that need
 * a "constructor → instance" cache keyed by class identity, such as
 * `@aom-js/router`'s per-request context storage.
 *
 * @example
 * ```ts
 * import { ClassInstanceMap } from "@aom-js/core";
 *
 * class Service {
 *   x = 1;
 * }
 *
 * const map = new ClassInstanceMap();
 * map.set(Service, new Service());
 * map.get(Service)!.x; // 1, typed as Service | undefined
 * ```
 */
// Wrapper class definition
export class ClassInstanceMap {
  // Internal WeakMap storing constructors and their instances
  private map = new WeakMap<ClassType, object>();

  /** Stores `value` under the constructor `key`. Returns `this` for chaining. */
  // Typed set method
  // It guarantees that the passed value is an instance of the key class
  set<T extends object>(key: ClassConstructor<T>, value: T): this {
    this.map.set(key, value);
    return this;
  }

  /** Returns the value stored for `key`, or `undefined` if there is none. */
  // Typed get method
  // It returns the value with the correct instance type, or undefined
  get<T extends object>(key: ClassConstructor<T>): T | undefined {
    // Type assertion (as) is needed because TypeScript cannot
    // automatically infer the exact type from the internal WeakMap<..., object>
    return this.map.get(key) as T | undefined;
  }

  /** Returns whether a value is stored for `key`. */
  // The has method stays unchanged
  has<T extends object>(key: ClassConstructor<T>): boolean {
    return this.map.has(key);
  }

  /** Removes the value stored for `key`. Returns whether anything was removed. */
  // The delete method stays unchanged
  delete<T extends object>(key: ClassConstructor<T>): boolean {
    return this.map.delete(key);
  }
}
