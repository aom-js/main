import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  After,
  Before,
  Bridge,
  Controller,
  FwdRef,
  Get,
  Marker,
  Middleware,
  OpenApi,
  Router,
  This,
  ThisRef,
  UseMarker,
  type AomCursor,
  type AomRoute,
} from "@aom-js/router";
import {
  accessIdents,
  constructorThisRefs,
  identCollisions,
  parentsOf,
  routeName,
  serializationErrors,
  sharedEndpoints,
} from "@aom-js/router/testing";

const makeDocs = () => new OpenApi({ title: "t", version: "1" });

describe("routeName", () => {
  it("method and path without parameter regexps", () => {
    expect(routeName({ method: "get", path: "/a/x" })).toBe("get /a/x");
    expect(routeName({ method: "get", path: "/a/:id(\\d+)/b/:key" })).toBe("get /a/:id/b/:key");
  });
});

describe("parentsOf", () => {
  it("before points to the nearest next cursor of its origin, after/next to the nearest previous, top ones to -1", () => {
    @Controller()
    class Chain {
      @Middleware()
      static async Pre() {}
      @Middleware()
      static async Post() {}
      @Middleware()
      static async ClassPre() {}
      @Middleware()
      static async ClassPost() {}
    }
    @Controller()
    @Before(Chain.ClassPre)
    @After(Chain.ClassPost)
    class App {
      @Get("/")
      @Before(Chain.Pre)
      @After(Chain.Post)
      static async Index() {}
    }

    const [route] = new Router(App, makeDocs()).routes;
    const via = route.cursors.map((cursor: AomCursor) => cursor.via);
    expect(via).toEqual(["class-before", "class-after", "before", "endpoint", "after"]);
    expect(parentsOf(route.cursors)).toEqual([-1, -1, 3, -1, 3]);
  });

  it("no cursors, no parents", () => {
    expect(parentsOf([])).toEqual([]);
  });
});

describe("sharedEndpoints", () => {
  it("the endpoint under two bridges serves two routes", () => {
    @Controller()
    class Shared {
      @Get("/x")
      static async X() {}
    }
    @Controller()
    @Bridge("/a", Shared)
    @Bridge("/b", Shared)
    class Twice {}

    expect(sharedEndpoints(new Router(Twice, makeDocs()))).toEqual([
      "endpoint Shared.X serves 2 routes: get /a/x, get /b/x",
    ]);
  });

  it("one bridge, one route each", () => {
    @Controller()
    class Own {
      @Get("/x")
      static async X() {}
    }
    @Controller()
    @Bridge("/a", Own)
    class Once {}

    expect(sharedEndpoints(new Router(Once, makeDocs()))).toEqual([]);
  });
});

describe("accessIdents / identCollisions", () => {
  // the marker records the access point the way an access layer does: ident is `String(origin)`
  const guards = () => {
    @Controller()
    class Access {
      @Marker()
      static mark(route: AomRoute, cursor: AomCursor) {
        const points = ((route.markers.access ??= { accessPoints: [] }) as { accessPoints: unknown[] }).accessPoints;
        points.push({ ident: String(cursor.origin) });
      }
      @Middleware()
      @UseMarker(Access.mark)
      static async Required() {}
      @Middleware()
      static async Plain() {}
    }
    return Access;
  };
  const section = (Access: ReturnType<typeof guards>) => {
    @Controller()
    @Before(Access.Required)
    class Section {
      @Get("/")
      static async Index() {}
    }
    return Section;
  };

  it("two different classes with one name under the marker collide", () => {
    const Access = guards();
    @Controller()
    @Bridge("/a", section(Access))
    @Bridge("/b", section(Access))
    class Root {}

    const router = new Router(Root, makeDocs());
    expect(accessIdents(router).get("Section")?.size).toBe(2);
    expect(identCollisions(router)).toEqual([expect.stringMatching(/ident "Section" .* 2 /)]);
  });

  it("one class on several routes does not collide", () => {
    const Access = guards();
    const Shared = section(Access);
    @Controller()
    @Bridge("/a", Shared)
    @Bridge("/b", Shared)
    class Root {}

    const router = new Router(Root, makeDocs());
    expect(accessIdents(router).get("Section")?.size).toBe(1);
    expect(identCollisions(router)).toEqual([]);
  });

  it("a namesake without the marker is not counted", () => {
    const Access = guards();
    @Controller()
    @Before(Access.Required)
    @Bridge("/x", section(Access))
    class Section {}

    expect(identCollisions(new Router(Section, makeDocs()))).toHaveLength(1);

    @Controller()
    @Before(Access.Plain)
    class Inner {
      @Get("/")
      static async Index() {}
    }
    @Controller()
    @Before(Access.Required)
    @Bridge("/x", Inner)
    class Outer {}
    expect(identCollisions(new Router(Outer, makeDocs()))).toEqual([]);
  });
});

describe("serializationErrors", () => {
  it("an unresolvable FwdRef in an argument is found", () => {
    @Controller()
    class Broken {
      @Get("/")
      static async Index(
        @This(FwdRef(() => {
          throw new ReferenceError("Missing is not defined");
        }))
        _missing: unknown,
      ) {}
    }

    expect(serializationErrors(new Router(Broken, makeDocs()))).toEqual([
      "router does not serialize: Missing is not defined",
    ]);
  });
});

describe("constructorThisRefs", () => {
  it("ThisRef and @This() in a constructor are found", () => {
    @Controller()
    class Dependency {}
    @Controller()
    class ByRef {
      constructor(@This(ThisRef(() => Dependency)) public dependency: Dependency) {}
    }
    @Controller()
    class Bare {
      constructor(@This() public owner: unknown) {}
    }
    @Controller()
    class App {
      @Get("/")
      static async Index(@This(ByRef) _a: ByRef, @This(Bare) _b: Bare) {}
    }

    const { inspected, found } = constructorThisRefs(new Router(App, makeDocs()));
    expect(inspected).toBeGreaterThanOrEqual(3);
    expect(found).toEqual([
      "ByRef: constructor parameter 0 — ThisRef, the target depends on the cursor that created the class first",
      "Bare: constructor parameter 0 — @This() without an argument, the target depends on the cursor that created the class first",
    ]);
  });

  it("a clean class is inspected and not reported", () => {
    @Controller()
    class Clean {}
    @Controller()
    class App {
      @Get("/")
      static async Index(@This(Clean) _c: Clean) {}
    }

    const result = constructorThisRefs(new Router(App, makeDocs()));
    expect(result.found).toEqual([]);
    expect(result.inspected).toBeGreaterThanOrEqual(1);
  });
});

describe("a router without routes", () => {
  it("every rule returns empty", () => {
    @Controller()
    class Empty {}
    const router = new Router(Empty, makeDocs());

    expect(router.routes).toEqual([]);
    expect(sharedEndpoints(router)).toEqual([]);
    expect(accessIdents(router).size).toBe(0);
    expect(identCollisions(router)).toEqual([]);
    expect(serializationErrors(router)).toEqual([]);
    expect(constructorThisRefs(router)).toEqual({ inspected: 0, found: [] });
  });
});
