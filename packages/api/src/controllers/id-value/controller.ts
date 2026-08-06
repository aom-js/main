import { After, Controller, Headers, Query, This, ThisRef, type RefFunction } from "@aom-js/router";
import { type OpenApiParameterObject, type OpenApiPathParameters } from "@aom-js/router";
import { Parameters, Params, PathParameters, DelayRefStack, Middleware } from "@aom-js/router";
//
import { MongoIDSchema, NanoIDSchema, NumberIDSchema, ParamIDSchema, UUIDSchema } from "./schemas";

type pathIn = "path" | "query" | "header";

const PathRefParams = ThisRef((<T extends typeof IDController>(constructor: T) => {
  return [PathParameters(constructor.param())];
}) as RefFunction);

const RefParams = (pathIn: pathIn) =>
  ThisRef((<T extends typeof IDController>(constructor: T) => {
    return [Parameters(constructor.JSONSchema(pathIn))];
  }) as RefFunction);

@Controller()
export class IDController {
  value: any;

  source: any;

  static readonly attr: string;

  static readonly pattern: ParamIDSchema;

  @Middleware()
  @DelayRefStack(PathRefParams)
  @After(IDController.PathValue)
  static async PathID() { }

  @Middleware()
  @DelayRefStack(RefParams("query"))
  @After(IDController.QueryValue)
  static async QueryID() { }

  @Middleware()
  @DelayRefStack(RefParams("header"))
  @After(IDController.HeaderValue)
  static async HeaderID() { }

  @Middleware()
  @After(IDController.Assign)
  static async PathValue(@This() self: IDController, @Params() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  @After(IDController.Assign)
  static async QueryValue(@This() self: IDController, @Query() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  @After(IDController.Assign)
  static async HeaderValue(@This() self: IDController, @Headers() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  static async Assign(@This() self: IDController) {
    self.value = self.source[this.attr];
  }

  static toString(): string {
    return this.pattern.format(this.attr);
  }

  static param(): OpenApiPathParameters {
    return {
      [this.toString()]: this.JSONSchema("path"),
    };
  }

  static JSONSchema(pathIn: pathIn): OpenApiParameterObject {
    return {
      name: this.attr,
      description: this.attr,
      schema: this.pattern.schema(),
      required: true,
      in: pathIn,
    };
  }
}

export function IDValue<T extends typeof ParamIDSchema>(attr: string, IDPattern: T) {
  return class extends IDController {
    static readonly attr = attr;
    static pattern = new IDPattern();
  };
}

export function UUIDParam(attr: string): ReturnType<typeof IDValue<typeof UUIDSchema>> {
  return IDValue(attr, UUIDSchema);
}

export function MongoIDParam(attr: string): ReturnType<typeof IDValue<typeof MongoIDSchema>> {
  return IDValue(attr, MongoIDSchema);
}

export function NanoIDParam(attr: string): ReturnType<typeof IDValue<typeof NanoIDSchema>> {
  return IDValue(attr, NanoIDSchema);
}

export function NumberIDParam(attr: string): ReturnType<typeof IDValue<typeof NumberIDSchema>> {
  return IDValue(attr, NumberIDSchema);
}
