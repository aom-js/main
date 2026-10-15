import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  After,
  AomApi,
  Before,
  Bridge,
  Controller,
  Get,
  Headers,
  Middleware,
  OnInstance,
  OpenApi,
  Params,
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
}

@Controller()
@Bridge("/items", Items)
class Root {}

const router = new Router(Root, new OpenApi({ openapi: "3.1.0", info: { title: "t", version: "1" } }));

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
  @Probe("sees why the route failed")
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

  it("checks the address by the server's grammar before running", async () => {
    await expect(runSteps(one(), { ...values, params: { id: "abc" } })).rejects.toThrow(
      "does not match the route path",
    );
  });
});
