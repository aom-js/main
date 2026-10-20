import { describe, it, expect } from "vitest";
import {
  Controller, Get, Post, Router, OpenApi,
  Title, Description, Responses, RequestBody, PathParameters, Security,
  Params, Body, UseTag, Middleware, Before, ThisRef,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import type { ClassType } from "@aom-js/core";

@ComponentSchema()
class ItemDto {
  @PropertySchema.String({})
  title!: string;
}

describe("router: генерация OpenAPI", () => {
  const build = () => {
    @Controller()
    class Shop {
      @Get("/items")
      @Title("Список")
      @Description("Все позиции")
      @Responses({ status: 200, schema: ItemDto, description: "ok", isArray: true })
      static async list() {
        return [];
      }

      @Post("/items")
      @RequestBody({ schema: ItemDto })
      @Responses({ status: 201, schema: ItemDto, description: "created" })
      @Security({ type: "http", scheme: "bearer" })
      static async create(@Body() body: unknown) {
        return body;
      }

      @Get("/item/item_id")
      @PathParameters({ item_id: { name: "id", schema: { type: "string" } } })
      static async one(@Params("id") id: string) {
        return { id };
      }
    }

    const docs = new OpenApi({ title: "t", version: "1" });
    new Router(Shop, docs);
    return docs.toJSON();
  };

  it("операции получают operationId, summary и description", () => {
    const json = build();
    expect(json.paths["/items"].get).toMatchObject({
      operationId: "Shop_list",
      summary: "Список",
      description: "Все позиции",
    });
  });

  it("Responses с компонентной схемой дают $ref и массивную обертку", () => {
    const json = build();
    const schema = json.paths["/items"].get.responses["200"].content["application/json"].schema;
    expect(schema).toEqual({ type: "array", items: { $ref: "#/components/schemas/ItemDto" } });
  });

  it("компонент попадает в components.schemas один раз", () => {
    const json = build();
    expect(json.components.schemas.ItemDto).toMatchObject({
      properties: { title: { type: "string" } },
    });
  });

  it("RequestBody рендерится с $ref", () => {
    const json = build();
    expect(json.paths["/items"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ItemDto",
    });
  });

  it("PathParameters заменяют сегмент пути на {name} и добавляют параметр", () => {
    const json = build();
    const operation = json.paths["/item/{id}"].get;
    expect(operation).toBeDefined();
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ]),
    );
  });

  it("Security регистрирует схему безопасности и привязывает её к операции", () => {
    const json = build();
    expect(json.paths["/items"].post.security).toEqual([{ Shop: [] }]);
    expect(json.components.securitySchemes.Shop).toMatchObject({ scheme: "bearer" });
  });

  it("конструктор принимает только info; версию, теги, пути и компоненты пишет генератор", () => {
    class Catalog {}

    @Controller()
    class Generated {
      @Get("/items")
      @UseTag(Catalog)
      @Responses({ status: 200, schema: ItemDto, description: "ok" })
      static async list() {
        return [];
      }
    }

    const info = { title: "t", version: "1", description: "d" };
    const docs = new OpenApi(info);
    new Router(Generated, docs);
    const json = docs.toJSON();

    expect(json.openapi).toBe(OpenApi.version);
    expect(json.info).toEqual(info);
    expect(Object.keys(json).sort()).toEqual(["components", "info", "openapi", "paths", "tags"]);
    expect(json.tags).toEqual([{ name: "Catalog" }]);
    expect(Object.keys(json.paths)).toEqual(["/items"]);
    expect(json.paths["/items"].get.operationId).toBe("Generated_list");
    expect(json.components.schemas.ItemDto).toMatchObject({
      properties: { title: { type: "string" } },
    });
  });
});

describe("router: поток событий в @Responses (events → itemSchema)", () => {
  @ComponentSchema()
  class UnreadEvent {
    @PropertySchema.Number({})
    total!: number;
  }

  @ComponentSchema()
  class NoticeEvent {
    @PropertySchema.String({})
    text!: string;
  }

  const variant = (name: string, ref: string) => ({
    type: "object",
    required: ["event", "data"],
    properties: {
      event: { const: name },
      data: {
        type: "string",
        contentMediaType: "application/json",
        contentSchema: { $ref: `#/components/schemas/${ref}` },
      },
      id: { type: "string" },
      retry: { type: "integer" },
    },
  });

  const docsOf = (root: ClassType) => {
    const docs = new OpenApi({ title: "t", version: "1" });
    new Router(root, docs);
    return docs.toJSON();
  };

  it("два события: тело — строка, itemSchema.oneOf по варианту на событие, классы в components", () => {
    @Controller()
    class Stream {
      @Get("/events")
      @Responses({
        status: 200,
        description: "поток",
        events: { unread: UnreadEvent, notice: NoticeEvent },
      })
      static async connect() {}
    }

    const json = docsOf(Stream);
    expect(json.paths["/events"].get.responses["200"]).toEqual({
      description: "поток",
      content: {
        "text/event-stream": {
          schema: { type: "string" },
          itemSchema: {
            oneOf: [variant("unread", "UnreadEvent"), variant("notice", "NoticeEvent")],
          },
        },
      },
    });
    expect(Object.keys(json.components.schemas)).toEqual(
      expect.arrayContaining(["UnreadEvent", "NoticeEvent"]),
    );
  });

  it("ThisRef в events разрешается на классе шага-наследника", () => {
    @Controller()
    class Base {
      static Event: ClassType = UnreadEvent;

      @Middleware()
      @Responses({
        status: 200,
        description: "поток",
        events: { tick: ThisRef(({ Event }: typeof Base) => Event) },
      })
      static async Describe() {}
    }

    @Controller()
    class Child extends Base {
      static Event = NoticeEvent;

      @Get("/child")
      @Before(Child.Describe)
      static async connect() {}
    }

    const json = docsOf(Child);
    const media = json.paths["/child"].get.responses["200"].content["text/event-stream"];
    expect(media.itemSchema.oneOf).toEqual([variant("tick", "NoticeEvent")]);
  });

  it("пустой events и имя события с переводом строки — ошибка при построении маршрута", () => {
    @Controller()
    class Empty {
      @Get("/e")
      @Responses({ status: 200, description: "поток", events: {} })
      static async connect() {}
    }

    @Controller()
    class Broken {
      @Get("/b")
      @Responses({ status: 200, description: "поток", events: { "a\nb": UnreadEvent } })
      static async connect() {}
    }

    expect(() => docsOf(Empty)).toThrow("RESPONSE_EVENTS_DEFINE_ERROR");
    expect(() => docsOf(Broken)).toThrow("RESPONSE_EVENTS_DEFINE_ERROR");
  });

  it("свой contentType потока сохраняется; обычный ответ без events — как раньше", () => {
    @Controller()
    class Mixed {
      @Get("/custom")
      @Responses({
        status: 200,
        description: "поток",
        contentType: "text/x-events",
        events: { unread: UnreadEvent },
      })
      static async custom() {}

      @Get("/plain")
      @Responses({ status: 200, description: "ok", schema: UnreadEvent })
      static async plain() {}
    }

    const json = docsOf(Mixed);
    expect(Object.keys(json.paths["/custom"].get.responses["200"].content)).toEqual([
      "text/x-events",
    ]);
    expect(json.paths["/plain"].get.responses["200"]).toEqual({
      description: "ok",
      content: { "application/json": { schema: { $ref: "#/components/schemas/UnreadEvent" } } },
    });
  });
});
