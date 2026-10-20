import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  After,
  AomApi,
  Args,
  Before,
  Bridge,
  Controller,
  Ctx,
  Get,
  Headers,
  Middleware,
  OnInstance,
  OpenApi,
  Params,
  Query,
  Router,
  This,
} from "@aom-js/router";
import {
  Observe,
  Probe,
  Report,
  Tester,
  TesterReport,
  isTester,
  routesOf,
  runAcross,
  runProbes,
  runSteps,
} from "@aom-js/router/testing";

// ─── fixture: a guarded list and a card with a path parameter ───────────────────────────

/** Loaded by its own hook: a probe tells "created by the route" from "preset" by `hooks`. */
@Controller()
class Store {
  hooks = 0;

  items: string[] = [];

  @OnInstance()
  static async Load(@This() self: Store) {
    self.hooks += 1;
    self.items = ["a", "b"];
  }
}

@Controller()
class Guard {
  @Middleware()
  static async Check(@Headers() headers: Record<string, string>) {
    if (!headers.authorization) throw new Error("NO_TOKEN");
  }
}

class Item {
  id?: string;
}

@Controller()
class ItemParam {
  @Middleware()
  static async Assign(@Params() params: Record<string, string>, @This(Item) item: Item) {
    item.id = params.id;
  }
}

/** Reads nothing itself: the value comes from its `@After` — a picked step must bring it along. */
@Controller()
class ItemID {
  @Middleware()
  @After(ItemParam.Assign)
  static async PathID() {}
}

/** Writes into the caller's `ctx`: `runSteps` must hand the caller's objects through. */
@Controller()
class Visit {
  @Middleware()
  static async Mark(@Ctx() ctx: Record<string, unknown>) {
    ctx.visited = true;
  }
}

/** Built for `Car`'s constructor: its record carries `via: Car`. */
class Engine {
  power = 100;
}

/** Pulled in by `Car`'s own hook: its record names the hook as `by`. */
class Wheels {
  count = 4;
}

@Controller()
class Car {
  wheels?: Wheels;

  constructor(@This(Engine) public engine: Engine) {}

  @OnInstance()
  static async Mount(@This() self: Car, @This(Wheels) wheels: Wheels) {
    self.wheels = wheels;
  }
}

/** Keeps the context of the last run: whether it has `created` depends on who runs the route. */
@Controller()
class Spy {
  static context?: object;

  @Middleware()
  static async Look(@Args(({ context }) => context) context: object) {
    Spy.context = context;
  }
}

@Controller()
@Before(Guard.Check)
class Items {
  @Get("/")
  static async Index(@This(Store) store: Store) {
    return { items: store.items };
  }

  @Get("/id-:id([0-9]+)")
  @Before(ItemID.PathID)
  static async One(@This(Item) item: Item) {
    return { id: item.id };
  }

  @Get("/garage")
  @Before(Spy.Look)
  static async Garage(@This(Car) car: Car) {
    return { power: car.engine.power, wheels: car.wheels?.count };
  }

  /** Fails the way an error response of `@aom-js/api` does: an `Error` with a numeric `status`. */
  @Get("/gone")
  static async Gone() {
    throw Object.assign(new Error("ITEM_NOT_FOUND"), { status: 404 });
  }

  /** Two parameters in one segment: the server splits `1-2-3` as `a = 1-2`, `b = 3`. */
  @Get("/pair/:a([0-9-]+)-:b")
  @Before(Visit.Mark)
  static async Pair(@Params() params: Record<string, string>) {
    return params;
  }
}

@Controller()
@Bridge("/items", Items)
class Root {}

const router = new Router(Root, new OpenApi({ title: "t", version: "1" }));

/** `GET /items` with nothing but its handler: no guard, no token. */
const cheap = { cursors: [Items.Index] };
const authorized = { values: { headers: { authorization: "token" } } };

// ─── probe classes ──────────────────────────────────────────────────────────────────────

@Tester(Items.Index)
class Loaded {
  @Probe("the store is loaded by its own hook")
  static async store(@Observe(Store) store: Store, @Report() report: TesterReport) {
    report.check("items", store.items.join() === "a,b");
    report.check("hook ran once", store.hooks === 1);
  }
}

@Tester(Items.Index)
class Preset {
  @Probe("a preset instance is used as is")
  static async same(@Observe(Store) store: Store, @Report() report: TesterReport) {
    report.check("its hook did not run", store.hooks === 0);
    report.check("its items are the preset ones", store.items.join() === "x");
  }
}

@Tester(Items.Index)
class Failed {
  @Probe("sees why the route failed", undefined, { route: "any" })
  static async error(@Report() report: TesterReport) {
    report.check("route error", (report.routeError as Error)?.message === "NO_TOKEN");
  }
}

@Tester(Items.Index)
class Silent {
  @Probe("asserts nothing")
  static async nothing() {}
}

@Tester(Items.Index)
class Missing {
  @Probe("observes what the request never created")
  static async absent(@Observe(Item) _item: Item, @Report() report: TesterReport) {
    report.check("never reached", true);
  }
}

@Tester(Items.Index)
class Returning {
  @Probe("returns a value")
  static async value(@Report() report: TesterReport) {
    report.check("there is an assertion", true);
    return "a result that goes nowhere";
  }
}

@Tester(Items.Index)
class Ok {
  @Probe("first")
  static async a(@Report() report: TesterReport) {
    report.check("one", true);
  }

  @Probe("second")
  static async b(@Report() report: TesterReport) {
    report.check("two", () => expect(2).toBe(2));
  }
}

/** Without the aggregator (`@Tester` is one) parameter handlers are not registered: the probe
 *  would run with every argument `undefined`. The refusal has to be loud. */
class NoTester {
  @Probe("never runs")
  static async broken(@Report() report: TesterReport) {
    report.check("never runs", true);
  }
}

@Tester(Items.Index)
class Empty {}

@Controller()
class Lonely {
  @Get("/")
  static async Index() {}
}

@Tester(Lonely.Index)
class Stray {
  @Probe("finds no route")
  static async lost(@Report() report: TesterReport) {
    report.check("never runs", true);
  }
}

@Tester(Items.One)
class ItemProbes {
  @Probe("the path parameter reaches the step that reads it")
  static async id(@Observe(Item) item: Item, @Report() report: TesterReport) {
    report.check("Item.id = 42", item.id === "42");
  }
}

/** Two inputs, two runs: the first fails without a token, the second must not see its error. */
@Tester(Items.Index)
class TwoInputs {
  @Probe("without a token the route fails", undefined, { route: "any" })
  static async failed(@Report() report: TesterReport) {
    report.check("NO_TOKEN", (report.routeError as Error)?.message === "NO_TOKEN");
  }

  @Probe("with a token the route passes", { headers: { authorization: "token" } })
  static async passed(@Report() report: TesterReport) {
    report.check("no error of the other input", report.routeError === undefined);
  }
}

/** A probe whose input JSON would lose `value`: inputs differing only in it would merge into one run. */
let lossyRuns = 0;
const lossy = (value: unknown) => {
  @Tester(Items.Index)
  class Lossy {
    @Probe("lossy input", { query: { value } as never })
    static async probe(@Report() report: TesterReport) {
      lossyRuns += 1;
      report.check("ran", true);
    }
  }
  return Lossy;
};

/** The expected outcome of the route is `"ok"` unless declared: a failed route is a violation. */
@Tester(Items.Index)
class ExpectsOk {
  @Probe("expects the route to pass")
  static async ok(@Report() report: TesterReport) {
    report.check("ran", true);
  }
}

@Tester(Items.Gone)
class Gone404 {
  @Probe("the item is gone", undefined, { route: 404 })
  static async gone(@Report() report: TesterReport) {
    report.check("ran", true);
  }
}

@Tester(Items.Gone)
class Gone409 {
  @Probe("expects a conflict", undefined, { route: 409 })
  static async conflict(@Report() report: TesterReport) {
    report.check("ran", true);
  }
}

@Tester(Items.Index)
class Expects404 {
  @Probe("expects the item to be gone", undefined, { route: 404 })
  static async gone(@Report() report: TesterReport) {
    report.check("ran", true);
  }
}

@Tester(Items.Index)
class AnyOutcome {
  @Probe("does not care how the route ended", undefined, { route: "any" })
  static async any(@Report() report: TesterReport) {
    report.check("ran", true);
  }

  @Probe("expects the route to pass")
  static async ok(@Report() report: TesterReport) {
    report.check("ran", true);
  }
}

@Tester(Items.Garage)
class Garage {
  @Probe("the car is built with its engine and wheels")
  static async car(@Observe(Car) car: Car, @Report() report: TesterReport) {
    report.check("engine and wheels", car.engine.power === 100 && car.wheels?.count === 4);
  }
}

@Tester(Items.Garage)
class GarageRed {
  @Probe("fails on purpose")
  static async red(@Report() report: TesterReport) {
    report.check("red", false);
  }
}

/** The map as `Class by step [via Class]` lines: who created what, without asserting the order. */
const createdOf = (report: TesterReport) =>
  (report.created ?? []).map(
    ({ target, by, via }) => `${target.name} by ${by}${via ? ` via ${via.name}` : ""}`,
  );

/** `ItemID.PathID` alone sets nothing: only its `@After(ItemParam.Assign)` does. */
const pathID = { cursors: [ItemID.PathID] };

// ─── runProbes ──────────────────────────────────────────────────────────────────────────

describe("runProbes", () => {
  it("runs the whole chain and probes see what it created", async () => {
    const report = await runProbes(Loaded, router, authorized);

    expect(report.checks).toBe(2);
    expect(report.routeError).toBeUndefined();
  });

  it("a failed route does not cancel the probes: they see its error", async () => {
    const report = await runProbes(Failed, router);

    expect(report.checks).toBe(1);
    expect((report.routeError as Error).message).toBe("NO_TOKEN");
  });

  it("the route error of one input is not seen by the probes of another", async () => {
    const report = await runProbes(TwoInputs, router);

    expect(report.checks).toBe(2);
  });

  it.each([
    ["a function", () => 1],
    ["undefined", undefined],
    ["a symbol", Symbol("lazy")],
  ])("an input with %s is refused before the run", async (_, value) => {
    lossyRuns = 0;

    await expect(runProbes(lossy(value), router, cheap)).rejects.toThrow("not plain JSON");
    expect(lossyRuns).toBe(0);
  });

  it("by default a failed route is a violation of every probe of its input", async () => {
    await expect(runProbes(ExpectsOk, router)).rejects.toThrow(
      "expects the route to pass → route: route ended with error NO_TOKEN, expected ok",
    );
  });

  it("a declared status passes when the route ends with it", async () => {
    const report = await runProbes(Gone404, router, authorized);

    expect(report.failures).toEqual([]);
    expect(report.checks).toBe(1);
  });

  it("a declared status fails when the route ends otherwise", async () => {
    await expect(runProbes(Gone409, router, authorized)).rejects.toThrow(
      "route ended with status 404 (ITEM_NOT_FOUND), expected status 409",
    );
    await expect(runProbes(Expects404, router, authorized)).rejects.toThrow(
      "route ended with ok, expected status 404",
    );
  });

  it('"any" does not check the outcome of the route; its neighbour on the same input does', async () => {
    const failed = String(await runProbes(AnyOutcome, router).catch((error: Error) => error));

    expect(failed).toContain("1 of 3 failed");
    expect(failed).toContain("expects the route to pass → route: route ended with error NO_TOKEN");
    expect(failed).not.toContain("does not care how the route ended → route");
    await expect(runProbes(AnyOutcome, router, authorized)).resolves.toBeInstanceOf(TesterReport);
  });

  it("the map of created objects names the step that asked, or the hook for what the hook pulled in", async () => {
    const created = createdOf(await runProbes(Garage, router, authorized));

    expect(created).toContain("Car by Items.Garage");
    expect(created).toContain("Wheels by Car.Mount via Car");
    // steps' own classes too; the probe class instance is not part of the route run
    expect([...created].sort()).toEqual([
      "Car by Items.Garage",
      "Engine by Items.Garage via Car",
      "Guard by Guard.Check",
      "Items by Items.Garage",
      "Spy by Spy.Look",
      "Wheels by Car.Mount via Car",
    ]);
  });

  it("an object built for another's constructor carries via", async () => {
    const created = createdOf(await runProbes(Garage, router, authorized));

    expect(created).toContain("Engine by Items.Garage via Car");
  });

  it("a preset instance is not in the map of created objects", async () => {
    const store = Object.assign(new Store(), { items: ["x"] });

    const report = await runProbes(Preset, router, { ...cheap, preset: [[Store, store]] });

    expect(report.created).toBeDefined();
    expect(report.created!.map(({ target }) => target)).not.toContain(Store);
  });

  it("only the probe runner keeps the map: route.apply() has no created field", async () => {
    const route = router.routeOf(Items.Garage);

    await route.apply({ ...authorized.values } as never);
    expect(Spy.context && "created" in Spy.context).toBe(false);

    await runProbes(Garage, router, authorized);
    expect(Array.isArray((Spy.context as { created?: unknown }).created)).toBe(true);
  });

  it("the failure message lists the map of created objects of the input", async () => {
    await expect(runProbes(GarageRed, router, authorized)).rejects.toThrow(
      /created \(input \{\}\): [^\n]*Engine by Items\.Garage via Car/,
    );
  });

  it("a preset instance cancels the creation and the hooks of its class", async () => {
    const store = Object.assign(new Store(), { items: ["x"] });

    const report = await runProbes(Preset, router, { ...cheap, preset: [[Store, store]] });

    expect(report.checks).toBe(2);
  });

  it("never writes route.cursors, so runs of one route can overlap", async () => {
    const route = router.routeOf(Items.Index);
    const cursors = route.cursors;
    let writes = 0;
    Object.defineProperty(route, "cursors", {
      configurable: true,
      get: () => cursors,
      set: () => {
        writes += 1;
      },
    });

    try {
      const [first, second] = await Promise.all([
        runProbes(Loaded, router, authorized),
        runProbes(Loaded, router, authorized),
        runSteps(route, authorized.values),
      ]);
      expect([first.checks, second.checks]).toEqual([2, 2]);
    } finally {
      Object.defineProperty(route, "cursors", { configurable: true, enumerable: true, writable: true, value: cursors });
    }

    expect(writes).toBe(0);
  });

  it("a probe without assertions fails", async () => {
    await expect(runProbes(Silent, router, cheap)).rejects.toThrow("made no assertions");
  });

  it("@Observe of a class missing from the state fails the probe instead of skipping it", async () => {
    await expect(runProbes(Missing, router, cheap)).rejects.toThrow("no instance in the request state");
  });

  it("a probe that returns a value breaks the rules", async () => {
    await expect(runProbes(Returning, router, cheap)).rejects.toThrow("returned a value");
  });

  it("several probes of one @Tester run in declaration order and share one report", async () => {
    const report = await runProbes(Ok, router, cheap);

    expect(report.checks).toBe(2);
    expect(report.results.map((r) => r.probe)).toEqual(["first", "second"]);
  });

  it("a probe class without @Tester() is refused with a clear message", async () => {
    await expect(runProbes(NoTester, router, cheap)).rejects.toThrow("no @Tester()");
  });

  it("a class without a single @Probe is an error, not a silent zero", async () => {
    await expect(runProbes(Empty, router, cheap)).rejects.toThrow("no @Probe() methods");
  });

  it("a probe class is not a controller, and isTester tells it from one", () => {
    expect(AomApi.instance(Ok as never).element.isController).toBeFalsy();
    expect([isTester(Ok), isTester(Silent), isTester(Items), isTester(NoTester)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("an endpoint missing from the router is a loud error", async () => {
    await expect(runProbes(Stray, router)).rejects.toThrow("ROUTE_OF_NOT_FOUND_ERROR");
  });

  it("a step the route does not run is refused", async () => {
    await expect(runProbes(Ok, router, pathID)).rejects.toThrow("is not a step of route");
  });

  it("a path parameter reaches the step; the picked step brings its @After along", async () => {
    const report = await runProbes(ItemProbes, router, { ...pathID, values: { params: { id: "42" } } });

    expect(report.checks).toBe(1);
  });

  it("without a path parameter the run does not start", async () => {
    await expect(runProbes(ItemProbes, router, pathID)).rejects.toThrow('path parameter "id" is not set');
  });

  it.each(["abc", "4/2"])("a parameter %s the server would not route here is refused", async (id) => {
    await expect(
      runProbes(ItemProbes, router, { ...pathID, values: { params: { id } } }),
    ).rejects.toThrow("does not match the route path");
  });

  it("a parameter the path does not have is refused", async () => {
    await expect(runProbes(Ok, router, { ...cheap, values: { params: { id: "42" } } })).rejects.toThrow(
      "has no path parameters id",
    );
  });
});

// ─── runSteps ───────────────────────────────────────────────────────────────────────────

describe("runSteps", () => {
  const one = () => router.routeOf(Items.One);
  const values = { headers: { authorization: "token" }, params: { id: "7" } };

  it("runs the whole chain by default", async () => {
    await expect(runSteps(one(), values)).resolves.toEqual({ id: "7" });
  });

  it("runs only the chosen steps: everything before the handler leaves the handler out", async () => {
    const route = one();
    const at = route.cursors.findIndex((cursor) => cursor.$ === cursor.endpoint.$);

    await expect(runSteps(route, values, route.cursors.slice(0, at))).resolves.toBeUndefined();
  });

  it("refuses a cursor of another route, even with the same step", async () => {
    const guardOfIndex = router.routeOf(Items.Index).cursors[0]!;
    expect(guardOfIndex.$).toBe(one().cursors[0]!.$);

    await expect(runSteps(one(), values, [guardOfIndex])).rejects.toThrow("is not a step of this route");
  });

  it("runs the chosen steps in the route's order, however they are listed", async () => {
    await expect(runSteps(one(), values, [...one().cursors].reverse())).resolves.toEqual({ id: "7" });
  });

  it("hands the caller's request objects through, like route.apply()", async () => {
    const ctx: Record<string, unknown> = {};

    await runSteps(router.routeOf(Items.Pair), { ...values, ctx, params: { a: "1", b: "2" } });

    expect(ctx.visited).toBe(true);
  });

  it("refuses values the server would split differently: a = 1, b = 2-3 arrives as a = 1-2, b = 3", async () => {
    const pair = router.routeOf(Items.Pair);
    await expect(runSteps(pair, { ...values, params: { a: "1-2", b: "3" } })).resolves.toEqual({ a: "1-2", b: "3" });

    await expect(runSteps(pair, { ...values, params: { a: "1", b: "2-3" } })).rejects.toThrow(
      "does not match the route path",
    );
  });

  it("checks the address by the server's grammar before running", async () => {
    await expect(runSteps(one(), { ...values, params: { id: "abc" } })).rejects.toThrow(
      "does not match the route path",
    );
  });
});

// ─── runAcross: one probe class across many routes ──────────────────────────────────────

/** Every GET route of the fixture under /items: Index, One, Pair, Garage, Gone. */
const itemsGet = (route: { method: string; path: string }) => route.method === "get" && route.path.startsWith("/items");

/** Values a route needs to reach its endpoint: a token, and the path parameters it has. */
const itemValues = (route: { path: string }) => ({
  headers: { authorization: "token" },
  params: route.path.includes(":id") ? { id: "1" } : route.path.includes(":a") ? { a: "1", b: "2" } : {},
});

let sweepRuns = 0;

@Tester({ match: itemsGet })
class Sweep {
  @Probe("the route ran up to its endpoint")
  static async ran(@Report() report: TesterReport) {
    sweepRuns += 1;
    report.check("ran", true);
  }
}

/** `any`: the outcome is checked by the probe itself — an error must belong to its own route. */
@Tester({ match: itemsGet })
class SweepErrors {
  @Probe("sees only the error of its own route", undefined, { route: "any" })
  static async own(@Report() report: TesterReport) {
    report.check("no route error", report.routeError === undefined);
  }
}

/** Fails on every route with a distinct check per value set: the message must stay bounded. */
@Tester({ match: itemsGet })
class SweepRed {
  @Probe("fails everywhere")
  static async red(@Query() query: Record<string, string>, @Report() report: TesterReport) {
    report.check(`value ${query.n}`, false);
  }
}

const gone = new Map([[Items.Gone, "answers 404 on purpose"]]);

describe("runAcross", () => {
  it("a predicate class walks every matched route, and every result names its route", async () => {
    sweepRuns = 0;
    const report = await runAcross(Sweep, router, { values: itemValues, skip: gone });

    expect(sweepRuns).toBe(4);
    expect(report.results.map((r) => r.route).sort()).toEqual([
      "GET /items",
      "GET /items/garage",
      "GET /items/id-:id([0-9]+)",
      "GET /items/pair/:a([0-9-]+)-:b",
    ]);
  });

  it("the route error of one route is not seen by the probes of another", async () => {
    const failed = String(await runAcross(SweepErrors, router, { values: itemValues }).catch((error: Error) => error));

    expect(failed).toContain("1 of 5 failed on 1 route");
    expect(failed).toContain("✗ sees only the error of its own route → no route error: condition not met\n      GET /items/gone");
  });

  it("drift: a matched route with neither values nor a skip is a loud error before any run", async () => {
    sweepRuns = 0;
    const values = (route: { path: string }) => (route.path === "/items/garage" ? undefined : itemValues(route));

    await expect(runAcross(Sweep, router, { values, skip: gone })).rejects.toThrow(
      "1 matched route has no values and no skip: GET /items/garage",
    );
    expect(sweepRuns).toBe(0);
  });

  it("a skip for a route the class does not match is stale and refused", async () => {
    await expect(
      runAcross(Sweep, router, { values: itemValues, skip: new Map([...gone, [Lonely.Index, "not under /items"]]) }),
    ).rejects.toThrow("skip names Lonely.Index, which the class does not match");
  });

  it("nothing to run is an error, not a green report: no matched route, or a route with no value sets", async () => {
    @Tester({ match: (route) => route.path === "/nowhere" })
    class Nowhere {
      @Probe("never runs")
      static async never(@Report() report: TesterReport) {
        report.check("never", true);
      }
    }

    await expect(runAcross(Nowhere, router, { values: itemValues })).rejects.toThrow(
      "probes Nowhere: the predicate matches no route",
    );
    await expect(runAcross(Sweep, router, { values: () => [], skip: gone })).rejects.toThrow(
      "4 matched routes have no values and no skip",
    );
  });

  it("runProbes refuses a predicate class, runAcross refuses an endpoint class", async () => {
    await expect(runProbes(Sweep, router)).rejects.toThrow("has a route predicate — run it with runAcross");
    await expect(runAcross(Loaded, router, { values: itemValues })).rejects.toThrow(
      "is bound to one endpoint — run it with runProbes",
    );
  });

  it("routesOf: the endpoint route of a point class, the matched routes of a sweep class", () => {
    expect(routesOf(Loaded, router)).toEqual([router.routeOf(Items.Index)]);
    expect(routesOf(Sweep, [router]).map(({ path }) => path).sort()).toEqual([
      "/items",
      "/items/garage",
      "/items/gone",
      "/items/id-:id([0-9]+)",
      "/items/pair/:a([0-9-]+)-:b",
    ]);
    expect(routesOf(Stray, router)).toEqual([]);
  });

  it("the failure message is grouped by probe and check, routes listed under each, and bounded", async () => {
    const values = (route: { path: string }) =>
      Array.from({ length: 30 }, (_, n) => ({ ...itemValues(route), query: { n: String(n) } }));

    const failed = String(await runAcross(SweepRed, router, { values, skip: gone }).catch((error: Error) => error));
    const lines = failed.split("\n");

    expect(lines[0]).toBe("Error: probes SweepRed: 120 of 120 failed on 4 routes");
    expect(lines[1]).toBe("  ✗ fails everywhere → value 0: condition not met");
    // routes in the router's own order, each with the value set it failed on
    const set = '#1 {"n":"0"}';
    expect(lines[2]).toBe(
      `      GET /items ${set}, GET /items/id-:id([0-9]+) ${set}, GET /items/garage ${set}, GET /items/pair/:a([0-9-]+)-:b ${set}`,
    );
    expect(lines.at(-1)).toBe("  … 10 more failing checks");
    expect(lines.length).toBeLessThanOrEqual(1 + 20 * 2 + 1);
  });

  it("several value sets on a route: the failure names the set it failed on, the route stays one", async () => {
    @Tester({ match: (route) => route.method === "get" && route.path === "/items" })
    class SweepHalf {
      @Probe("only the second set is red")
      static async half(@Query() query: Record<string, string>, @Report() report: TesterReport) {
        report.check("n is 1", query.n === "1");
      }
    }
    const values = (route: { path: string }) => ["1", "2"].map((n) => ({ ...itemValues(route), query: { n } }));

    const failed = String(await runAcross(SweepHalf, router, { values }).catch((error: Error) => error));
    expect(failed).toContain("1 of 2 failed on 1 route\n");
    expect(failed).toContain('\n      GET /items #2 {"n":"2"}');
  });
});

