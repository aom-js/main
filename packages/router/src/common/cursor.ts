import type { ClassConstructor } from "@aom-js/core";

import * as constants from "../constants";
import { FwdContainer, RouteRefContainer, ThisRefContainer } from "./references";
import { AomApi, type AomEndpoint } from "./api";

/**
 * One step of a route's execution chain: a middleware, an endpoint, a nextpoint, or an
 * `@OnInstance` hook, bound to the class (`$`) that owns it. `Router.build` and
 * `AomRoute`'s constructor create cursors while assembling a route; `RxContext.run`
 * executes them one by one.
 *
 * Creating a cursor has a side effect: it re-binds `$` to the correct subclass
 * (`AomApi.resolveFor`, needed when a decorator captured a parent class's static
 * reference before `@Controller()` ran on the child) and realizes the method's
 * `delayStack` — see `realizeDelay`.
 */
export class AomCursor {
  // the endpoint being applied
  /** Endpoint of the route this cursor belongs to; `undefined` for class-level middleware cursors collected by `Router.build` before `AomRoute` assigns one (see `realizeDelay` and `ROUTE_REF_DELAY_ERROR`). */
  endpoint?: AomEndpoint;

  // place where the cursor is attached
  /** The `AomApi` this cursor was attached from (the class that declared `@Before`/`@Bridge`/etc.), used to resolve `Self.Method`-style references against the right subclass. */
  origin: AomApi;

  // path prefix
  /** Path prefix in effect at the point this cursor was collected. */
  prefix: string;

  // sequence number
  /** Position of this cursor within `AomRoute.cursors`, assigned after the route is fully laid out. */
  index!: number;

  // the cursor's own api instance
  /** Meta-instance of the method (or class) this cursor executes — already re-bound to the correct subclass. */
  $: AomApi;

  // ownership chain: classes whose creation this execution branch is holding. Lives on the
  // cursor, not on the context: the context is one per request, while several branches run
  // concurrently (Promise.all over hooks, over arguments), and a shared list would mix them up
  /**
   * Ownership chain: classes whose creation this execution branch is currently holding.
   * Lives on the cursor rather than on `RxContext` because several branches run
   * concurrently within one request (`Promise.all` over hooks, over constructor
   * arguments) and a single shared list would mix them up. Read by
   * `AomApi.instanceWithHooks` to tell "my own creation" from "someone else's" and to
   * build the class-name chain in `CIRCULAR_INSTANCE_ERROR`.
   */
  creating: ClassConstructor[] = [];

  constructor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint) {
    // if $ refers to the parent class's static side relative to the attachment point —
    // rebind to the descendant's instance before realizing the delay stack, otherwise
    // ThisRef gets a class without inherited values (e.g. without a builder's schema)
    this.$ = AomApi.resolveFor($, origin._.target);
    this.origin = origin;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.index = 0;

    this.realizeDelay();
  }

  /**
   * Runs the method's `@DelayRefStack` handlers once, applying the decorators they
   * return via `Reflect.decorate` in the context of the correct subclass. Guarded by
   * `$.delayRealized` so a meta-instance shared by several cursors (class-level
   * middleware reused across routes) only realizes its stack the first time.
   *
   * @throws {Error} `ROUTE_REF_DELAY_ERROR` when the stack contains a `RouteRef` but
   *   this cursor has no `endpoint` yet (class-level middleware collected by
   *   `Router.build`, before `AomRoute` gives it one) — a controlled error instead of
   *   a raw `TypeError` from dereferencing `undefined`.
   *
   * If a handler throws, `delayRealized` is left `false` and the stack is not
   * consumed: the same binding problem reproduces on every subsequent attempt to
   * build a cursor from this meta-instance, instead of silently degrading.
   */
  private realizeDelay() {
    const { $ } = this;

    const { target, property } = $._;
    // the delay stack is realized on the instance exactly once; on error the flag isn't set
    // and the stack isn't consumed — the binding problem reproduces on every subsequent
    // build instead of silently going away
    if (!$.delayRealized && $.delayStack.length) {
      for (const handler of $.delayStack) {
        // run the delayed actions
        if (handler instanceof FwdContainer) {
          Reflect.decorate([...handler.exec()], target, property!);
        } else if (handler instanceof ThisRefContainer) {
          Reflect.decorate([...handler.exec(target)], target, property!);
        } else if (handler instanceof RouteRefContainer) {
          // RouteRef is realized from the route's endpoint; class-level middleware cursors
          // from Router.build have no endpoint yet — this is a definition error, not a TypeError
          if (!this.endpoint) throw new Error(constants.ROUTE_REF_DELAY_ERROR);
          Reflect.decorate([...handler.exec(this.endpoint.$._.target)], target, property!);
        }
      }
      $.delayRealized = true;
      // apply any pending delayed calls
      $._.apply();
    }
  }
}
