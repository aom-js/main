import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { IsString } from "class-validator";
import { ComponentSchema } from "@aom-js/schemer";
import {
  AomApi,
  AomCursorKind,
  After,
  Before,
  Body,
  Bridge,
  Controller,
  CursorKind,
  Get,
  Marker,
  Middleware,
  Next,
  Nextpoint,
  OnInstance,
  OpenApi,
  Post,
  Query,
  QueryParameters,
  RequestBody,
  Router,
  This,
  ThisRef,
  UseMarker,
  type AomRoute,
  type RefFunction,
} from "@aom-js/router";

const makeDocs = () => new OpenApi({ title: "t", version: "1" });

// фикстура покрывает все 6 видов прикрепления: классовый @Before через мост, классовый @After,
// методные @Before/@After, @Next и сам обработчик
class Guard {
  @Middleware()
  static async Check() {}
}

class Audit {
  @Middleware()
  static async Record() {}

  @Middleware()
  static async Tail() {}
}

class Pager {
  @Nextpoint()
  static async Page() {}
}

@Controller()
class Shells {
  ready = false;

  @OnInstance()
  static async Init(@This() self: Shells) {
    self.ready = true;
  }
}

@Controller()
class Filters {
  @CursorKind(AomCursorKind.Filter)
  @Middleware()
  @QueryParameters({ name: "title", schema: { type: "string" } }, { name: "page", schema: { type: "string" } })
  static async Where(@Query() _query: unknown, @This(Shells) _shells: Shells) {}
}

@ComponentSchema()
class ItemBody {
  @IsString()
  title!: string;

  @IsString()
  note!: string;
}

@Controller()
@After(Audit.Record)
class Leaf {
  static Shells: Function = Shells;

  @Get("/items")
  @Before(Filters.Where)
  @After(Audit.Tail)
  @Next(Pager.Page)
  static async Items(@This(ThisRef((({ Shells }: typeof Leaf) => Shells) as RefFunction)) _shells: Shells) {}

  @Post("/items")
  @RequestBody({ schema: ItemBody })
  static async Create(@Body() _body: unknown) {
    return "created";
  }
}

@Controller()
@Before(Guard.Check)
@Bridge("/leaf", Leaf)
class Root {
  @Get("/")
  static async Home() {}
}

const router = new Router(Root, makeDocs());
const route = router.routeOf(Leaf.Items);
const steps = () => route.toJSON().steps;

describe("router: via курсоров", () => {
  it("каждый курсор несёт свой via — покрыты все 6 значений, классовый @After раньше эндпоинта", () => {
    expect(steps().map(({ step, via }) => [step, via])).toEqual([
      ["Guard.Check", "class-before"],
      ["Audit.Record", "class-after"],
      ["Filters.Where", "before"],
      ["Leaf.Items", "endpoint"],
      ["Audit.Tail", "after"],
      ["Pager.Page", "next"],
    ]);
    expect(route.cursors.map((cursor) => cursor.via)).toEqual(steps().map(({ via }) => via));
  });

  it("viaGroup курсора из @Next — AomApi.toString раскрытого шага", () => {
    const next = route.cursors.find((cursor) => cursor.via === "next")!;
    expect(next.viaGroup).toBe(AomApi.toString(Leaf.Items));
    expect(steps().filter((step) => step.viaGroup)).toEqual([
      expect.objectContaining({ step: "Pager.Page", viaGroup: "Leaf.Items" }),
    ]);
  });
});

describe("router: Router.routeOf", () => {
  it("возвращает маршрут эндпоинта по ссылке на метод", () => {
    expect(route.endpoint.$).toBe(AomApi.checkExists(Leaf.Items));
    expect(`${route.method} ${route.path}`).toBe("get /leaf/items");
  });

  it("не эндпоинт — ROUTE_OF_NOT_FOUND_ERROR", () => {
    expect(() => router.routeOf(Filters.Where)).toThrow(
      expect.objectContaining({ message: expect.stringMatching(/^ROUTE_OF_NOT_FOUND_ERROR/) }),
    );
  });

  it("эндпоинт под двумя мостами — ROUTE_OF_AMBIGUOUS_ERROR с обоими путями", () => {
    @Controller()
    class Shared {
      @Get("/x")
      static async X() {}
    }

    @Controller()
    @Bridge("/a", Shared)
    @Bridge("/b", Shared)
    class Twice {}

    const twice = new Router(Twice, makeDocs());
    let message = "";
    try {
      twice.routeOf(Shared.X);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^ROUTE_OF_AMBIGUOUS_ERROR/);
    expect(message).toContain("get /a/x");
    expect(message).toContain("get /b/x");
  });

  it("поиск не создаёт мета-инстанс для функции, у которой его не было", () => {
    function plain() {}
    expect(() => router.routeOf(plain)).toThrow(
      expect.objectContaining({ message: expect.stringMatching(/^ROUTE_OF_NOT_FOUND_ERROR/) }),
    );
    expect(AomApi.checkExists(plain)).toBeUndefined();
  });

  it("undefined (опечатка в имени метода) — ROUTE_OF_NOT_FOUND_ERROR, а не TypeError", () => {
    expect(() => router.routeOf((Leaf as any).Itemz)).toThrow(
      expect.objectContaining({ message: "ROUTE_OF_NOT_FOUND_ERROR: undefined" }),
    );
  });
});

describe("router: toJSON", () => {
  const json = JSON.parse(JSON.stringify(router));

  it("ключи — закреплённая форма дампа", () => {
    expect(Object.keys(json).sort()).toEqual(["routes", "version"]);
    expect(json.version).toBe(1);
    const routeKeys = new Set(json.routes.flatMap((r: object) => Object.keys(r)));
    expect([...routeKeys].sort()).toEqual(["markers", "method", "path", "steps"]);
    const stepKeys = new Set(json.routes.flatMap((r: any) => r.steps.flatMap((s: object) => Object.keys(s))));
    expect([...stepKeys].sort()).toEqual(
      ["creates", "hooks", "i", "kind", "origin", "parameters", "step", "via", "viaGroup"],
    );
    json.routes.forEach((r: any) =>
      r.steps.forEach((s: any) =>
        ["i", "step", "origin", "via", "parameters", "creates", "hooks"].forEach((key) =>
          expect(s).toHaveProperty(key),
        ),
      ),
    );
  });

  it("детерминизм: две сериализации побайтно равны, маршруты отсортированы", () => {
    expect(JSON.stringify(router)).toBe(JSON.stringify(router));
    const order = json.routes.map((r: any) => `${r.method} ${r.path}`);
    expect(order).toEqual([...order].sort());
    expect(order).toEqual(["get /", "get /leaf/items", "post /leaf/items"]);
  });

  it("шаги: позиция, точка прикрепления, объявленный вид", () => {
    expect(steps().map(({ i, origin }) => [i, origin])).toEqual([
      [0, "Root"],
      [1, "Leaf"],
      [2, "Leaf.Items"],
      [3, "Leaf.Items"],
      [4, "Leaf.Items"],
      [5, "Leaf.Items"],
    ]);
    expect(steps().filter((step) => step.kind)).toEqual([
      expect.objectContaining({ step: "Filters.Where", kind: "filter" }),
    ]);
  });

  it("markers: ident точек, типы маркера и слои точек — только если они есть", () => {
    @Controller()
    class Marks {
      @Marker()
      static access(route: AomRoute) {
        route.markers.access = {
          accessTypes: ["a"],
          accessPoints: [
            { ident: "P", title: "P", extra: [{ ident: "L", title: "L", accessTypes: ["a"] }] },
            { ident: "Q", title: "Q", extra: [] },
          ],
        };
        route.markers.bare = { accessPoints: [{ ident: "R", title: "R" }] };
      }
    }
    @Controller()
    class App {
      @Get("/")
      @UseMarker(Marks.access)
      static async Index() {}
    }

    const [route] = JSON.parse(JSON.stringify(new Router(App, makeDocs()))).routes;
    expect(route.markers).toEqual({
      access: { accessPoints: ["P", "Q"], accessTypes: ["a"], extra: { P: [{ ident: "L", accessTypes: ["a"] }] } },
      bare: { accessPoints: ["R"] },
    });
  });

  it("параметры: @Query со схемой — поля, @This(X) и @This(ThisRef) — subject", () => {
    const [, , where, items] = steps();
    expect(where.parameters).toEqual([
      { kind: "values", source: "query", fields: ["title", "page"] },
      { kind: "this", subject: "Shells" },
    ]);
    expect(items.parameters).toEqual([{ kind: "this", subject: "Shells" }]);
  });

  it("параметры: @Body с классом-схемой — поля класса", () => {
    const [create] = router.routeOf(Leaf.Create).toJSON().steps.filter((s) => s.via === "endpoint");
    expect(create.parameters).toEqual([{ kind: "values", source: "body", fields: ["title", "note"] }]);
  });

  it("creates/hooks: первый шаг, которому нужен класс, создаёт его и запускает его @OnInstance", () => {
    expect(steps().map(({ step, creates, hooks }) => [step, creates, hooks])).toEqual([
      ["Guard.Check", ["Guard"], []],
      ["Audit.Record", ["Audit"], []],
      ["Filters.Where", ["Filters", "Shells"], ["Shells.Init"]],
      ["Leaf.Items", ["Leaf"], []],
      ["Audit.Tail", [], []],
      ["Pager.Page", ["Pager"], []],
    ]);
  });

  it("creates/hooks: классы, которые создаёт конструктор (@This в его параметрах), — у того же шага, рекурсивно", () => {
    @Controller()
    class Db {
      @OnInstance()
      static async Open() {}
    }

    @Controller()
    class Store {
      constructor(@This(Db) public db: Db) {}
    }

    @Controller()
    class Owner {
      constructor(@This() public self: unknown) {}

      @Get("/")
      static async Index(@This(Store) _store: Store) {}
    }

    const [index] = new Router(Owner, makeDocs()).routeOf(Owner.Index).toJSON().steps;
    expect([index.creates, index.hooks]).toEqual([["Owner", "Store", "Db"], ["Db.Open"]]);
  });
});
