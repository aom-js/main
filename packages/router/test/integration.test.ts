import { describe, it, expect } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  Controller, Post, Router, OpenApi,
  Body, Err, RequestBody, Responses, HttpContextValues,
} from "@aom-js/router";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";

@ComponentSchema({ description: "Заказ" })
class OrderDto {
  @PropertySchema.String({ minLength: 3 })
  product!: string;

  @PropertySchema.Number({ minValue: 1 })
  qty!: number;
}

@Controller()
class OrdersApi {
  @Post("/orders")
  @RequestBody({ schema: OrderDto })
  @Responses({ status: 201, schema: OrderDto, description: "created" })
  static async create(
    @Body() body: unknown,
    @Err() err: (message: string, status?: number) => Error,
  ) {
    const order = plainToInstance(OrderDto, body);
    const errors = validateSync(order);
    if (errors.length) return err("validation failed", 400);
    return order;
  }
}

const makeContext = (body: unknown): HttpContextValues => ({
  ctx: {}, req: {}, res: {}, body, files: {}, query: {},
  params: {}, cookies: {}, headers: {}, session: {},
});

describe("интеграция: контроллер + схема + валидация + OpenAPI из одних метаданных", () => {
  const docs = new OpenApi({ openapi: "3.1.0", info: { title: "orders", version: "1" } });
  const router = new Router(OrdersApi, docs);
  const route = router.routes.find((r) => r.method === "post" && r.path === "/orders")!;

  it("валидное тело: трансформация и ответ", async () => {
    const result = await route.apply(makeContext({ product: "book", qty: "2" }));
    expect(result).toBeInstanceOf(OrderDto);
    expect(result.qty).toBe(2); // строка приведена к числу той же схемой
  });

  it("невалидное тело: reject со статусом 400", async () => {
    await expect(route.apply(makeContext({ product: "x" }))).rejects.toMatchObject({
      message: "validation failed",
      status: 400,
    });
  });

  it("та же схема отражена в OpenAPI как $ref-компонент", () => {
    const json = docs.toJSON();
    expect(json.paths["/orders"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/OrderDto",
    });
    expect(json.components.schemas.OrderDto).toMatchObject({
      description: "Заказ",
      properties: { product: { type: "string", minLength: 3 } },
    });
  });
});
