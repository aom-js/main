import type { ClassConstructor } from "@aom-js/core";

import type { Router } from "../classes";
import { AomApi } from "../common/api";
import { RxContext, type CreatedRecord } from "../common/context";
import { AomCursor } from "../common/cursor";
import { compilePath, PATH_PARAM } from "../common/path";
import { plain, type AomRoute } from "../common/route";
import type { HandlerFunction } from "../common/types";
import type { HttpContextValues } from "../types";
import { endpointOf, matchOf, probeMeta, type RouteOutcome } from "./decorators";
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
  route: RouteOutcome;
};

const nameOf = (cls: object) => (cls as { name?: string }).name;

const where = (route: AomRoute) => `${route.method.toUpperCase()} ${route.path}`;

/** How a route run ended, in the terms `@Probe` declares it: `ok`, `status 404 (…)` or `error …`. */
function outcome(error: unknown): string {
  if (error === undefined) return "ok";
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? `status ${status} (${message})` : `error ${message}`;
}

/** Whether the run ended as the probe declares; `"any"` is never checked. */
function expected(route: RouteOutcome, error: unknown): boolean {
  if (route === "any") return true;
  if (route === "ok") return error === undefined;
  return (error as { status?: unknown } | null)?.status === route;
}

/** The endpoint of a probe class; without `@Tester` its parameters would silently be `undefined`. */
function endpointFor(tester: object): HandlerFunction {
  const endpoint = endpointOf(tester);
  if (!endpoint && matchOf(tester)) {
    throw new Error(`probe class ${nameOf(tester)} has a route predicate — run it with runAcross`);
  }
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

/**
 * One run of the route per distinct input. Inputs are told apart by their JSON, so an input JSON
 * would lose part of is refused: probes of two different inputs would share one run.
 */
function group(tester: object, methods: ProbeMethod[]): ProbeMethod[][] {
  const groups = new Map<string, ProbeMethod[]>();
  for (const method of methods) {
    const lost = method.input === undefined ? undefined : lossy(method.input, "input");
    if (lost) {
      throw new Error(
        `probe "${method.title}" of ${nameOf(tester)}: input is not plain JSON (${lost}) — inputs differing only in it would merge into one run`,
      );
    }
    const key = JSON.stringify(method.input ?? null);
    groups.set(key, [...(groups.get(key) ?? []), method]);
  }
  return [...groups.values()];
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** Where JSON would drop or flatten `value` (functions, `undefined`, symbols, class instances); nothing if it keeps it. */
function lossy(value: unknown, path: string): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : `${path} is ${value}`;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const lost = lossy(item, `${path}[${index}]`);
      if (lost) return lost;
    }
    return undefined;
  }
  if (isPlain(value)) {
    if (Object.getOwnPropertySymbols(value).length) return `${path} has a symbol key`;
    for (const [key, item] of Object.entries(value)) {
      const lost = lossy(item, `${path}.${key}`);
      if (lost) return lost;
    }
    return undefined;
  }
  const kind = typeof value === "object" ? `an instance of ${value.constructor?.name ?? "a null prototype"}` : `a ${typeof value}`;
  return `${path} is ${kind}`;
}

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

/** What one input's run left behind, for the failure message. */
type RunTrace = { input: string; error?: string; created: CreatedRecord[] };

/** At most this many created objects per input in the failure message. */
const CREATED_SHOWN = 20;

function createdLine({ input, created }: RunTrace) {
  const shown = created
    .slice(0, CREATED_SHOWN)
    .map(({ target, by, via }) => `${target.name} by ${by}${via ? ` via ${via.name}` : ""}`);
  const more = created.length > CREATED_SHOWN ? `, … ${created.length - CREATED_SHOWN} more` : "";
  return `\n  created (input ${input}): ${shown.join(", ") || "nothing"}${more}`;
}

function describe(route: AomRoute, report: TesterReport, runs: RunTrace[]) {
  const lines = report.failures.map((f) => `  ✗ ${f.probe} → ${f.check}: ${f.error}`);
  const tail = runs
    .map((run) => (run.error ? `\n  route failed (input ${run.input}): ${run.error}` : "") + createdLine(run))
    .join("");
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
  const runs: RunTrace[] = [];

  await probeRoute(route, group(tester, probesOf(tester)), report, runs, {
    values: options.values,
    steps: () => stepsOf(route, options.cursors),
    preset: options.preset,
  });

  if (report.failures.length) throw new Error(describe(route, report, runs));
  return report;
}

/**
 * The probes of one class on one route: a fresh request context per distinct input, the route's
 * steps, then every probe of that input in the same context, outside the route. Results are
 * stamped with the route; the error and the created map of one run are never seen by another.
 */
async function probeRoute(
  route: AomRoute,
  groups: ProbeMethod[][],
  report: TesterReport,
  runs: RunTrace[],
  options: { values?: Partial<HttpContextValues>; steps: () => AomCursor[]; preset?: RunOptions["preset"]; set?: string },
) {
  report.route = where(route);
  report.set = options.set ?? "";
  for (const probes of groups) {
    const values = request(options.values, probes[0]!.input);
    address(route, values.params as Record<string, unknown>);
    const steps = options.steps();

    // the runner owns the context: preset and report are in the state before the first step
    const context = new RxContext(values, route);
    for (const [cls, value] of options.preset ?? []) context.state.set(cls, value);
    context.state.set(TesterReport, report);
    // the map of created objects: only this runner sets it — preset ones are already in state
    context.created = [];

    // every input sees the error and the map of its own run only
    const run: RunTrace = { input: JSON.stringify(probes[0]!.input ?? {}), created: [] };
    runs.push(run);
    report.routeError = undefined;
    try {
      await context.run(steps);
    } catch (error) {
      report.routeError = error; // a failed route does not cancel the probes
      run.error = error instanceof Error ? error.message : String(error);
    }
    // a copy: what the probes themselves create (their own class) is not the route's
    report.created = run.created = [...context.created];

    for (const method of probes) {
      report.probe = method.title;
      const before = report.checks;

      if (!expected(method.route, report.routeError)) {
        const declared = typeof method.route === "number" ? `status ${method.route}` : method.route;
        report.violation(method.title, "route", `route ended with ${outcome(report.routeError)}, expected ${declared}`);
      }

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
}

/** Every route of `routers` a probe class checks: its endpoint's route, or the routes its predicate matches. */
export function routesOf(tester: object, routers: Router | Router[]): AomRoute[] {
  const all = [routers].flat().flatMap((router) => router.routes);
  const endpoint = endpointOf(tester);
  if (endpoint) {
    const $ = AomApi.instance(endpoint);
    return all.filter((route) => route.endpoint.$ === $);
  }
  const match = matchOf(tester);
  if (!match) throw new Error(`probe class ${nameOf(tester)}: no @Tester() — it checks no route`);
  return all.filter((route) => match(route));
}

export type AcrossOptions = {
  /**
   * Request values each matched route is run with — one set or several (a run per set). A route
   * the class matches without values and without a `skip` reason is drift: a loud error.
   */
  values: (route: AomRoute) => Partial<HttpContextValues> | Partial<HttpContextValues>[] | undefined;
  /** The route's own cursors to run; the whole chain by default. */
  steps?: (route: AomRoute) => AomCursor[];
  /** Instances put into the state before every run, as in `runProbes`. */
  preset?: RunOptions["preset"];
  /** Endpoints the class matches but must not run, with the reason; a stale entry is an error. */
  skip?: Map<HandlerFunction, string>;
};

/** At most this many failing checks, and this many routes under each, in the `runAcross` message. */
const CHECKS_SHOWN = 20;
const ROUTES_SHOWN = 10;

/** Failures grouped «probe → check → routes»: one line per check, its routes under it; bounded. */
function grouped(tester: object, report: TesterReport) {
  const groups = new Map<string, Set<string>>();
  for (const f of report.failures) {
    const key = `  ✗ ${f.probe} → ${f.check}: ${f.error}`;
    groups.set(key, (groups.get(key) ?? new Set()).add(f.set ? `${f.route} ${f.set}` : (f.route ?? "")));
  }
  const routes = new Set(report.failures.map((f) => f.route));
  const head = `probes ${nameOf(tester)}: ${report.failures.length} of ${report.results.length} failed on ${routes.size} route${routes.size === 1 ? "" : "s"}`;
  const lines = [...groups].slice(0, CHECKS_SHOWN).flatMap(([check, on]) => {
    const list = [...on];
    const more = list.length > ROUTES_SHOWN ? `, … ${list.length - ROUTES_SHOWN} more` : "";
    return [check, `      ${list.slice(0, ROUTES_SHOWN).join(", ")}${more}`];
  });
  const rest = groups.size > CHECKS_SHOWN ? [`  … ${groups.size - CHECKS_SHOWN} more failing checks`] : [];
  return [head, ...lines, ...rest].join("\n");
}

/**
 * Runs a sweep probe class (`\@Tester({ match })`) on every route of `routers` it matches: each
 * route with its own values (several sets — several runs), in a context of its own, so an error
 * of one route is never seen by the probes of another. Drift — a matched route with neither
 * values nor a skip reason — and a stale skip are errors before any run. Throws if any probe is
 * red, with failures grouped by probe and check; otherwise returns the report (results carry `route`).
 */
export async function runAcross(
  tester: object,
  routers: Router | Router[],
  options: AcrossOptions,
): Promise<TesterReport> {
  if (endpointOf(tester)) {
    throw new Error(`probe class ${nameOf(tester)} is bound to one endpoint — run it with runProbes`);
  }
  const routes = routesOf(tester, routers);
  if (!routes.length) throw new Error(`probes ${nameOf(tester)}: the predicate matches no route — nothing would be checked`);
  const groups = group(tester, probesOf(tester));

  const skip = new Map([...(options.skip ?? [])].map(([endpoint, reason]) => [AomApi.instance(endpoint), reason]));
  const stale = [...skip.keys()].filter(($) => !routes.some((route) => route.endpoint.$ === $));
  if (stale.length) {
    throw new Error(`probes ${nameOf(tester)}: skip names ${stale.join(", ")}, which the class does not match`);
  }

  const plan = routes
    .filter((route) => !skip.has(route.endpoint.$))
    .map((route) => ({ route, values: options.values(route) }));
  // no value sets — the same drift: the route would be counted as checked without a single run
  const drift = plan.filter(({ values }) => !values || (Array.isArray(values) && !values.length)).map(({ route }) => where(route));
  if (drift.length) {
    const what = drift.length === 1 ? "1 matched route has" : `${drift.length} matched routes have`;
    throw new Error(`probes ${nameOf(tester)}: ${what} no values and no skip: ${drift.join(", ")}`);
  }

  const report = new TesterReport();
  for (const { route, values } of plan) {
    const steps = () => {
      const own = options.steps?.(route) ?? route.cursors;
      const foreign = own.find((step) => !route.cursors.includes(step));
      if (foreign) throw new Error(`${where(route)}: ${foreign.$} is not a step of this route`);
      return route.cursors.filter((cursor) => own.includes(cursor));
    };
    const sets = [values!].flat();
    for (const [n, set] of sets.entries()) {
      // several sets on one route: the failure says which one, `route` stays `METHOD /path`
      const label = sets.length > 1 ? `#${n + 1} ${JSON.stringify(set.query ?? {})}` : undefined;
      await probeRoute(route, groups, report, [], { values: set, steps, preset: options.preset, set: label });
    }
  }

  if (report.failures.length) throw new Error(grouped(tester, report));
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
