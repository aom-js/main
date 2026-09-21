import { CombinedDecorator, ExecutionPhase } from "@aom-js/core";
import { AomHolder } from "./init";

/**
 * Defers a set of property decorators instead of applying them on the class
 * where `@Hold(...)` is written. Declared as an `AomCore.propertyDecorator`
 * in the `LAST` phase, so `queue` is only pushed onto the field's holder
 * meta-instance — nothing runs here. On the base class where `@Hold` is the
 * only decorator, this queue is never applied: `apply()` is never called on
 * that class, so the decorators stay inert until a subclass runs `Apply`.
 *
 * Inheritance carries the queue forward automatically: when a subclass
 * pulls in the parent's metadata (via `Delay`'s `$._.inherit(parent)`), this
 * `LAST` call transfers to the subclass's own meta-instance for the same
 * field, and `Apply` later executes it there — so the decorators end up
 * applied to the subclass's field, not the base class's.
 *
 * @param queue - property decorators to apply later, on whichever class ends up calling `Apply`
 * @returns a `PropertyDecorator` to place on the field
 *
 * @example
 * ```ts
 * import { Hold, Apply } from "@aom-js/holder";
 *
 * const Spy: (label: string) => PropertyDecorator = (label) => (target, property) => {
 *   console.log(`${label}: ${(target as any).constructor.name}.${String(property)}`);
 * };
 *
 * class HeldBase {
 *   @Hold(Spy("a"))
 *   field!: string;
 * }
 *
 * @Apply()
 * class HeldChild extends HeldBase {}
 * // Spy runs exactly once, with target = HeldChild.field
 * ```
 */
// The holder's queue is heterogeneous by nature: Hold pushes property decorators
// into it, Delay/Apply push class decorators, and they get applied via Reflect.decorate
// with the right arity at each call site. This can't be expressed in the types (on
// CombinedDecorator propertyKey is optional, on PropertyDecorator it's required), so
// casts sit at the queue's boundary.
export function Hold(...queue: PropertyDecorator[]): PropertyDecorator {
  return AomHolder.propertyDecorator(($) => {
    $.queue.push(...(queue as unknown as CombinedDecorator[]));
    //
  }, ExecutionPhase.LAST);
}

// Guards against transferring the parent's queue into the same $.queue more than once:
// Apply itself calls Delay, so Delay can run more than once on the same target.
const queueInherited = new WeakSet<AomHolder>();

/**
 * Defers a set of class decorators, and pulls in the direct parent's
 * held/delayed metadata so it ends up applied on this class too. Declared
 * as an `AomCore.classDecorator` in the `INSTANT` phase (see
 * `ExecutionPhase.INSTANT`) — it runs right away, doing three things:
 *
 * 1. Pushes `queue` onto this class's own holder queue (`$.queue`).
 * 2. Transfers the direct parent's `$.queue` (its own not-yet-applied class
 *    decorators) onto this class's queue, in front of the class's own
 *    entries — but only once per meta-instance (`queueInherited` guards
 *    against `Apply` calling `Delay` a second time on the same target).
 *    `$.queue` is a plain field, not part of `AomCore`'s callstack, so
 *    `inherit()` below does not transfer it on its own; `Delay` has to do it
 *    by hand.
 * 3. Calls `$._.inherit(parent)` to pull in the parent's decorated
 *    properties (the `Hold` queues) and its callstack, then `$._.apply()` to
 *    run every deferred (`LAST`) call collected so far — this is what
 *    actually populates the `queue` of each transferred property's holder
 *    meta-instance.
 *
 * `Delay` never decorates the class itself with `queue`'s entries — only
 * `Apply` does that, via `Reflect.decorate($.queue, ...)`. A class marked
 * `@Delay(X())` with no `@Apply()` anywhere in its subclass chain never gets
 * `X()` applied.
 *
 * Only the *direct* parent is inherited from (`Object.getPrototypeOf($._.target)`),
 * so multi-level class-decorator inheritance requires every intermediate
 * class to also carry `@Delay` (or `@Apply`) — a plain class in the middle
 * of the chain breaks the transfer silently for the properties it doesn't
 * re-declare.
 *
 * @param queue - class decorators to apply later, on whichever class ends up calling `Apply`
 * @returns a `ClassDecorator` to place on the class
 *
 * @example
 * ```ts
 * import { Delay, Apply } from "@aom-js/holder";
 *
 * const ClassSpy: (label: string) => ClassDecorator = (label) => (target) => {
 *   console.log(`${label}: ${target.name}`);
 * };
 *
 * @Delay(ClassSpy("base"))
 * class DelayedBase {}
 *
 * @Apply()
 * class DelayedChild extends DelayedBase {}
 * // ClassSpy runs once, with target = DelayedChild
 * ```
 */
export function Delay(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    $.queue.push(...queue);

    const parent = Object.getPrototypeOf($._.target);
    if (!queueInherited.has($)) {
      queueInherited.add($);
      // $.queue is not part of AOM's callstack, so inherit() doesn't transfer it; transfer it ourselves
      $.queue.unshift(...(AomHolder.checkExists(parent)?.queue ?? []));
    }

    // transfer the parent's property decorators
    $._.inherit(parent);

    $._.apply(); // run the transferred decorators
  }, ExecutionPhase.INSTANT);
}

/**
 * Runs everything `Hold`/`Delay` deferred, on the class where `@Apply()` is
 * written. Declared as an `AomCore.classDecorator` in the `INSTANT` phase,
 * same as `Delay`. It does three things in order:
 *
 * 1. Calls `Delay(...queue)` on this class via `Reflect.decorate` (so
 *    `Apply` gets everything `Delay` does — parent metadata pulled in,
 *    `apply()` run — plus its own `queue` is applied at the end).
 * 2. Walks `$._.origins` (every decorated property this class owns, its own
 *    or transferred from a parent by `inherit()`) and applies each
 *    property's holder queue via `Reflect.decorate`, on the class itself for
 *    a static origin or on its prototype for an instance origin.
 * 3. Applies this class's own `$.queue` (its class decorators, including any
 *    pulled in from `Delay`d ancestors) to the class via `Reflect.decorate`.
 *
 * Because `inherit()`/`transferTo` don't clear the source when copying calls
 * to a subclass, re-applying `@Apply` on a further subclass of an
 * already-`@Apply`-processed class re-runs the same `Hold` queues again —
 * this combination isn't guarded against and isn't covered by tests.
 *
 * @param queue - class decorators to apply to this class, after everything transferred from ancestors
 * @returns a `ClassDecorator` to place on the class
 *
 * @example
 * ```ts
 * import { Hold, Apply } from "@aom-js/holder";
 *
 * const Spy: (label: string) => PropertyDecorator = (label) => (target, property) => {
 *   console.log(`${label}: ${String(property)}`);
 * };
 *
 * class HeldBase {
 *   @Hold(Spy("a"))
 *   field!: string;
 * }
 *
 * @Apply()
 * class HeldChild extends HeldBase {}
 * // Spy("a") is applied to HeldChild.field, not HeldBase.field
 * ```
 */
export function Apply(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    // run the standard delay procedure to transfer all properties
    // console.log("apply delayed decorators", $._.target);
    Reflect.decorate([Delay(...queue)], $._.target);
    // console.log("parent transfered", $._.target);

    // and run the decorators that were transferred
    $._.origins.forEach((origin) => {
      const $origin = origin.self; // $._.base.instance(origin.descriptor.value);
      const isClassOrigin = origin.target === $origin._.target;

      // apply the queued decorators to the properties that were created
      Reflect.decorate(
        origin.self.queue as unknown as PropertyDecorator[],
        isClassOrigin ? $._.target : $._.target.prototype,
        origin.property,
      );
    });
    // apply the class's own decorators from its queue
    Reflect.decorate($.queue, $._.target);
    //
  }, ExecutionPhase.INSTANT);
}
