import { describe, it, expect } from "vitest";
import {
  Before,
  Bridge,
  Controller,
  Get,
  Marker,
  Middleware,
  OpenApi,
  Post,
  RequestBody,
  Responses,
  Router,
  Title,
  UseMarker,
  WebSocketPoint,
  type AomCursor,
  type AomRoute,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

import { Visualizer, buildVisualGraph, collectControllers, renderVisualGraph } from "../src";

@ComponentSchema()
class TagDto {
  @PropertySchema.String({})
  name!: string;
}

@ComponentSchema()
class ItemDto {
  @PropertySchema.String({})
  title!: string;

  @PropertySchema.Type({ value: () => TagDto, isArray: true })
  tags!: TagDto[];
}

@Controller()
class Shared {
  @Middleware()
  @Title("Общая проверка")
  static async Guard() {}

  @Marker()
  static Mark(route: AomRoute, _cursor: AomCursor) {
    route.markers.checked = true;
  }
}

@Controller()
@Before(Shared.Guard)
class Items {
  @Get("/")
  @Title("Список позиций")
  @Responses({ status: 200, schema: ItemDto, description: "ok", isArray: true })
  @UseMarker(Shared.Mark)
  static async list() {
    return [];
  }

  @Post("/")
  @RequestBody({ schema: ItemDto })
  @Responses({ status: 201, schema: ItemDto, description: "created" })
  static async create() {
    return {};
  }
}

@Controller()
@Before(Shared.Guard)
class Feed {
  @WebSocketPoint("/live")
  static async live() {}
}

@Controller()
@Bridge("/items", Items)
@Bridge("/feed", Feed)
class Root {}

describe("visualizer: сборка графа", () => {
  const graph = buildVisualGraph(Root, { title: "Тест" });

  it("собирает маршруты с путями и методами", () => {
    expect(graph.routes.map((route) => route.id).sort()).toEqual([
      "get /items",
      "post /items",
      "sockets /feed/live",
    ]);
  });

  it("строит дерево контроллеров по бриджам", () => {
    const root = graph.controllers.find((one) => one.id === "Root")!;
    // декораторы класса выполняются снизу вверх, поэтому порядок бриджей обратен объявлению
    expect(root.bridges).toEqual([
      { prefix: "/feed", target: "Feed", via: undefined },
      { prefix: "/items", target: "Items", via: undefined },
    ]);
    expect(graph.controllers.find((one) => one.id === "Items")!.prefixes).toEqual(["/items"]);
  });

  it("считает переиспользование звеньев: общая middleware видна во всех маршрутах", () => {
    const guard = graph.middlewares.find((one) => one.id === "Shared.Guard")!;
    expect(guard.usedBy.sort()).toEqual(["get /items", "post /items", "sockets /feed/live"]);
    expect(guard.title).toBe("Общая проверка");
    expect(graph.stats.shared).toBeGreaterThan(0);
  });

  it("цепочка маршрута идёт по порядку и заканчивается endpoint-ом", () => {
    const route = graph.routes.find((one) => one.id === "get /items")!;
    expect(route.chain.map((step) => step.id)).toEqual(["Shared.Guard", "Items.list"]);
    expect(route.chain.at(-1)!.kind).toBe("endpoint");
    expect(route.chain.map((step) => step.index)).toEqual([0, 1]);
  });

  it("разбирает компонентные схемы и связи между ними как рёбра ER", () => {
    const item = graph.schemas.find((one) => one.id === "ItemDto")!;
    expect(item.refs).toEqual([{ property: "tags", target: "TagDto" }]);
    expect(item.properties.find((one) => one.name === "tags")).toMatchObject({
      isArray: true,
      ref: "TagDto",
    });
    expect(graph.schemas.find((one) => one.id === "TagDto")!.referencedBy).toEqual(["ItemDto"]);
  });

  it("связывает маршруты со схемами в обе стороны", () => {
    expect(graph.routes.find((one) => one.id === "get /items")!.schemas).toEqual(["ItemDto"]);
    expect(graph.schemas.find((one) => one.id === "ItemDto")!.usedBy.sort()).toEqual([
      "get /items",
      "post /items",
    ]);
  });

  it("переносит тело запроса и ответы из документа", () => {
    const route = graph.routes.find((one) => one.id === "post /items")!;
    expect(route.requestBody).toMatchObject({ contentType: "application/json" });
    expect(route.requestBody!.schema.ref).toBe("ItemDto");
    expect(route.responses.map((one) => one.status)).toEqual(["201"]);
  });

  it("сохраняет маркеры маршрута", () => {
    expect(graph.routes.find((one) => one.id === "get /items")!.markers).toEqual({ checked: true });
  });

  it("перечисляет декорированные члены контроллера, включая неподключённые", () => {
    const shared = buildVisualGraph(Shared).controllers.find((one) => one.id === "Shared")!;
    expect(shared.members.map((one) => one.id).sort()).toEqual(["Shared.Guard", "Shared.Mark"]);
  });

  it("строится от любого уровня дерева, а не только от корня", () => {
    const sub = buildVisualGraph(Items);
    expect(sub.root).toBe("Items");
    expect(sub.routes.map((one) => one.id).sort()).toEqual(["get /", "post /"]);
  });

  it("перечисляет достижимые контроллеры для переключения корня", () => {
    expect([...collectControllers(Root).keys()].sort()).toEqual(["Feed", "Items", "Root"]);
    expect(graph.roots).toContain("Items");
  });

  it("не ломает уже собранный роутер приложения", () => {
    const docs = new OpenApi({ title: "app", version: "1" });
    const router = new Router(Root, docs);
    const before = router.routes.length;
    buildVisualGraph(router);
    expect(router.routes.length).toBe(before);
    expect(buildVisualGraph(router).root).toBe("Root");
  });
});

describe("visualizer: компонента", () => {
  const docs = () => new OpenApi({ title: "app", version: "1" });

  it("строится от маршрута: корнем берётся корень его роутера", () => {
    const router = new Router(Root, docs());
    const route = router.routes[0];
    const visual = new Visualizer(route);
    expect(visual.root).toBe(Root);
    expect(visual.graph.root).toBe("Root");
  });

  it("принимает роутер и класс контроллера", () => {
    expect(new Visualizer(new Router(Root, docs())).graph.root).toBe("Root");
    expect(new Visualizer(Items).graph.root).toBe("Items");
  });

  it("html и toString дают одну и ту же страницу, считаются один раз", () => {
    const visual = new Visualizer(Root);
    expect(visual.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(String(visual)).toBe(visual.html);
    expect(visual.graph).toBe(visual.graph);
  });

  it("toJSON отдаёт граф — endpoint может вернуть компоненту как данные", () => {
    const visual = new Visualizer(Root);
    expect(JSON.parse(JSON.stringify(visual)).root).toBe("Root");
  });
});

describe("visualizer: рендер страницы", () => {
  const html = renderVisualGraph(buildVisualGraph(Root, { title: "Тест" }));

  it("отдаёт самодостаточный документ без внешних загрузок", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/);
  });

  it("встраивает граф так, что он читается обратно", () => {
    const payload = html.match(
      /<script type="application\/json" id="aom-graph">(.*?)<\/script>/s,
    )![1];
    const parsed = JSON.parse(payload);
    expect(parsed.root).toBe("Root");
    expect(parsed.routes).toHaveLength(3);
  });

  it("не параметризуется извне: ни query-параметров, ни ссылок на себя", () => {
    expect(html).not.toMatch(/searchParams/);
    expect(html).toContain("#root=");
    expect(html).toContain("hashchange");
  });

  it("встраивает граф целиком, чтобы срез считался на клиенте", () => {
    const payload = html.match(
      /<script type="application\/json" id="aom-graph">(.*?)<\/script>/s,
    )![1];
    const parsed = JSON.parse(payload);
    expect(parsed.roots).toEqual(expect.arrayContaining(["Root", "Items", "Feed"]));
    expect(parsed.controllers.length).toBe(parsed.roots.length);
  });

  it("экранирует угловые скобки внутри встроенного JSON", () => {
    const escaped = renderVisualGraph({
      ...buildVisualGraph(Root),
      title: "</script><img src=x>",
    });
    expect(escaped).not.toContain("</script><img");
  });
});
