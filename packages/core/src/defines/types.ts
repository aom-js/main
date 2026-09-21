/**
 * Constructor signature accepted anywhere `@aom-js/core` needs a class value
 * rather than an instance.
 *
 * @example
 * ```ts
 * import { ClassConstructor } from "@aom-js/core";
 *
 * function build<T>(ctor: ClassConstructor<T>): T {
 *   return new ctor();
 * }
 * ```
 */
export declare type ClassConstructor<T extends any = {}> = new (...args: any[]) => T;

/** A class constructor or a plain function — the two things legacy decorators can target. */
export declare type ClassType = ClassConstructor | Function;

/** Key used to address a class member: a method/field name, or a symbol. */
export declare type Property = string | symbol;

/**
 * Anything a legacy decorator can receive as its `target`: a class
 * constructor, a function, or the prototype/instance object TypeScript
 * passes to property, method and parameter decorators.
 */
export declare type InstanceTarget = ClassType | InstanceType<ClassConstructor>;

/**
 * Signature of a decorator built by {@link AomCore.combinedDecorator}, usable
 * both as a class decorator and as a method decorator. `propertyKey` and
 * `descriptor` are only defined when the decorator is applied to a method.
 *
 * @example
 * ```ts
 * import { AomCore, CombinedDecorator } from "@aom-js/core";
 *
 * class Meta extends AomCore {}
 *
 * const Both = (): CombinedDecorator =>
 *   Meta.combinedDecorator(($, descriptor) => {
 *     console.log(descriptor ? "method" : "class");
 *   });
 * ```
 */
export declare type CombinedDecorator = <T>(
  target: ClassType,
  propertyKey?: Property,
  descriptor?: TypedPropertyDescriptor<T>,
) => void;

/**
 * Determines when a lazy call queued by one of `AomCore`'s decorator
 * factories actually runs, and whether `inherit()` can transfer it to a
 * subclass.
 *
 * | Phase | Runs | Stored in | Transferred by `inherit()` |
 * |---|---|---|---|
 * | `INSTANT` | immediately, at decoration time | nowhere | no (see below) |
 * | `FIRST` | immediately, at decoration time | `fired` | yes — re-runs on the subclass |
 * | `LAST` | when the root node's `_.apply()` runs | `queue` → `fired` | yes — queued on the subclass |
 * | `DELAY` | in a `setTimeout` scheduled by `_.apply()` | `queue` → `fired` | yes — queued on the subclass |
 *
 * `INSTANT` calls are never stored anywhere, so `inherit()` has nothing to
 * replay on a subclass. This is deliberate, not an oversight: aggregator
 * decorators such as `@Controller()` or `@ComponentSchema()` call
 * `$._.inherit()`/`$._.apply()` themselves and are declared with `INSTANT`
 * precisely so that transferring them to a subclass doesn't re-trigger the
 * aggregator and recurse.
 *
 * @example
 * ```ts
 * import { AomCore, ExecutionPhase } from "@aom-js/core";
 *
 * class Meta extends AomCore {}
 *
 * const RunLast = () =>
 *   Meta.classDecorator(($) => console.log("ran"), ExecutionPhase.LAST);
 *
 * @RunLast()
 * class Service {}
 *
 * Meta.instance(Service)._.apply(); // "ran" is printed only now
 * ```
 */
export enum ExecutionPhase {
  INSTANT = "instant",
  FIRST = "first",
  LAST = "last",
  DELAY = "delay",
  // TRIGGER = "trigger",
}

/**
 * Placement of a decorator call when `inherit()` transfers it from a parent
 * class to a subclass.
 *
 * @example
 * ```ts
 * import { AomCore, ExecutionPhase, InheritPlacement } from "@aom-js/core";
 *
 * class Meta extends AomCore {}
 *
 * const Before = () =>
 *   Meta.classDecorator(
 *     ($) => console.log("parent middleware"),
 *     ExecutionPhase.LAST,
 *     InheritPlacement.PREPEND,
 *   );
 *
 * @Before()
 * class Base {}
 * class Controller extends Base {}
 *
 * Meta.instance(Controller)._.inherit(Base);
 * Meta.instance(Controller)._.apply(); // parent's LAST call runs before Controller's own
 * ```
 */
export enum InheritPlacement {
  /** Append to the end of the subclass queue, after its own calls (default behaviour). */
  APPEND = "append",
  /**
   * Insert as a single block at the start of the subclass queue — the parent's
   * calls run before the subclass's own calls, and their relative order among
   * themselves is preserved. Only meaningful for the deferred phases
   * (`LAST`/`DELAY`): `FIRST`/`INSTANT` already run at the moment of transfer,
   * so placement has no further effect on them.
   */
  PREPEND = "prepend",
  /** Do not transfer this call to subclasses at all. */
  SKIP = "skip",
}
