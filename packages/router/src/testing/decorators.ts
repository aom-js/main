import { ExecutionPhase } from "@aom-js/core";
import type { ClassConstructor } from "@aom-js/core";

import { AomApi } from "../common/api";
import type { HandlerFunction } from "../common/types";
import { Args } from "../decorators/arguments";
import type { HttpContextValues } from "../types";
import { TesterReport } from "./report";

/**
 * How the route run must end for a probe's assertions to mean anything: `"ok"` — no error, a
 * number — an error with that `status` (the error responses of `@aom-js/api` carry one), `"any"` —
 * not checked.
 */
export type RouteOutcome = "ok" | number | "any";

/** Title, input and expected route outcome of every method marked `\@Probe`. Read by the runner. */
export const probeMeta = new WeakMap<
  HandlerFunction,
  { title: string; input?: Partial<HttpContextValues>; route: RouteOutcome }
>();

/**
 * Class aggregator of the component: runs the deferred decorators of its members.
 *
 * `\@Controller()` does the same for production classes, but the controller role is useless and
 * harmful here — probe classes take no part in the route tree. Only `$._.apply()`: without it
 * parameter handlers placed by `Args` in the `LAST` phase are never registered, and the method
 * runs with `undefined` arguments.
 *
 * The `INSTANT` phase is mandatory: a decorator that runs deferred calls itself cannot be
 * deferred.
 */
const aggregate = (handler: (target: object) => void = () => {}): ClassDecorator =>
  AomApi.classDecorator(($) => {
    handler($._.target);
    $._.apply();
  }, ExecutionPhase.INSTANT);

/**
 * Makes a static method executable by `RxContext.run`, which fails closed on a cursor without
 * `element.descriptor` (`CURSOR_NOT_EXECUTABLE_ERROR`). Only method decorators can set the
 * descriptor — parameter decorators have none in their signature.
 */
function runnable(store?: (fn: HandlerFunction) => void): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    $.element.descriptor = descriptor;
    store?.(descriptor.value as HandlerFunction);
  });
}

/**
 * Declares a method a probe. The second argument is the input under which the assertion must
 * hold: partial request values on top of the run's base values. Probes with different inputs
 * run in separate runs of the route. The third declares how the route must end (`"ok"` by
 * default); any other outcome is a violation of the probe.
 */
export function Probe(
  title: string,
  input?: Partial<HttpContextValues>,
  expect: { route?: RouteOutcome } = {},
): MethodDecorator {
  return runnable((fn) => probeMeta.set(fn, { title, input, route: expect.route ?? "ok" }));
}

/**
 * Reads an instance from the request state. Unlike `\@This`, it **does not create** one: absence
 * is a meaningful verdict "the step did not run", not a silent skip.
 */
export function Observe<T extends object>(target: ClassConstructor<T>) {
  return Args(({ context }) => {
    const found = context.state.get(target);
    if (!found) {
      throw new Error(`@Observe(${target.name}): no instance in the request state — the step did not run`);
    }
    return found;
  });
}

/** The verdict collector of the current run. */
export const Report = () => Observe(TesterReport);

/**
 * Probe class → the endpoint it is bound to. The method reference itself is kept, not its name:
 * the runner finds the route by the identity of the `AomApi` object.
 */
const testers = new WeakMap<object, HandlerFunction>();

/** The endpoint a probe class is bound to by `\@Tester`, if it is one. */
export const endpointOf = (tester: object) => testers.get(tester);

/** Whether `cls` is a probe class (`\@Tester`). The registry itself stays inside the package. */
export const isTester = (cls: object): boolean => testers.has(cls);

/**
 * Binds a probe class to an endpoint: `\@Tester(OrgRoles.Index)`. An endpoint identifies one
 * route of a router, so the runner finds the route itself — together with its address.
 *
 * A reference, not a string: a string would not survive a rename. A side benefit — the import
 * goes from the probe to the production class and never back.
 *
 * This is a class aggregator, a sibling of `\@Controller()` rather than its consumer: it runs the
 * deferred decorators itself and does not declare the class a controller.
 */
export function Tester(endpoint: HandlerFunction): ClassDecorator {
  return aggregate((cls) => testers.set(cls, endpoint));
}
