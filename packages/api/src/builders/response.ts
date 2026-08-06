import { Class } from "type-fest";

import { type RefFunction, Responses, ThisRef } from "@aom-js/router";
import { Controller, DelayRefStack, Middleware } from "@aom-js/router";
//
import { responseJsonSchema } from "../functions";

const SafeOriginParameters = ThisRef((<T extends typeof ResponseBuilderConstructor>(
  constructor: T,
) => [Responses(constructor.JSONSchema())]) as RefFunction);

@Controller()
class ResponseBuilderConstructor<T extends Class<any, any>, R = InstanceType<T>> {
  static status: number = 200;
  static schema: Class<any, any>;

  response!: R;

  static JSONSchema(
    description?: string | string[],
    status?: number,
  ): ReturnType<typeof responseJsonSchema> {
    return responseJsonSchema(this.schema, description, status || this.status);
  }

  // эта middleware в том числе для изучения гипотезы о баге каскадного наследования
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  static async Response() {}
}

export function ResponseBuilder<T extends Class<any, any>>(
  schema: T,
  status: number = ResponseBuilderConstructor.status,
) {
  return class extends ResponseBuilderConstructor<T> {
    static schema = schema;
    static status: number = status;
  };
}
