import { type OpenApiRequestBody, type RefFunction } from "@aom-js/router";
import { DelayRefStack, Body, RequestBody } from "@aom-js/router";
import { Controller, ThisRef, This, Middleware, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { SafeData } from "../decorators";
import { WrongDataResponse } from "../responses";

const SafeOrigin = ThisRef((<T extends typeof BodyBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginRequestBody = ThisRef((<T extends typeof BodyBuilderConstructor>(
  constructor: T,
) => [RequestBody(constructor.JSONSchema())]) as RefFunction);

@Controller()
class BodyBuilderConstructor<T extends ClassConstructor, R = InstanceType<T>> {
  static readonly schema: ClassConstructor;

  static description?: string;

  body!: R;

  static JSONSchema(description?: string): OpenApiRequestBody {
    return {
      schema: this.schema,
      description: description ? String(this.description) : "",
    };
  }

  @Middleware()
  @DelayRefStack(SafeOriginRequestBody)
  @Responses(WrongDataResponse.JSONSchema())
  static async Body(@Body(SafeOrigin) body: any, @This() self: BodyBuilderConstructor<any>) {
    self.body = body;
  }
}

export function BodyBuilder<T extends ClassConstructor>(schema: T, description?: string): typeof BodyBuilderConstructor<T> {
  return class extends BodyBuilderConstructor<T> {
    static readonly schema = schema;

    static description = description;
  };
}
