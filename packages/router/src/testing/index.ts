/**
 * `@aom-js/router/testing` — route probes: checking what exists only while a request runs.
 *
 * A probe is a static method that runs in the request context but OUTSIDE its route. The router
 * resolves its arguments and creates instances by the same mechanism as for route steps, so a
 * probe sees everything the request accumulated. A probe is not a route step: it is never in
 * `route.cursors` and does not affect how routes are built. See the package readme, "Зонды".
 */
import "reflect-metadata";

export { Observe, Probe, Report, Tester, isTester, type RouteMatch, type RouteOutcome } from "./decorators";
export { TesterReport, type CheckResult } from "./report";
export { routesOf, runAcross, runProbes, runSteps, type AcrossOptions, type RunOptions } from "./runner";
export type { CreatedRecord } from "../common/context";
export {
  accessIdents,
  constructorThisRefs,
  identCollisions,
  parentsOf,
  repeatsOf,
  type Repeat,
  type RepeatBranch,
  type RepeatOptions,
  routeName,
  serializationErrors,
  sharedEndpoints,
} from "./chain";
