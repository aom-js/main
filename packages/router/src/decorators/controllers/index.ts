import { ClassType, ExecutionPhase } from "@aom-js/core";
import { AomApi } from "../../common";

/**
 * Marks a class as a router controller. This must be the topmost decorator on every
 * class that uses router decorators — it runs last among the class's own decorators,
 * which is what lets it collect everything they registered.
 *
 * Two things happen, in order:
 *
 * 1. **Inherit.** Walks up the prototype chain and merges the parent's decorator
 *    queues into this class — but only as far as parents that are *not* themselves
 *    `\@Controller()`, since a `\@Controller()` parent already did its own transfer for
 *    everything above it. This is why every class in a router-decorated hierarchy must
 *    carry its own `\@Controller()`: skip it on a subclass and it inherits neither the
 *    parent's FIRST/LAST decorator queue nor its `\@OnInstance` hooks (see the readme's
 *    `KI-ROUTER-05`/`KI-ROUTER-18`).
 * 2. **Apply.** Runs the class's own deferred (`LAST`-phase) decorators — `\@Before`,
 *    `\@After`, `\@Next`, `\@UseMarker`, and parameter decorators (`\@Args` and everything
 *    built on it) only take effect at this point, not when they're written in source.
 *
 * @throws nothing itself, but decorators it flushes (`\@Before`/`\@After`/`\@Next`/
 *   `\@UseMarker`) may throw their own `*_DEFINE_ERROR` if misused
 *
 * @example
 * ```ts
 * import { Controller, Get, Before, Bridge } from "@aom-js/router";
 *
 * \@Controller() // topmost — runs after Bridge, Get, Before below it
 * \@Bridge("/api", ApiRoutes)
 * class Index {
 *   \@Get("/health")
 *   static async health() {
 *     return "ok";
 *   }
 * }
 *
 * // a subclass participating in routing needs its own \@Controller() too
 * \@Controller()
 * class Extended extends Index {
 *   \@Get("/extra")
 *   static async extra() {}
 * }
 * ```
 */
export function Controller() {
  return AomApi.classDecorator(($) => {
    $.element.isController = true;

    const errors: Error[] = [];
    // inherit decorators
    const inheritDecorators = (parent: ClassType) => {
      // during the transfer, the parent's decorators must end up running first, not last
      const $parent = $._.inherit(parent);

      // repeat the walk if the current element wasn't itself a controller but its parent's parent is one
      if (
        !$parent.element.isController &&
        $._.base.instance(Object.getPrototypeOf(parent)).element.isController
      ) {
        inheritDecorators(Object.getPrototypeOf(parent));
      }
    };
    inheritDecorators(Object.getPrototypeOf($._.target));
    $._.apply(); // run the class's own deferred decorators
  }, ExecutionPhase.INSTANT);
  // don't keep this decorator itself, to avoid recursion during the transfer
}
