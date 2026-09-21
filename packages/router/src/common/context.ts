import { ClassInstanceMap } from "@aom-js/core";
import type { ClassConstructor } from "@aom-js/core";
import { from, throwError } from "rxjs";
import { concatMap, catchError, takeWhile } from "rxjs/operators";

import * as constants from "../constants";
import type { HttpContextValues } from "../types";
import { LazyValue } from "./lazy";
import { AomApi } from "./api";
import type { AomCursor } from "./cursor";
import type { AomRoute } from "./route";

// class names in the message are mandatory: without the chain, a cycle error explains nothing
/**
 * Builds the `Error` thrown for a `CIRCULAR_INSTANCE_ERROR`. `chain` is the ownership
 * path that closed the loop (see `AomCursor.creating` and `RxContext.waits`); the
 * message lists class names joined by `->` so the cycle is readable without a debugger.
 */
export function circularInstanceError(chain: ClassConstructor[]) {
  return new Error(
    `${constants.CIRCULAR_INSTANCE_ERROR}: ${chain.map(({ name }) => name).join(" -> ")}`,
  );
}

/**
 * Per-request execution context: request values, the map of validated instances, and
 * the bookkeeping that makes `@This`/`@State`/`lazy(...)` safe under concurrency. One
 * `RxContext` is created per `AomRoute.apply()` call and discarded at the end of the
 * request — nothing here is shared across requests.
 *
 * Not exported from the package; application code reaches it only through
 * `ArgumentsHandlerParameters.context` inside an `Args(...)` handler (`@Cursor()`,
 * `@Run()`, custom argument decorators).
 */
export class RxContext {
  /** Request values passed to `AomRoute.apply()`; read `value(key)` instead of this directly to resolve `lazy(...)` fields. */
  values: HttpContextValues;

  /** Instances that finished all their `@OnInstance` hooks — the only ones `@This`/`@State` from other classes/branches can see. */
  state: ClassInstanceMap;

  // creations currently in flight or rejected (a rejection is remembered until the end of
  // the request, see AomApi.instanceWithHooks); only hook-validated ones end up in state
  /** Creations currently in flight or rejected, keyed by class. A rejection stays here for the rest of the request — see `AomApi.instanceWithHooks`. */
  pending = new Map<ClassConstructor, Promise<any>>();

  // instances that are constructed but not yet validated by hooks: visible only to the
  // branch that is creating them (its own code), removed as soon as their hooks finish
  /** Constructed-but-unvalidated instances, visible only to the branch creating each one — removed as soon as its hooks finish (success or failure). */
  inflight = new Map<ClassConstructor, any>();

  // who is waiting on whom: the edge lives as long as a branch is waiting on someone else's
  // creation. Needed so that two branches waiting on each other become a clear error instead
  // of the request silently hanging. One edge per waiter is enough in the common case: a
  // branch's own cursors run one at a time (concatMap in run()), so it normally waits on a
  // single target at a time. Known limitation: if the same branch ends up waiting on two
  // different pending creations concurrently (e.g. two @This(...) constructor arguments
  // resolved together via Promise.all, both already pending elsewhere), only the most recent
  // edge is kept — a cycle that closes through the overwritten earlier edge could in theory
  // hang instead of throwing CIRCULAR_INSTANCE_ERROR. Not reproduced by the package's tests.
  /** `waiter → target` edges: which class-creating branch is waiting on which other creation, used to turn mutual waiting into `CIRCULAR_INSTANCE_ERROR` instead of a hang. */
  waits = new Map<ClassConstructor, ClassConstructor>();

  // started computations of lazy context values (see common/lazy.ts): the rejection or the
  // result is remembered until the end of the request — a second access to the same field
  // (concurrent or not) gets the same promise instead of re-running the factory (for the
  // request body this is effectively a second pass over the stream)
  private resolved = new Map<keyof HttpContextValues, Promise<any>>();

  route: AomRoute;
  //
  constructor(context: HttpContextValues, route: AomRoute) {
    this.values = context;

    this.route = route;

    this.state = new ClassInstanceMap();
  }

  // waiting on someone else's creation: before joining the queue, check whether target
  // (directly or through a chain) is itself waiting on the waiter's creation — otherwise
  // both branches would hang forever
  /**
   * Joins an in-progress creation of `target` instead of starting a second one.
   * Before waiting, walks the `waits` chain starting from `target` to check whether it
   * (directly or transitively) is already waiting on `waiter` — if so, waiting now
   * would deadlock both branches, so this throws `CIRCULAR_INSTANCE_ERROR` instead.
   * Otherwise records the `waiter → target` edge and removes it once `creation`
   * settles, either way.
   *
   * @param target - class whose creation is being waited on
   * @param creation - the in-progress promise from `context.pending`
   * @param waiter - class the calling branch is itself creating, if any; branches that
   *   aren't creating anything (`waiter` undefined) have nothing to deadlock, so they
   *   just await `creation`
   * @returns the same `creation` promise, so callers can `await` the result directly
   * @throws {Error} `CIRCULAR_INSTANCE_ERROR` when waiting would close a cycle
   */
  waitCreation(target: ClassConstructor, creation: Promise<any>, waiter?: ClassConstructor): any {
    // the branch isn't creating anything — there's nothing to close a cycle with, no edge needed
    if (!waiter) return creation;

    const chain: ClassConstructor[] = [waiter];
    for (let next = target; next; next = this.waits.get(next)!) {
      chain.push(next);
      if (next === waiter) throw circularInstanceError(chain);
    }

    this.waits.set(waiter, target);
    const release = () => {
      if (this.waits.get(waiter) === target) this.waits.delete(waiter);
    };
    // the creation error goes to whoever awaits creation; here we only remove the edge in
    // both cases and keep the rejection from becoming unhandled
    creation.then(release, release);

    return creation;
  }

  // resolving a lazy context field: a ready value is returned as-is (today's behavior is
  // unchanged), a lazy one runs its factory no earlier than the first access and only once
  // per request
  /**
   * Resolves one field of `values` (`context.values`), transparently unwrapping a
   * `lazy(...)` field on first use. This is what `@Body`, `@Query`, `@Params`,
   * `@Cookies`, `@Headers`, `@Session`, `@Files` call instead of reading `values[key]`
   * directly — so the "compute at most once, share the same result/rejection with
   * every reader" rule applies uniformly to every context field.
   *
   * @param key - field of `HttpContextValues` to resolve
   * @returns the plain value as-is if it isn't a `LazyValue`; otherwise a promise that
   *   resolves (or rejects) with the factory's result, shared by every caller for this
   *   request regardless of how many times `value(key)` is called
   */
  value<K extends keyof HttpContextValues>(key: K): any {
    // any: with a generic K, the indexed type HttpContextValues[K] is a union, not an object
    // type, and TS won't let instanceof be applied to it
    const source: any = this.values[key];
    if (!(source instanceof LazyValue)) return source;

    const cached = this.resolved.get(key);
    if (cached) return cached;

    // Promise.resolve().then(...) routes both the factory's synchronous throw and its own
    // rejection into the same path: callers of value() don't need to tell the two apart
    const promise = Promise.resolve().then(() => source.factory());
    // the promise must be stored into resolved synchronously, before any await — otherwise
    // two concurrent accesses to the same field (e.g. two @Body reads inside one Promise.all)
    // wouldn't see each other's entry and both would run the factory; value() has no await
    // before this point, so synchronous execution order guarantees it
    this.resolved.set(key, promise);
    // the rejection goes to whoever calls value(); here we only keep it from becoming
    // unhandled — the same trick as with pending above
    promise.catch(() => undefined);
    return promise;
  }

  /**
   * Runs `cursors` strictly one after another (`concatMap` — no cursor starts before
   * the previous one settles). For each cursor: ensures its owner class has a
   * validated instance (`AomApi.instanceWithHooks`, called unconditionally even if the
   * method never uses `@This`), resolves its parameters concurrently
   * (`Promise.all`), then invokes the method with `this` bound to the class itself
   * (every handler is static).
   *
   * The chain stops at the first cursor whose result is not `undefined` — that value
   * becomes the resolved result. If every cursor returns `undefined`, the promise
   * resolves to `undefined`. A thrown error, or a returned `Error` instance, rejects
   * the promise instead of resolving it.
   *
   * This is also what `@Run()`'s returned function calls to execute extra cursors
   * built from arbitrary handlers, inside the same context.
   *
   * @param cursors - cursors to execute, in order
   * @returns a promise for the first non-`undefined` cursor result, or `undefined`
   * @throws {Error} whatever a cursor threw or returned as an `Error`
   */
  run(cursors: AomCursor[]): any {
    const { route } = this;
    return new Promise((resolve, reject) => {
      from(cursors)
        .pipe(
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              // get an instance of its class at the level of every cursor (works even with a
              // decorated constructor): the "ready / own branch / someone else's creation /
              // create" rule lives entirely in instanceWithHooks, we don't duplicate it here
              const { target } = $._;
              await AomApi.instanceWithHooks(target, { context: this, cursor, route });
              const args = await Promise.all(
                $.element.parameters.apply({ context: this, cursor, route }),
              );

              const result = await Reflect.apply(
                $.element.descriptor?.value || new Function(),
                target,
                args,
              );

              // if the result is an Error, throw it
              if (result instanceof Error) {
                throw result;
              }

              return result;
            } catch (error) {
              throw error;
            }
          }),
          takeWhile((result) => result === undefined, true),
          catchError((error) => throwError(() => error)),
        )
        .subscribe({
          next: (result) => {
            // if the result is not undefined, stop execution and return the result
            if (result !== undefined) {
              resolve(result);
            }
          },
          error: (error) => reject(error),
          complete: () => resolve(undefined),
        });
    });
    //
  }
}
