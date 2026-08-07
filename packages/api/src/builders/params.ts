import { Class } from "type-fest";

import { AomSchemas } from "@aom-js/schemer";
import { Controller, DelayRefStack } from "@aom-js/router";
import { Params, ThisRef, This, Middleware, PathParameters, Responses } from "@aom-js/router";
import type { RefFunction, OpenApiParameterObject, OpenApiPathParameters } from "@aom-js/router";
//
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";

//
import { QueryStringJSONSchema } from "../common";
import { plainJsonSchema } from "../functions";

const SafeOrigin = ThisRef((<T extends typeof ParamsController>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof ParamsController>(constructor: T) => [
  PathParameters(constructor.JSONSchema()),
]) as RefFunction);

@Controller()
class ParamsController<T extends Class<any, any>, R = InstanceType<T>> {
  static readonly schema: Class<any, any>;

  static readonly attr: string;

  static readonly jsonSchema: OpenApiParameterObject;

  params!: R;

  value!: any;

  static toString() {
    // здесь проверить, как будет работать паттерн
    return `${this.attr}${this.jsonSchema.schema.pattern ? `(${this.jsonSchema.schema.pattern})` : ""}`;
  }

  static JSONSchema(): OpenApiPathParameters {
    return { [this.attr]: this.jsonSchema };
  }

  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Params(SafeOrigin) params: any) {
    if (!Object.entries(params).length) {
      throw new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Params(
    @Params(SafeOrigin) params: any,
    @This() self: ParamsController<Class<any, any>>,
  ) {
    self.params = params;
    self.value = params[this.attr];
  }
}

export function ParamsBuilder<T extends Class<any, any>>(schema: T) {
  const aomSchemasClass = AomSchemas.checkExists(schema);
  //
  if (!aomSchemasClass || !aomSchemasClass.isComponentSchema) {
    throw new Error(`${messages.COMPONENT_SCHEMA_NOT_DEFINED}: ${schema.name}`);
  }
  //
  if (aomSchemasClass.properties.size !== 1) {
    throw new Error(`${messages.COMPONENT_SCHEMA_ONLY_PROPERTY_REQUIRED}: ${schema.name}`);
  }
  // достаём до объявления класса: в теле класса сужение aomSchemasClass не сохраняется
  const attrName = aomSchemasClass.properties.values().next().value as string;
  //
  return class extends ParamsController<T> {
    static readonly schema = schema;

    static readonly jsonSchema = plainJsonSchema(schema, "path")[0];
    static readonly attr = attrName;
  };
}
