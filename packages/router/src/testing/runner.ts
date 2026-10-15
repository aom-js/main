import type { ClassConstructor } from "@aom-js/core";

import type { Router } from "../classes";
import { AomApi } from "../common/api";
import { RxContext } from "../common/context";
import { AomCursor } from "../common/cursor";
import { compilePath, PATH_PARAM } from "../common/path";
import { plain, type AomRoute } from "../common/route";
import type { HandlerFunction } from "../common/types";
import type { HttpContextValues } from "../types";
import { endpointOf, probeMeta } from "./decorators";
import { TesterReport } from "./report";

export type RunOptions = {
  /** Request values for every probe of the class; the input of a single `@Probe` goes on top. */
  values?: Partial<HttpContextValues>;
  /**
   * Which steps of the route to run — as `Class.method` references. Each one is unfolded with
   * its own `@Before/@After/@Next` by the same traversal that lays out the route, and is taken
   * from every place the route runs it. The whole chain by default.
   */
  cursors?: HandlerFunction[];
  /** Instances put into the state before the run: a preset instance cancels its creation. */
  preset?: Array<[ClassConstructor<object>, object]>;
};

type ProbeMethod = {
  fn: HandlerFunction;
  title: string;
  input?: Partial<HttpContextValues>;
};

const nameOf = (cls: object) => (cls as { name?: string }).name;

const where = (route: AomRoute) => `${route.method.toUpperCase()} ${route.path}`;

/** The endpoint of a probe class; without `@Tester` its parameters would silently be `undefined`. */
function endpointFor(tester: object): HandlerFunction {
  const endpoint = endpointOf(tester);
  if (!endpoint) {
    throw new Error(`probe class ${nameOf(tester)}: no @Tester() — probe parameters would arrive undefined`);
  }
  return endpoint;
}

/** Methods of the class marked `@Probe`, in declaration order. */
function probesOf(tester: object): ProbeMethod[] {
  const methods: ProbeMethod[] = [];
  for (const key of Object.getOwnPropertyNames(tester)) {
    const value = (tester as Record<string, unknown>)[key];
    if (typeof value !== "function") continue;
    const meta = probeMeta.get(value as HandlerFunction);
    if (meta) methods.push({ fn: value as HandlerFunction, ...meta });
  }
  if (!methods.length) throw new Error(`probe class ${nameOf(tester)} has no @Probe() methods`);
  return methods;
}

/** One run of the route per distinct input. */
function group(methods: ProbeMethod[]): ProbeMethod[][] {
  const groups = new Map<string, ProbeMethod[]>();
  for (const method of methods) {
    const key = JSON.stringify(method.input ?? null);
    groups.set(key, [...(groups.get(key) ?? []), method]);
  }
  return [...groups.values()];
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Request values of the same shape the server of `@aom-js/api` builds. Layers merge by field:
 * the run's headers and the probe's headers add up instead of replacing each other.
 */
function request(...layers: Array<Partial<HttpContextValues> | undefined>): HttpContextValues {
  const fields = ["ctx", "req", "res", "body", "files", "query", "params", "cookies", "headers", "session"];
  const values: Record<string, unknown> = Object.fromEntries(fields.map((field) => [field, {}]));
  for (const layer of layers) {
    for (const [field, value] of Object.entries(layer ?? {})) {
      values[field] = isPlain(value) && isPlain(values[field]) ? { ...values[field], ...value } : value;
    }
  }
  return values as unknown as HttpContextValues;
}

/**
 * Checks that the server would route a request with these path parameters here: the values are
 * filled into the template by the shared grammar, and the address is matched against the
 * server's own pattern (`compilePath`). A missing or extra parameter is an error before the run.
 */
function address(route: AomRoute, params: Record<string, unknown>) {
  const { pattern, paramNames } = compilePath(route.path);

  const missing = paramNames.find((name) => typeof params[name] !== "string");
  if (missing) throw new Error(`${where(route)}: path parameter "${missing}" is not set`);

  const extra = Object.keys(params).filter((name) => !paramNames.includes(name));
  if (extra.length) throw new Error(`${where(route)}: the route has no path parameters ${extra.join(", ")}`);

  const filled = route.path.replace(new RegExp(PATH_PARAM.source, "g"), (_, name: string) => params[name] as string);
  const match = filled.match(pattern);
  if (!match || paramNames.some((name, index) => match[index + 1] !== params[name])) {
    throw new Error(`${where(route)}: ${filled} does not match the route path — the server would not route it here`);
  }
}

/**
 * The slice of `route.cursors` that step `at` takes together with its `@Before/@After/@Next`.
 * The unfolding is done by the traversal that laid out the route (`plain`), so the slice is what
 * the route really runs; the returned cursors are the route's own objects.
 */
function unfold(route: AomRoute, at: number): AomCursor[] {
  const cursor = route.cursors[at]!;
  const own = plain([cursor]);

  const start = at - own.indexOf(cursor);
  const segment = route.cursors.slice(start, start + own.length);
  if (!segment.every((step, index) => step.$ === own[index]!.$)) {
    throw new Error(`unfolding ${cursor.$} does not match the route: the core traversal changed`);
  }
  return segment;
}

/** The chosen steps in the route's own order; without a choice — the whole chain. */
function stepsOf(route: AomRoute, refs: HandlerFunction[] | undefined): AomCursor[] {
  if (!refs) return route.cursors;

  const picked = new Set<AomCursor>();
  for (const ref of refs) {
    const $ = AomApi.instance(ref);
    const places = route.cursors.flatMap((cursor, index) => (cursor.$ === $ ? [index] : []));
    if (!places.length) {
      throw new Error(`${$} is not a step of route ${where(route)}: a partial run does not do what the route does not`);
    }
    for (const at of places) unfold(route, at).forEach((step) => picked.add(step));
  }
  return route.cursors.filter((cursor) => picked.has(cursor));
}

/**
 * Wraps a method into the call envelope `RxContext.run` takes — the same way `@Run()` runs
 * arbitrary handlers. This is NOT a step of the route: it never gets into `route.cursors`.
 */
const envelope = (route: AomRoute, fn: HandlerFunction) =>
  new AomCursor(AomApi.instance(fn), route.endpoint.$, route.path, route.endpoint);

function describe(route: AomRoute, report: TesterReport) {
  const lines = report.failures.map((f) => `  ✗ ${f.probe} → ${f.check}: ${f.error}`);
  const tail = report.routeError instanceof Error ? `\n  route failed: ${report.routeError.message}` : "";
  return `probes ${route.endpoint.$}: ${report.failures.length} of ${report.results.length} failed\n${lines.join("\n")}${tail}`;
}

/**
 * Runs the probes of a class: finds the route by `@Tester`, checks the address, runs the route in
 * a request context of its own and then the probes in that same context, outside the route.
 * Throws if any probe is red; otherwise returns the report.
 */
export async function runProbes(tester: object, router: Router, options: RunOptions = {}): Promise<TesterReport> {
  const route = router.routeOf(endpointFor(tester));
  const report = new TesterReport();

  for (const probes of group(probesOf(tester))) {
    const values = request(options.values, probes[0]!.input);
    address(route, values.params as Record<string, unknown>);
    const steps = stepsOf(route, options.cursors);

    // the runner owns the context: preset and report are in the state before the first step
    const context = new RxContext(values, route);
    for (const [cls, value] of options.preset ?? []) context.state.set(cls, value);
    context.state.set(TesterReport, report);

    try {
      await context.run(steps);
    } catch (error) {
      report.routeError = error; // a failed route does not cancel the probes
    }

    for (const method of probes) {
      report.probe = method.title;
      const before = report.checks;

      try {
        // every probe is a call of its own: one failing does not take the others down
        const result = await context.run([envelope(route, method.fn)]);
        if (result !== undefined) {
          report.violation(method.title, "usage", "probe returned a value: it goes nowhere — record checks in the report");
        }
      } catch (error) {
        report.violation(method.title, "execution", error instanceof Error ? error.message : String(error));
        continue;
      }

      if (report.checks === before) {
        report.violation(method.title, "assertions", "probe made no assertions");
      }
    }
  }

  if (report.failures.length) throw new Error(describe(route, report));
  return report;
}

/**
 * Runs the chosen steps of `route` (the whole chain by default) in a fresh request context, in
 * the route's own order, without touching `route.cursors`. Values are completed to the server's
 * shape and the address is checked as in `runProbes`; every step must be a cursor of this very
 * route. Resolves and rejects like `route.apply()`, and like it hands the caller's request objects
 * to the steps as they are (`runProbes` copies them: one run per probe input).
 */
export async function runSteps(
  route: AomRoute,
  values?: Partial<HttpContextValues>,
  steps: AomCursor[] = route.cursors,
): Promise<unknown> {
  // missing fields get the server's empty defaults; the caller's own objects go through as is
  const full = { ...request(), ...values } as HttpContextValues;
  address(route, full.params as Record<string, unknown>);

  const foreign = steps.find((step) => !route.cursors.includes(step));
  if (foreign) throw new Error(`${where(route)}: ${foreign.$} is not a step of this route`);

  return new RxContext(full, route).run(route.cursors.filter((cursor) => steps.includes(cursor)));
}
