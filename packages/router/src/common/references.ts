import { ClassType } from "@aom-js/core";
import { ContainerFunction, FwdFunction, RefFunction } from "./types";

/**
 * Base class for deferred reference containers. Holds a function and calls it with
 * `constructor` bound both as `this` and as the argument, so a stored function like
 * `({marker}: typeof Base) => ...` can read static fields of whichever class it is
 * resolved against.
 *
 * Not part of the package's public API — construct instances through the factories in
 * `specials/references.ts` (`FwdRef`, `ThisRef`, `RouteRef`), not directly.
 */
export class RefContainer {
  protected fn: ContainerFunction;
  constructor(fn: RefFunction = RefContainer.default) {
    this.fn = fn;
  }

  exec(constructor: ClassType) {
    return Reflect.apply(this.fn, constructor, [constructor]);
  }

  static default: RefFunction = (constructor: ClassType) => constructor;
}

/**
 * Reference resolved with no context — the wrapped function takes no argument. Used where
 * the target isn't defined yet at declaration time: a class further down the file or
 * across a circular import (`FwdRef(() => SomeClass.method)`). Accepted by
 * `\@Before`/`\@After`/`\@Next`/`\@UseMarker` (resolved when the links are first read,
 * normally at `Router` build), `\@This` and other argument decorators (on every call) and
 * `\@DelayRefStack` (when the first cursor is created) — see `FwdRef`.
 *
 * Not exported from the package — obtain an instance through `FwdRef(...)`.
 */
export class FwdContainer extends RefContainer {
  constructor(fn: FwdFunction = FwdContainer.default) {
    super(fn);
    this.fn = fn;
  }

  exec() {
    return Reflect.apply(this.fn, undefined, []);
  }

  static default: FwdFunction = () => new Function();
}

/**
 * Reference resolved against the class of the current cursor (the class that declared
 * the decorator using it, corrected for inheritance via `AomApi.resolveFor`). Used by
 * builder base classes to read a static field a concrete subclass sets.
 *
 * Not exported from the package — obtain an instance through `ThisRef(...)`.
 */
export class ThisRefContainer extends RefContainer {}

/**
 * Reference resolved against the class of the route's endpoint, not the class that
 * declared the decorator. Lets a class-level middleware, shared by several routes,
 * produce a value specific to whichever endpoint the request actually hit.
 *
 * Not exported from the package — obtain an instance through `RouteRef(...)`.
 */
export class RouteRefContainer extends RefContainer {}
